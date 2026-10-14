import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserClient, checkAuthorization, AuthorizationRequired, REQUIRED_SCOPES } from '../scripts/user-client.mjs';
import { listGroups, listMessages, fetchGroups } from '../scripts/digest-source.mjs';

function status(scope = REQUIRED_SCOPES.join(' ')) {
  return { identities: { user: { status: 'ready', available: true, verified: true, scope } } };
}
const message = (id, extra = {}) => ({ message_id: id, msg_type: 'text', create_time: '1700000000000', body: { content: '{"text":"hello"}' }, ...extra });

test('auth preflight requires a verified user, not a ready bot', () => {
  for (const value of [{ identities: { bot: { status: 'ready' } } }, { identities: { user: { ...status().identities.user, status: 'expired' } } }]) {
    assert.throws(() => checkAuthorization(value), AuthorizationRequired);
  }
  assert.equal(checkAuthorization(status()).status, 'ready');
});
test('auth requests only missing group read scopes, never private-message access', () => {
  assert.throws(() => checkAuthorization(status('im:chat:read im:message:readonly')), err => {
    assert.deepEqual(err.scopes, ['im:message.group_msg:get_as_user']);
    assert.doesNotMatch(err.command, /p2p/);
    return true;
  });
  assert.equal(checkAuthorization(status(REQUIRED_SCOPES.join(' ').replace('im:chat:read', 'im:chat:readonly'))).status, 'ready');
});
test('CLI always uses raw GET and explicit user identity with argument arrays', async () => {
  const calls = [];
  const client = createUserClient({ run: async (bin, args) => {
    calls.push({ bin, args });
    return { stdout: JSON.stringify(args[0] === 'auth' ? status() : { ok: true, identity: 'user', data: { items: [] } }) };
  } });
  await client.authorize();
  await client.get('/open-apis/im/v1/chats', { page_token: 'a;$(do-not-run)' });
  assert.deepEqual(calls[0].args, ['auth', 'status', '--json', '--verify']);
  assert.deepEqual(calls[1].args.slice(0, 5), ['api', 'GET', '/open-apis/im/v1/chats', '--as', 'user']);
  assert.equal(JSON.parse(calls[1].args[6]).page_token, 'a;$(do-not-run)');
});
test('CLI rejects bot fallback and preserves actionable auth errors', async () => {
  const bot = createUserClient({ run: async () => ({ stdout: '{"ok":true,"identity":"bot","data":{}}' }) });
  await assert.rejects(bot.get('/test', {}), /user-identity/);
  const fail = createUserClient({ run: async () => {
    throw { stderr: JSON.stringify({ ok: false, error: { type: 'authorization', missing_scopes: ['im:chat:read'] } }) };
  } });
  await assert.rejects(fail.authorize(), err => err instanceof AuthorizationRequired && err.scopes[0] === 'im:chat:read');
});
test('CLI failures never print subprocess arguments or raw credential output', async () => {
  const client = createUserClient({ run: async () => { throw { message: 'SECRET', stderr: 'SECRET', code: 'ENOBUFS' }; } });
  await assert.rejects(client.authorize(), err => !err.message.includes('SECRET'));
});
test('enumeration exhausts pages, deduplicates and uses stable creation order', async () => {
  const calls = [];
  const client = { get: async (_, params) => {
    calls.push(params);
    if (!params.page_token) return { items: Array.from({ length: 100 }, (_, i) => ({ chat_id: `c${i}` })), has_more: true, page_token: 'next' };
    return { items: [{ chat_id: 'c99' }, { chat_id: 'c100' }], has_more: false };
  } };
  const groups = await listGroups(client, { fullScan: true });
  assert.equal(groups.length, 101);
  assert.equal(calls[1].page_token, 'next');
  assert.ok(calls.every(p => p.sort_type === 'ByCreateTimeAsc'));
});
test('incomplete enumeration aborts; no one-page fallback or empty success', async () => {
  await assert.rejects(listGroups({ get: async () => ({ items: [], has_more: true }) }), /Incomplete/);
  let i = 0;
  await assert.rejects(listGroups({ get: async () => {
    if (i++ === 0) return { items: [{ chat_id: 'one' }], has_more: true, page_token: 'next' };
    throw new Error('network failure');
  } }), /network failure/);
});
test('messages retain sender and image evidence and all pages within the requested window', async () => {
  const calls = [];
  const client = { get: async (_, params) => {
    calls.push(params);
    return params.page_token ? { items: [message('two')], has_more: false } : {
      items: [message('one', { msg_type: 'image', body: { content: '{"image_key":"img_test"}' }, sender: { id: 'u1', sender_name: 'Reader' } })],
      has_more: true, page_token: 'next',
    };
  } };
  const data = await listMessages(client, 'bot-absent', 100, 200);
  assert.equal(data.messages.length, 2);
  assert.equal(data.messages[0].senderName, 'Reader');
  assert.match(data.messages[0].content, /img_test/);
  assert.ok(calls.every(p => p.start_time === '100' && p.end_time === '200' && p.with_sender_name === true));
});
test('per-group reads and partial failures remain visible before early stopping', async () => {
  let calls = 0;
  const client = { get: async (_, p) => {
    calls++;
    if (p.container_id === 'old-looking') return { items: [], has_more: false };
    if (!p.page_token) return { items: [message('one')], has_more: true, page_token: 'next' };
    throw new Error('permission denied');
  } };
  const groups = await fetchGroups(client, [{ id: 'old-looking', name: 'Old group' }, { id: 'failed', name: 'Failed' }], 100, 200);
  assert.equal(calls, 4);
  assert.equal(groups[0].status, 'ok');
  assert.equal(groups[1].status, 'error');
  assert.equal(groups[1].messageCount, 1);
  assert.match(groups[1].error, /permission denied/);
});
test('authorization expiry mid-run aborts rather than labelling every group empty', async () => {
  await assert.rejects(fetchGroups({ get: async () => { throw new AuthorizationRequired(); } }, [{ id: 'a' }], 100, 200), AuthorizationRequired);
});

