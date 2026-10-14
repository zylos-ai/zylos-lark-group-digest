#!/usr/bin/env node
/**
 * Lark Group Digest — fetch messages, resolve senders, format for summarization.
 *
 * Usage:
 *   node digest.mjs --start <unix_sec> --end <unix_sec> [--out <path>] [--config <path>] [--full-scan]
 *
 * Output: JSON array of { group, messageCount, formatted } to stdout (or --out file).
 * `formatted` is a human/agent-readable string of all messages, with resolved
 * sender names, replaced @mentions, and timestamps.
 *
 * Uses lark-cli's authorized user session; never falls back to bot identity.
 */

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createUserClient, AuthorizationRequired } from './user-client.mjs';
import { listGroups, fetchGroups } from './digest-source.mjs';

const { values: args } = parseArgs({
  options: {
    start: { type: 'string' },
    end: { type: 'string' },
    out: { type: 'string' },
    config: { type: 'string' },
    'full-scan': { type: 'boolean', default: false },
  },
});

if (!args.start || !args.end) {
  console.error('Usage: digest.mjs --start <unix_sec> --end <unix_sec> [--out <path>] [--config <path>] [--full-scan]');
  process.exit(1);
}

const DATA_DIR = path.join(os.homedir(), 'zylos/components/lark-group-digest');
const configPath = args.config || path.join(DATA_DIR, 'config.json');

let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch {
  console.error(`Warning: config not found at ${configPath}, using defaults`);
}

const client = createUserClient();
const nameCache = new Map();

function resolveName(id) {
  if (!id) return 'unknown';
  if (nameCache.has(id)) return nameCache.get(id);
  if (id.startsWith('cli_')) return 'bot';
  return id.slice(-6);
}

function replaceMentions(content, mentions) {
  if (!mentions?.length) return content;
  let result = content;
  for (const m of mentions) {
    if (m.key && m.name) {
      result = result.replaceAll(m.key, `@${m.name}`);
    }
  }
  return result;
}

function extractText(content, type) {
  if (type === 'image') return '[图片]';
  if (type === 'file') return '[文件]';
  if (type === 'audio') return '[语音]';
  if (type === 'video') return '[视频]';
  if (type === 'sticker') return '[表情]';
  if (type === 'system') return '[系统消息]';
  if (!content) return '';
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  if (!str.startsWith('{') && !str.startsWith('[')) return str.slice(0, 500);
  try {
    const parsed = JSON.parse(str);
    if (parsed.text) return parsed.text;
    if (parsed.image_key && !parsed.title && !parsed.content) return '[图片]';
    if (parsed.title !== undefined || (Array.isArray(parsed.content) && Array.isArray(parsed.content[0]))) {
      const texts = [];
      if (parsed.title) texts.push(parsed.title);
      const lines = Array.isArray(parsed.content) ? parsed.content : [];
      for (const line of lines) {
        if (!Array.isArray(line)) continue;
        for (const el of line) {
          if (el.tag === 'text' && el.text) texts.push(el.text.trim());
          if (el.tag === 'a' && (el.text || el.href)) texts.push(el.text || el.href);
          if (el.tag === 'at' && el.user_name) texts.push(`@${el.user_name}`);
          if (el.tag === 'img') texts.push('[图片]');
        }
      }
      return texts.join(' ').trim() || '[富文本消息]';
    }
    if (parsed.body?.elements || parsed.elements) {
      const els = parsed.body?.elements || parsed.elements || [];
      const parts = [];
      for (const el of els) {
        if (el.text?.content) parts.push(el.text.content);
        if (el.content) parts.push(el.content);
        if (el.tag === 'markdown' && el.content) parts.push(el.content);
      }
      return parts.join(' ').slice(0, 500) || '[卡片消息]';
    }
    return str.slice(0, 300);
  } catch {
    return str.slice(0, 500);
  }
}

function formatTime(isoString) {
  const d = new Date(isoString);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

async function main() {
  const start = Number(args.start);
  const end = Number(args.end);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= end) {
    throw new Error('Expected integer UNIX seconds with 0 <= start < end');
  }
  await client.authorize();
  const scanOptions = { fullScan: args['full-scan'] };
  const chats = await listGroups(client, scanOptions);
  const groupData = await fetchGroups(client, chats, start, end, scanOptions);
  for (const g of groupData) {
    for (const m of (g.messages || [])) {
      if (m.sender && m.senderName) nameCache.set(m.sender, m.senderName);
      for (const mention of (m.mentions || [])) {
        if (mention.id && mention.name) nameCache.set(mention.id, mention.name);
      }
    }
  }

  const output = [];
  for (const g of groupData) {
    if (g.messageCount === 0 || g.status === 'skipped') {
      output.push({ ...g, messages: undefined });
      continue;
    }
    const lines = [];
    for (const m of g.messages) {
      const sender = resolveName(m.sender);
      const time = formatTime(m.createTime);
      let text = extractText(m.content, m.type);
      text = replaceMentions(text, m.mentions);
      lines.push(`[${time} ${sender}] ${text}`);
    }
    output.push({
      ...g,
      formatted: lines.join('\n'),
    });
  }

  const json = JSON.stringify(output, null, 2);
  if (args.out) {
    const outDir = path.dirname(args.out);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, { mode: 0o600 });
    console.error(`Written to ${args.out}`);
  } else {
    console.log(json);
  }
}

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: err.message, code: err.code,
    ...(err instanceof AuthorizationRequired ? { scopes: err.scopes, authorizationCommand: err.command, notifyOwner: true, ownerChatId: config.owner_chat_id } : {}),
  }));
  process.exit(err instanceof AuthorizationRequired ? 3 : 1);
});
