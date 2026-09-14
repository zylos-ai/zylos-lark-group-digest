#!/usr/bin/env node
/**
 * Lark Group Digest — fetch messages, resolve senders, format for summarization.
 *
 * Usage:
 *   node digest.mjs --start <unix_sec> --end <unix_sec> [--out <path>] [--config <path>]
 *
 * Output: JSON array of { group, messageCount, formatted } to stdout (or --out file).
 * `formatted` is a human/agent-readable string of all messages, with resolved
 * sender names, replaced @mentions, and timestamps.
 *
 * The lark component's lib directory is resolved from the component config
 * (`lark_skill_path`) rather than a hardcoded path.
 */

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { collectPages } from './pagination.mjs';

const { values: args } = parseArgs({
  options: {
    start: { type: 'string' },
    end: { type: 'string' },
    out: { type: 'string' },
    config: { type: 'string' },
  },
});

if (!args.start || !args.end) {
  console.error('Usage: digest.mjs --start <unix_sec> --end <unix_sec> [--out <path>] [--config <path>]');
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

const larkSkillPath = config.lark_skill_path || path.join(os.homedir(), 'zylos/.claude/skills/lark');
const LARK_LIB = path.join(larkSkillPath, 'src/lib');

const { listChats, listChatMembers } = await import(pathToFileURL(path.join(LARK_LIB, 'chat.js')).href);
const { getClient } = await import(pathToFileURL(path.join(LARK_LIB, 'client.js')).href);

const nameCache = new Map();

async function populateNamesFromMembers(chatId) {
  try {
    const result = await listChatMembers(chatId);
    if (result.success) {
      for (const m of result.members) {
        if (m.memberId && m.name) nameCache.set(m.memberId, m.name);
      }
    }
  } catch { /* best effort */ }
}

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
  const h = String(d.getUTCHours() + 8).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function mapMessage(msg) {
  return {
    id: msg.message_id,
    type: msg.msg_type,
    content: msg.body?.content || '',
    sender: msg.sender?.id,
    senderType: msg.sender?.sender_type,
    createTime: new Date(Number(msg.create_time)).toISOString(),
    mentions: msg.mentions || [],
  };
}

async function listMessagePage(chatId, startTime, endTime, pageToken) {
  const params = {
    container_id_type: 'chat',
    container_id: chatId,
    page_size: 50,
    sort_type: 'ByCreateTimeAsc',
    user_id_type: 'open_id',
    card_msg_content_type: 'user_card_content',
    start_time: String(startTime),
    end_time: String(endTime),
  };
  if (pageToken) params.page_token = pageToken;

  try {
    const res = await getClient().im.message.list({ params });
    if (res.code !== 0) {
      return { success: false, message: `Failed to list messages: ${res.msg}`, code: res.code };
    }

    return {
      success: true,
      messages: (res.data.items || []).map(mapMessage),
      hasMore: Boolean(res.data.has_more),
      nextPageToken: res.data.page_token || null,
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function listAllMessages(chatId, startTime, endTime) {
  return collectPages(pageToken => listMessagePage(chatId, startTime, endTime, pageToken));
}

/**
 * List every chat the bot is in, following page_token until has_more is false.
 * listChats() from the lark lib returns a single page (default 50), which silently
 * drops groups once the bot is in more than that many. Falls back to listChats()
 * if the raw client call fails for any reason.
 */
async function listAllChats() {
  try {
    const client = getClient();
    const chats = [];
    let pageToken = null;
    do {
      const params = { page_size: 100 };
      if (pageToken) params.page_token = pageToken;
      const res = await client.im.chat.list({ params });
      if (res.code !== 0) throw new Error(`im.chat.list failed: ${res.code} ${res.msg || ''}`);
      for (const chat of res.data.items || []) {
        chats.push({
          id: chat.chat_id,
          name: chat.name,
          description: chat.description,
          memberCount: chat.user_count,
          chatType: chat.chat_type,
        });
      }
      pageToken = res.data.has_more ? res.data.page_token : null;
    } while (pageToken);
    return { success: true, chats, hasMore: false };
  } catch (err) {
    console.error(`Warning: paginated chat listing failed (${err.message}); falling back to listChats()`);
    return listChats();
  }
}

async function main() {
  const chatResult = await listAllChats();
  const chats = chatResult.chats || [];

  const groupData = [];
  for (const chat of chats) {
    try {
      const result = await listAllMessages(chat.id, args.start, args.end);
      if (!result.success) {
        groupData.push({ group: chat.name, chatId: chat.id, messageCount: 0, error: result.message });
        continue;
      }
      const msgs = result.messages || [];
      if (msgs.length === 0) {
        groupData.push({ group: chat.name, chatId: chat.id, messageCount: 0 });
        continue;
      }
      groupData.push({ group: chat.name, chatId: chat.id, messageCount: msgs.length, messages: msgs });
    } catch (err) {
      groupData.push({ group: chat.name, messageCount: 0, error: err.message });
    }
  }

  const activeGroupIds = groupData.filter(g => g.messages?.length).map(g => g.chatId);
  await Promise.all(activeGroupIds.map(id => populateNamesFromMembers(id)));
  for (const g of groupData) {
    for (const m of (g.messages || [])) {
      for (const mention of (m.mentions || [])) {
        if (mention.id && mention.name) nameCache.set(mention.id, mention.name);
      }
    }
  }

  const output = [];
  for (const g of groupData) {
    if (g.messageCount === 0) {
      output.push({ group: g.group, messageCount: 0 });
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
      group: g.group,
      messageCount: g.messageCount,
      formatted: lines.join('\n'),
    });
  }

  const json = JSON.stringify(output, null, 2);
  if (args.out) {
    const outDir = path.dirname(args.out);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json);
    console.error(`Written to ${args.out}`);
  } else {
    console.log(json);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
