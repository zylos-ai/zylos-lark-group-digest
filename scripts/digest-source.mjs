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

export async function listGroups(client) {
  const result = await collectPages(async pageToken => {
    const data = await client.get('/open-apis/im/v1/chats', {
      page_size: 100, sort_type: 'ByCreateTimeAsc', ...(pageToken ? { page_token: pageToken } : {}),
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

export async function fetchGroups(client, chats, start, end) {
  const groups = [];
  for (const chat of chats) {
    const result = await listMessages(client, chat.id, start, end);
    groups.push({
      group: chat.name, chatId: chat.id,
      status: result.success ? 'ok' : 'error',
      messageCount: result.messages.length, messages: result.messages,
      ...(!result.success ? { error: result.message } : {}),
    });
  }
  return groups;
}
