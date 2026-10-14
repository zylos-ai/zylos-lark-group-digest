import { collectPages } from './pagination.mjs';
import { AuthorizationRequired } from './user-client.mjs';

export function mapMessage(msg) {
  return {
    id: msg.message_id, type: msg.msg_type, content: msg.body?.content || '',
    sender: msg.sender?.id, senderName: msg.sender?.sender_name,
    senderType: msg.sender?.sender_type,
    createTime: new Date(Number(msg.create_time)).toISOString(), mentions: msg.mentions || [],
  };
}

export async function listGroups(client, { fullScan = false } = {}) {
  const result = await collectPages(async pageToken => {
    const data = await client.get('/open-apis/im/v1/chats', {
      page_size: 100, sort_type: fullScan ? 'ByCreateTimeAsc' : 'ByActiveTimeDesc', ...(pageToken ? { page_token: pageToken } : {}),
    });
    if (!Array.isArray(data.items)) throw new Error('Group listing returned no items array');
    return {
      success: true, messages: data.items.map(chat => ({ ...chat, id: chat.chat_id })),
      hasMore: data.has_more, nextPageToken: data.page_token,
    };
  });
  if (!result.success) throw new Error(`Incomplete group listing: ${result.message}`);
  return result.messages;
}

export async function listMessages(client, chatId, start, end) {
  return collectPages(async pageToken => {
    try {
      const data = await client.get('/open-apis/im/v1/messages', {
        container_id_type: 'chat', container_id: chatId, page_size: 50,
        sort_type: 'ByCreateTimeAsc', with_sender_name: true,
        card_msg_content_type: 'user_card_content',
        start_time: String(start), end_time: String(end),
        ...(pageToken ? { page_token: pageToken } : {}),
      });
      if (!Array.isArray(data.items)) throw new Error('Message listing returned no items array');
      return { success: true, messages: data.items.map(mapMessage), hasMore: data.has_more, nextPageToken: data.page_token };
    } catch (err) {
      if (err instanceof AuthorizationRequired) throw err;
      return { success: false, message: err.message, code: err.code };
    }
  });
}

// Probe only window-empty groups. No end_time: activity after the digest window
// must prevent an idle streak. Do not add this message's content to the digest.
export async function activitySinceStart(client, chatId, start) {
  const data = await client.get('/open-apis/im/v1/messages', {
    container_id_type: 'chat', container_id: chatId, page_size: 1,
    sort_type: 'ByCreateTimeDesc', start_time: String(start),
  });
  if (!Array.isArray(data.items) || (data.items.length === 0 && data.has_more)) {
    throw new Error('Activity probe returned an incomplete response');
  }
  return data.items.length > 0;
}

export async function fetchGroups(client, chats, start, end, { fullScan = false } = {}) {
  const groups = [];
  let emptyStreak = 0;
  for (const chat of chats) {
    if (!fullScan && emptyStreak >= 3) {
      groups.push({ group: chat.name, chatId: chat.id, status: 'skipped', messageCount: null,
        skippedReason: 'three_consecutive_idle_groups', messages: [] });
      continue;
    }
    const result = await listMessages(client, chat.id, start, end);
    let activityCheck;
    let activityCheckError;
    if (!fullScan && result.success && result.messages.length === 0) {
      try {
        const active = await activitySinceStart(client, chat.id, start);
        activityCheck = active ? 'active_since_start' : 'idle_since_start';
        emptyStreak = active ? 0 : emptyStreak + 1;
      } catch (err) {
        if (err instanceof AuthorizationRequired) throw err;
        activityCheck = 'unavailable';
        activityCheckError = err.message;
        emptyStreak = 0;
      }
    } else {
      // Failed or nonempty window reads cannot count towards an idle streak.
      emptyStreak = 0;
    }
    groups.push({
      group: chat.name, chatId: chat.id,
      status: result.success ? 'ok' : 'error',
      messageCount: result.messages.length, messages: result.messages,
      ...(!result.success ? { error: result.message } : {}),
      ...(activityCheck ? { activityCheck } : {}),
      ...(activityCheckError ? { activityCheckError } : {}),
    });
  }
  return groups;
}
