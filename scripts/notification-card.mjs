/** Pure Card 2.0 preview builder. No network, credentials, or delivery side effects. */
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value;
}
function text(value, field, max = 300) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b-\x1f\x7f]/.test(value)) {
    throw new Error(`${field} must be nonempty text of at most ${max} characters`);
  }
  return value.trim();
}
function count(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a nonnegative safe integer`);
  return value;
}
// Data is plain text: prevent links, formatting, tags, and native mentions.
function escapeMarkdown(value) {
  return value.replace(/[\\`*_{}\[\]()#+.!|~\-]/g, '\\$&')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/@/g, '&#64;');
}
function items(value, field) {
  if (!Array.isArray(value) || value.length > 3) throw new Error(`${field} must contain at most 3 items`);
  return value.map((item, index) => {
    object(item, `${field}[${index}]`);
    return `**${escapeMarkdown(text(item.title, `${field}[${index}].title`, 80))}**\n${escapeMarkdown(text(item.detail, `${field}[${index}].detail`))}`;
  }).join('\n\n');
}
const markdown = content => ({ tag: 'markdown', content });
function block(title, content, color) {
  return { tag: 'column_set', flex_mode: 'none', columns: [{
    tag: 'column', width: 'weighted', weight: 1, background_style: color,
    padding: '12px', vertical_spacing: '8px',
    elements: [markdown(`**${title}**`), markdown(content)],
  }] };
}

export function buildNotificationCard(input) {
  object(input, 'input');
  const title = text(input.title, 'title', 80);
  const window = text(input.window, 'window', 80);
  // Access wording is explicit operator input, not a privacy assertion by this builder.
  const accessLabel = input.accessLabel === undefined ? '' : text(input.accessLabel, 'accessLabel', 80);
  let url;
  try { url = new URL(input.url); } catch { throw new Error('url must be an HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('url must be an HTTPS URL without credentials');
  const stats = object(input.stats, 'stats');
  for (const key of ['discovered', 'scanned', 'active', 'messages', 'errors']) count(stats[key], `stats.${key}`);
  if (stats.scanned > stats.discovered || stats.active > stats.scanned || stats.errors > stats.scanned) {
    throw new Error('group counts are inconsistent');
  }
  const images = object(input.images, 'images');
  for (const key of ['references', 'viewed', 'unavailable', 'pending']) count(images[key], `images.${key}`);
  if (images.viewed + images.unavailable + images.pending !== images.references) throw new Error('image counts must account for every reference');
  const attention = items(input.attention === undefined ? [] : input.attention, 'attention');
  const highlights = items(input.highlights === undefined ? [] : input.highlights, 'highlights');
  const elements = [{ tag: 'column_set', flex_mode: 'none', horizontal_spacing: '8px', columns:
    [[stats.scanned, '已扫描群'], [stats.active, '有消息群'], [stats.messages, '消息条数']].map(([value, label]) => ({
      tag: 'column', width: 'weighted', weight: 1, background_style: 'blue-50', padding: '12px', vertical_spacing: '4px',
      elements: [{ ...markdown(`## ${value}`), text_align: 'center' },
        { ...markdown(`<font color='grey'>${label}</font>`), text_align: 'center', text_size: 'notation' }],
    })),
  }];
  if (attention) elements.push(block('需要你核对', attention, 'violet-50'));
  if (highlights) elements.push(block('值得关注的动态', highlights, 'blue-50'));
  elements.push(block('覆盖与阅读情况',
    `发现 ${stats.discovered} 群，扫描 ${stats.scanned} 群，另有 **${stats.discovered - stats.scanned} 群未扫描**；群读取错误 ${stats.errors}。\n` +
    `${images.references} 个图片引用中，${images.viewed} 个已查看，${images.unavailable} 个不可用，${images.pending} 个尚未查看。`, 'grey-50'));
  elements.push({ tag: 'button', text: { tag: 'plain_text', content: `查看完整摘要${accessLabel ? ` · ${accessLabel}` : ''}` },
    type: 'primary_filled', width: 'fill', behaviors: [{ type: 'open_url', default_url: url.href }] });
  return { schema: '2.0', config: { width_mode: 'default', enable_forward: false,
    summary: { content: `${title}｜${input.attention?.length ?? 0} 项待核对 · ${stats.messages} 条消息` } },
  header: { template: 'blue', title: { tag: 'plain_text', content: title },
    subtitle: { tag: 'plain_text', content: `${window}${accessLabel ? ` · ${accessLabel}` : ''}` } },
  body: { direction: 'vertical', padding: '12px', vertical_spacing: '12px', elements } };
}
