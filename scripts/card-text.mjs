// Adapted from zylos-lark's pure card-text walker. Never log private card data.
// Read APIs must request card_msg_content_type=user_card_content first.
export function extractInteractiveText(input) {
  let content = input;
  try { if (typeof content === 'string') content = JSON.parse(content); } catch { return '[interactive message]'; }
  function extract(root) {
    const parts = [];
    let visited = 0;
    const push = value => { if (typeof value === 'string' && value.trim()) parts.push(value); };
    function walk(node, depth = 0) {
      if (!node || depth > 100 || ++visited > 5000) return;
      if (Array.isArray(node)) { for (const child of node) walk(child, depth + 1); return; }
      if (typeof node !== 'object') return;
      switch (node.tag) {
        case 'markdown': case 'lark_md': case 'plain_text': push(node.content ?? node.text?.content); break;
        case 'text': push(typeof node.text === 'string' ? node.text : node.text?.content); break;
        case 'div':
          push(node.text?.content);
          if (Array.isArray(node.fields)) for (const field of node.fields) push(field?.text?.content);
          break;
        default: push(node.text?.content);
      }
      if (node.elements) walk(node.elements, depth + 1);
      if (Array.isArray(node.columns)) for (const col of node.columns) walk(col?.elements, depth + 1);
      if (node.actions) walk(node.actions, depth + 1);
    }
    walk(root?.body?.elements);
    if (!parts.length) walk(root?.elements);
    const title = root?.title || root?.header?.title?.content;
    if (parts.length && typeof title === 'string' && title.trim() && !parts.includes(title)) parts.unshift(title);
    return parts.join('\n');
  }
  try {
    if (content?.user_dsl) {
      try {
        const dsl = typeof content.user_dsl === 'string' ? JSON.parse(content.user_dsl) : content.user_dsl;
        const text = extract(dsl);
        if (text) return text;
      } catch { /* Malformed DSL must not hide a usable legacy body. */ }
    }
    const text = extract(content);
    if (text) return text;
    const title = content?.title || content?.header?.title?.content;
    if (typeof title === 'string' && title.trim()) return `[card] ${title}`;
  } catch { /* A malformed shape is unreadable, not an excuse to expose raw JSON. */ }
  return '[interactive message]';
}
