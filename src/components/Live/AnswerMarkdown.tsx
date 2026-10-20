import Markdown from "react-markdown";
import type { Components } from "react-markdown";

export function answerExternalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch { return undefined; }
}

const components: Components = {
  a: ({ href, children }) => {
    const url = answerExternalUrl(href);
    if (!url) return <span>{children}</span>;
    return <a data-overlay-interactive href={url} target="_blank" rel="noopener noreferrer" onClick={event => {
      event.preventDefault();
      window.electronAPI.openExternal(url);
    }}>{children}</a>;
  },
  // Generated answers must not load remote tracking images or local resources.
  img: ({ alt }) => alt ? <span className="pw-live-image-description">[图片：{alt}]</span> : null,
};

export function AnswerMarkdown({ text }: { text: string }) {
  return <Markdown skipHtml components={components} urlTransform={value => answerExternalUrl(value) ?? ""}>{text}</Markdown>;
}
