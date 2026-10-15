import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildNotificationCard as build } from '../scripts/notification-card.mjs';

const example = () => JSON.parse(readFileSync(new URL('../references/notification-card.example.json', import.meta.url), 'utf8'));
const cli = new URL('../scripts/render-notification-card.mjs', import.meta.url);

test('stable preview retains stats, sections and honest coverage including unviewed images', () => {
  const input = example();
  const before = structuredClone(input);
  const card = build(input);
  assert.deepEqual(input, before);
  assert.deepEqual(card, build(input));
  assert.equal(card.schema, '2.0');
  assert.equal(card.header.template, 'blue');
  assert.equal(card.config.enable_forward, false);
  assert.equal(card.body.elements.length, 5);
  assert.deepEqual(card.body.elements[0].columns.map(c => c.elements[0].content), ['## 8', '## 5', '## 42']);
  const output = JSON.stringify(card);
  for (const text of ['4 群未扫描', '群读取错误 1', '2 个已查看', '1 个不可用', '1 个尚未查看']) assert.ok(output.includes(text), text);
  assert.equal(card.body.elements.at(-1).behaviors[0].default_url, input.url);
});

test('empty optional sections omit blocks without inventing all-clear or privacy claims', () => {
  const input = example();
  delete input.attention;
  delete input.highlights;
  delete input.accessLabel;
  input.stats = { discovered: 0, scanned: 0, active: 0, errors: 0, messages: 0 };
  input.images = { references: 0, viewed: 0, unavailable: 0, pending: 0 };
  const card = build(input);
  assert.equal(card.body.elements.length, 3);
  assert.equal(card.header.subtitle.content, input.window);
  assert.equal(card.body.elements.at(-1).text.content, '查看完整摘要');
  assert.ok(!JSON.stringify(card).includes('需要你核对'));
  input.highlights = example().highlights;
  assert.equal(build(input).body.elements.length, 4);
});

test('untrusted item text cannot create Markdown links, formatting, tags, or native mentions', () => {
  const input = example();
  const attack = '<at id=all></at>\n@all **bold** [click](https://evil.example) &lt;at&gt; `code` \\';
  input.attention = [{ title: attack.slice(0, 70), detail: attack }];
  input.highlights = [{ title: 'Title', detail: attack }];
  input.title = '<at id=all></at>';
  const card = build(input);
  const body = JSON.stringify(card.body);
  assert.ok(!body.includes('<at'));
  assert.ok(!body.includes('@all'));
  assert.ok(!body.includes('[click]('));
  assert.ok(!body.includes('**bold**'));
  assert.ok(body.includes('&lt;at'));
  assert.ok(body.includes('&#64;all'));
  assert.ok(body.includes('&amp;lt;at&amp;gt;'));
  assert.equal(card.header.title.tag, 'plain_text');
  assert.equal(card.header.title.content, input.title);
  assert.equal(card.body.elements.filter(e => e.tag === 'button').length, 1);
});

test('invalid required fields, URLs and contradictory evidence are rejected', () => {
  const invalid = [null, [], {}, ...['title', 'window', 'url', 'stats', 'images'].map(key => {
    const input = example(); delete input[key]; return input;
  })];
  for (const url of ['http://example.com', 'javascript:alert(1)', '/relative', 'https://u:p@example.com']) invalid.push({ ...example(), url });
  invalid.push({ ...example(), title: '' }, { ...example(), window: 'a'.repeat(81) }, { ...example(), attention: null });
  for (const [key, value] of [['scanned', 13], ['active', 9], ['errors', 9], ['messages', -1], ['discovered', 1.5]]) {
    const input = example(); input.stats[key] = value; invalid.push(input);
  }
  const unaccounted = example(); unaccounted.images.pending = 0; invalid.push(unaccounted);
  const negative = example(); negative.images.viewed = -1; invalid.push(negative);
  const tooMany = example(); tooMany.attention = Array(4).fill({ title: 'T', detail: 'D' }); invalid.push(tooMany);
  const tooLong = example(); tooLong.highlights[0].detail = 'x'.repeat(301); invalid.push(tooLong);
  for (const input of invalid) assert.throws(() => build(input));
});

test('CLI emits only payload on success; errors do not expose private input', () => {
  const success = spawnSync(process.execPath, [cli.pathname], { input: JSON.stringify(example()), encoding: 'utf8' });
  assert.equal(success.status, 0);
  assert.equal(success.stderr, '');
  assert.deepEqual(JSON.parse(success.stdout), build(example()));
  for (const input of ['{"PRIVATE_SENTINEL":', JSON.stringify({ title: 'PRIVATE_SENTINEL' })]) {
    const failure = spawnSync(process.execPath, [cli.pathname], { input, encoding: 'utf8' });
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, '');
    assert.ok(!failure.stderr.includes('PRIVATE_SENTINEL'));
    assert.match(failure.stderr, /Invalid notification input/);
  }
});
