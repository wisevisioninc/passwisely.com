// Incremental SSE decoding shared by the website and the gRPC relay.
export async function* readSSE(body, signal) {
  if (!body) throw new Error('上游没有返回数据流。');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', data = [], event = '', total = 0, ended = false;
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const item = await reader.read();
      signal?.throwIfAborted();
      if (item.done) { ended = true; buffer += decoder.decode(); }
      else {
        total += item.value.byteLength;
        if (total > 12 * 1024 * 1024) throw new Error('上游响应过大。');
        buffer += decoder.decode(item.value, { stream: true });
      }
      let match;
      while ((match = /\r\n|\r|\n/.exec(buffer))) {
        if (!ended && match[0] === '\r' && match.index === buffer.length - 1) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (!line) {
          if (data.length) yield { event, data: data.join('\n') };
          data = []; event = '';
        } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        else if (line.startsWith('event:')) event = line.slice(6).replace(/^ /, '');
        if (data.reduce((n, s) => n + s.length, 0) > 1024 * 1024) throw new Error('上游事件过大。');
      }
      if (buffer.length > 1024 * 1024) throw new Error('上游事件过大。');
      if (ended) break;
    }
    // Unterminated events are deliberately not accepted as a completed answer.
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!ended) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function encodeSSE(value, event = '') {
  return new TextEncoder().encode(`${event ? `event: ${event}\n` : ''}data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`);
}
