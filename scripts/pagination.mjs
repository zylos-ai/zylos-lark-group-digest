/**
 * Collect every page from a token-based API while preserving first-seen order.
 * The injected fetchPage function receives the current page token (undefined
 * for the first page) and returns:
 * { success, messages, hasMore, nextPageToken, message?, code? }
 */
export async function collectPages(fetchPage, { maxPages = 10_000 } = {}) {
  const messages = [];
  const seenMessageIds = new Set();
  const seenPageTokens = new Set();
  let pageToken;

  for (let pageCount = 1; pageCount <= maxPages; pageCount += 1) {
    const page = await fetchPage(pageToken);
    if (!page.success) {
      return {
        ...page,
        messages,
        pageCount: pageCount - 1,
      };
    }

    for (const message of (page.messages || [])) {
      if (message.id) {
        if (seenMessageIds.has(message.id)) continue;
        seenMessageIds.add(message.id);
      }
      messages.push(message);
    }

    if (!page.hasMore) {
      return { success: true, messages, hasMore: false, pageCount };
    }

    const nextPageToken = page.nextPageToken;
    if (!nextPageToken) {
      return {
        success: false,
        messages,
        pageCount,
        message: 'Pagination response has_more=true but page_token is missing',
      };
    }
    if (seenPageTokens.has(nextPageToken)) {
      return {
        success: false,
        messages,
        pageCount,
        message: 'Pagination returned a repeated page_token',
      };
    }

    seenPageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }

  return {
    success: false,
    messages,
    pageCount: maxPages,
    message: `Pagination exceeded safety limit of ${maxPages} pages`,
  };
}
