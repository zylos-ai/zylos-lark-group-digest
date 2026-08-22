import assert from 'node:assert/strict';
import test from 'node:test';

import { collectPages } from './pagination.mjs';

test('returns a single page unchanged', async () => {
  const result = await collectPages(async token => {
    assert.equal(token, undefined);
    return { success: true, messages: [{ id: 'm1' }], hasMore: false };
  });

  assert.equal(result.success, true);
  assert.equal(result.pageCount, 1);
  assert.deepEqual(result.messages.map(message => message.id), ['m1']);
});

test('collects multiple pages in order and removes duplicate message IDs', async () => {
  const pages = new Map([
    [undefined, { messages: [{ id: 'm1' }, { id: 'm2' }], hasMore: true, nextPageToken: 'p2' }],
    ['p2', { messages: [{ id: 'm2' }, { id: 'm3' }], hasMore: true, nextPageToken: 'p3' }],
    ['p3', { messages: [{ id: 'm4' }], hasMore: false }],
  ]);
  const seenTokens = [];

  const result = await collectPages(async token => {
    seenTokens.push(token);
    return { success: true, ...pages.get(token) };
  });

  assert.equal(result.success, true);
  assert.equal(result.pageCount, 3);
  assert.deepEqual(seenTokens, [undefined, 'p2', 'p3']);
  assert.deepEqual(result.messages.map(message => message.id), ['m1', 'm2', 'm3', 'm4']);
});

test('fails loud when has_more is true without a next page token', async () => {
  const result = await collectPages(async () => ({
    success: true,
    messages: [{ id: 'm1' }],
    hasMore: true,
  }));

  assert.equal(result.success, false);
  assert.match(result.message, /page_token is missing/);
});

test('fails loud when the API repeats a page token', async () => {
  const result = await collectPages(async token => ({
    success: true,
    messages: [{ id: token || 'm1' }],
    hasMore: true,
    nextPageToken: 'same-token',
  }));

  assert.equal(result.success, false);
  assert.equal(result.pageCount, 2);
  assert.match(result.message, /repeated page_token/);
});

test('preserves partial messages and failure evidence from a later page', async () => {
  const result = await collectPages(async token => {
    if (!token) {
      return {
        success: true,
        messages: [{ id: 'm1' }],
        hasMore: true,
        nextPageToken: 'p2',
      };
    }
    return { success: false, message: 'upstream failed', code: 500 };
  });

  assert.equal(result.success, false);
  assert.equal(result.code, 500);
  assert.equal(result.pageCount, 1);
  assert.deepEqual(result.messages.map(message => message.id), ['m1']);
});

test('enforces a finite page safety limit', async () => {
  let page = 0;
  const result = await collectPages(async () => {
    page += 1;
    return {
      success: true,
      messages: [{ id: `m${page}` }],
      hasMore: true,
      nextPageToken: `p${page}`,
    };
  }, { maxPages: 2 });

  assert.equal(result.success, false);
  assert.equal(result.pageCount, 2);
  assert.match(result.message, /safety limit/);
});