test('verification/network failures do not require reauthorization', () => {
  for (const user of [
    { ...status().identities.user, status: 'verify_failed', verified: false },
    { ...status().identities.user, verified: false },
  ]) {
    assert.throws(() => checkAuthorization({ identities: { user } }), err => !(err instanceof AuthorizationRequired) && /retry/.test(err.message));
  }
});
test('nonzero auth status still distinguishes a missing login from verification failure', async () => {
  const client = createUserClient({ run: async () => { throw { stdout: JSON.stringify({ identities: { user: { status: 'missing' } } }) }; } });
  await assert.rejects(client.authorize(), AuthorizationRequired);
});

test('default enumeration requests descending activity order', async () => {
  let sort;
  await listGroups({ get: async (_, p) => { sort = p.sort_type; return { items: [], has_more: false }; } });
  assert.equal(sort, 'ByActiveTimeDesc');
});
test('three confirmed idle groups stop history calls; skipped is not empty', async () => {
  let calls = 0;
  const groups = await fetchGroups({ get: async () => { calls++; return { items: [], has_more: false }; } },
    Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, name: `Group ${i}` })), 100, 200);
  assert.equal(calls, 6);
  assert.deepEqual(groups.map(g => g.status), ['ok', 'ok', 'ok', 'skipped', 'skipped', 'skipped']);
  assert.equal(groups[3].messageCount, null);
  assert.equal(groups[3].skippedReason, 'three_consecutive_idle_groups');
});
test('nonempty group and request failure both reset consecutive-empty streak', async () => {
  const seen = [];
  const groups = await fetchGroups({ get: async (_, p) => {
    seen.push(p.container_id);
    if (p.container_id === 'c2') return { items: [message('active')], has_more: false };
    if (p.container_id === 'c5') throw new Error('temporary failure');
    return { items: [], has_more: false };
  } }, Array.from({ length: 10 }, (_, i) => ({ id: `c${i}` })), 100, 200);
  assert.equal(seen.length, 16);
  assert.equal(groups[5].status, 'error');
  assert.equal(groups[8].status, 'ok');
  assert.equal(groups[9].status, 'skipped');
});
test('full scan reaches historical messages even after three empty groups', async () => {
  let calls = 0;
  const groups = await fetchGroups({ get: async () => ({ items: ++calls === 4 ? [message('historical')] : [], has_more: false }) },
    Array.from({ length: 5 }, (_, i) => ({ id: `c${i}` })), 100, 200, { fullScan: true });
  assert.equal(calls, 5);
  assert.equal(groups[3].messageCount, 1);
  assert.ok(groups.every(g => g.status === 'ok'));
});

test('three groups active only after window end cannot hide a later in-window message', async () => {
  const probes = [];
  const groups = await fetchGroups({ get: async (_, p) => {
    if (p.page_size === 1) {
      probes.push(p);
      return { items: ['c0', 'c1', 'c2'].includes(p.container_id) ? [message('after-end', { create_time: '250000' })] : [], has_more: false };
    }
    return { items: p.container_id === 'c3' ? [message('inside', { create_time: '150000' })] : [], has_more: false };
  } }, Array.from({ length: 8 }, (_, i) => ({ id: `c${i}` })), 100, 200);
  assert.equal(groups[3].messageCount, 1);
  assert.equal(groups[7].status, 'skipped');
  assert.ok(groups.slice(0, 3).every(g => g.activityCheck === 'active_since_start' && g.messageCount === 0));
  assert.ok(probes.every(p => p.start_time === '100' && !('end_time' in p) && p.sort_type === 'ByCreateTimeDesc'));
  assert.ok(groups.every(g => !g.messages.some(m => m.id === 'after-end')));
});
test('failed latest-message probe resets streak and is visible without invalidating window results', async () => {
  let reads = 0;
  const groups = await fetchGroups({ get: async (_, p) => {
    reads++;
    if (p.page_size === 1 && p.container_id === 'c2') throw new Error('probe failed');
    return { items: [], has_more: false };
  } }, Array.from({ length: 7 }, (_, i) => ({ id: `c${i}` })), 100, 200);
  assert.equal(reads, 12);
  assert.equal(groups[2].status, 'ok');
  assert.equal(groups[2].activityCheck, 'unavailable');
  assert.equal(groups[2].activityCheckError, 'probe failed');
  assert.equal(groups[5].activityCheck, 'idle_since_start');
  assert.equal(groups[6].status, 'skipped');
});
test('malformed activity probe does not prove inactivity', async () => {
  const groups = await fetchGroups({ get: async (_, p) => p.page_size === 1 ? { items: [], has_more: true } : { items: [], has_more: false } },
    Array.from({ length: 4 }, (_, i) => ({ id: `c${i}` })), 100, 200);
  assert.ok(groups.every(g => g.activityCheck === 'unavailable' && g.status === 'ok'));
});
