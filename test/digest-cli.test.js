import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = path.join(dir, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ owner_chat_id: 'owner-dm' }));
  fs.writeFileSync(path.join(dir, 'lark-cli'), `#!/usr/bin/env node
const args = process.argv.slice(2);
const send = data => console.log(JSON.stringify(data));
if (args[0] === 'auth') {
  send({identities:{user:process.env.TEST_VERIFY_FAILED ? {status:'verify_failed',available:false,verified:false} : process.env.TEST_AUTH_MISSING ? {status:'missing',available:false} : {status:'ready',available:true,verified:true,scope:'im:chat:read im:message.group_msg:get_as_user im:message:readonly'}}});
} else {
  if (args[3] !== '--as' || args[4] !== 'user') process.exit(8);
  const p = JSON.parse(args[6]);
  if (args[2].endsWith('/chats')) send({ok:true,identity:'user',data:{items:process.env.TEST_EMPTY ? Array.from({length:6},(_,i)=>({chat_id:'e'+i,name:'Empty '+i})) : [{chat_id:'c1',name:'Readable'},{chat_id:'c2',name:'Unavailable'}],has_more:false}});
  else if (process.env.TEST_EMPTY) send({ok:true,identity:'user',data:{items:[],has_more:false}});
  else if (p.container_id === 'c2') {console.error(JSON.stringify({ok:false,error:{type:'api',code:230002,message:'No access'}}));process.exit(1);}
  else send({ok:true,identity:'user',data:{items:[{message_id:'m1',msg_type:'text',create_time:'1700000000000',sender:{id:'u1',sender_name:'Example'},body:{content:JSON.stringify({text:'Hello'})}}],has_more:false}});
}
`, { mode: 0o755 });
  return { dir, config, run(extra = {}, options = []) {
    return spawnSync(process.execPath, ['scripts/digest.mjs', '--start', '1699999999', '--end', '1700000010', '--config', config, '--out', path.join(dir, 'result.json'), ...options], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TZ: 'Asia/Singapore', ...extra },
    });
  } };
}

test('full executable preserves readable output and failed zero-message group', t => {
  const f = fixture(t); const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(fs.readFileSync(path.join(f.dir, 'result.json')));
  assert.equal(data[0].chatId, 'c1');
  assert.match(data[0].formatted, /\[06:13 Example\] Hello/);
  assert.equal(data[0].messages[0].id, 'm1');
  assert.equal(data[1].status, 'error');
  assert.equal(data[1].messageCount, 0);
  assert.match(data[1].error, /No access/);
  assert.equal(fs.statSync(path.join(f.dir, 'result.json')).mode & 0o777, 0o600);
});
test('missing user exits 3 with owner notification instructions and no digest artifact', t => {
  const f = fixture(t); const result = f.run({ TEST_AUTH_MISSING: '1' });
  assert.equal(result.status, 3);
  assert.equal(fs.existsSync(path.join(f.dir, 'result.json')), false);
  const error = JSON.parse(result.stderr.trim());
  assert.equal(error.notifyOwner, true);
  assert.equal(error.ownerChatId, 'owner-dm');
  assert.match(error.authorizationCommand, /--no-wait --json/);
  assert.doesNotMatch(error.authorizationCommand, /p2p/);
});

test('verification failure exits without requesting another authorization', t => {
  const f = fixture(t); const result = f.run({ TEST_VERIFY_FAILED: '1' });
  assert.equal(result.status, 1);
  const error = JSON.parse(result.stderr.trim());
  assert.equal(error.notifyOwner, undefined);
  assert.equal(error.authorizationCommand, undefined);
  assert.equal(fs.existsSync(path.join(f.dir, 'result.json')), false);
});

test('executable marks early-stopped groups unscanned and honors full-scan flag', t => {
  const f = fixture(t);
  let result = f.run({ TEST_EMPTY: '1' });
  assert.equal(result.status, 0, result.stderr);
  let data = JSON.parse(fs.readFileSync(path.join(f.dir, 'result.json')));
  assert.equal(data.filter(g => g.status === 'skipped').length, 3);
  assert.equal(data[3].messageCount, null);
  assert.equal(data[3].formatted, undefined);
  result = f.run({ TEST_EMPTY: '1' }, ['--full-scan']);
  assert.equal(result.status, 0, result.stderr);
  data = JSON.parse(fs.readFileSync(path.join(f.dir, 'result.json')));
  assert.ok(data.every(g => g.status === 'ok' && g.messageCount === 0));
});
