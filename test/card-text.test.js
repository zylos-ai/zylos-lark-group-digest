import test from 'node:test';
import assert from 'node:assert/strict';
import { extractInteractiveText as extract } from '../scripts/card-text.mjs';

test('original Schema 2 body keeps all text beyond old 500 character cutoff', () => {
  const text = 'Sanitized content. '.repeat(100) + 'END';
  assert.equal(extract({ schema: '2.0', body: { elements: [{ tag: 'markdown', content: text }] } }), text);
});
test('user_dsl takes precedence over rendered placeholder; string and object supported', () => {
  const dsl = { body: { elements: [{ tag: 'markdown', content: 'Real body' }] } };
  for (const user_dsl of [dsl, JSON.stringify(dsl)]) {
    assert.equal(extract({ user_dsl, elements: [[{ tag: 'img', image_key: 'placeholder' }]] }), 'Real body');
  }
});
test('legacy fields, nested columns, notes, buttons and text runs remain readable', () => {
  const elements = [{ tag: 'column_set', columns: [{ elements: [
    { tag: 'div', text: { content: 'Heading' }, fields: [{ text: { content: 'Field value' } }] },
    { tag: 'note', elements: [{ tag: 'plain_text', content: 'Note' }] },
    { tag: 'action', actions: [{ tag: 'button', text: { content: 'Open' } }] },
  ] }] }, [{ tag: 'text', text: 'Legacy' }]];
  assert.equal(extract({ elements }), 'Heading\nField value\nNote\nOpen\nLegacy');
});
test('malformed DSL falls back; title-only and image-only stay explicit', () => {
  assert.equal(extract({ user_dsl: '{', elements: [{ tag: 'lark_md', content: 'Fallback' }] }), 'Fallback');
  assert.equal(extract({ header: { title: { content: 'Title' } } }), '[card] Title');
  assert.equal(extract({ title: null, elements: [[{ tag: 'img', image_key: 'placeholder' }, { tag: 'text', text: ' ' }]] }), '[interactive message]');
  assert.equal(extract('invalid JSON'), '[interactive message]');
  assert.equal(extract(null), '[interactive message]');
});
test('malformed containers cannot throw or log private contents', () => {
  const old = console.log;
  console.log = () => { throw new Error('Must not log card data'); };
  try { assert.equal(extract({ elements: [{ tag: 'div', fields: {} }] }), '[interactive message]'); }
  finally { console.log = old; }
});

test('empty or image-only body falls back to readable legacy elements', () => {
  for (const elements of [[], [{ tag: 'img', image_key: 'placeholder' }]]) {
    assert.equal(extract({ body: { elements }, elements: [{ tag: 'markdown', content: 'Legacy body' }] }), 'Legacy body');
  }
});

test('card heading is retained alongside its body without repeating identical text', () => {
  assert.equal(extract({ header: { title: { content: 'Project Alpha' } }, body: { elements: [{ tag: 'markdown', content: 'Launch postponed' }] } }), 'Project Alpha\nLaunch postponed');
  assert.equal(extract({ title: 'Same', body: { elements: [{ tag: 'markdown', content: 'Same' }] } }), 'Same');
});
