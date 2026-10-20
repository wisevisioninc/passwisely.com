const han = /\p{Script=Han}/u;

/** Recall words are lexical tokens, not necessarily space-delimited words. Keep
 * provider whitespace; only choose separators for boundaries it left implicit. */
export function transcriptTextSeparator(previous: string, next: string): string {
  if (!previous || /\s$/u.test(previous) || /^\s/u.test(next)) return "";
  const last = previous.slice(-2).match(/.$/u)?.[0] || "";
  const first = next.match(/^./u)?.[0] || "";
  if (/^[,.;:!?，。；：！？、)）\]】》」』’”%％…]/u.test(first)) return "";
  if (/[（(\[【《「『‘“]$/u.test(last)) return "";
  if (han.test(last) && /^[“‘「『（【《]/u.test(first)) return "";
  if (/[”’」』）】》]/u.test(last) && han.test(first)) return "";
  // Han words and numeric dates/amounts do not need inter-word spaces. Keep
  // Latin technical terms readable at a Chinese/Latin boundary.
  if (han.test(last) && (han.test(first) || /\d/u.test(first))) return "";
  if (/\d/u.test(last) && han.test(first)) return "";
  if (/[，。；：！？、]/u.test(last)) return "";
  return " ";
}
