import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { dracula } from "react-syntax-highlighter/dist/esm/styles/prism";

export type SolutionData = {
  code?: string; thoughts?: string[]; time_complexity?: string; space_complexity?: string;
  alternatives?: string[]; isStreaming?: boolean; error?: string; model?: string;
};

export default function SolutionPanel({ data, language }: { data?: SolutionData | null; language: string }) {
  const pending = !data || data.isStreaming;
  const section = (title: string, content: React.ReactNode) => <section className="space-y-2"><h2 className="text-[13px] font-medium text-white">{title}</h2><div className="text-[13px] leading-relaxed text-gray-100">{content}</div></section>;
  return <div className="space-y-4" aria-busy={Boolean(pending)}>
    <div className="flex items-center justify-between gap-3 text-xs text-gray-300">
      <span role="status" aria-live="polite">{data?.error ? "生成未完成" : pending ? "正在生成，代码尚未完成…" : "解答已完成"}{data?.model ? ` · ${data.model}` : ""}</span>
      {pending && <button className="rounded border border-white/30 px-2 py-1 hover:bg-white/10" onClick={() => window.electronAPI.cancelProcessing()}>停止生成</button>}
    </div>
    {data?.error && <p role="alert" className="rounded border border-amber-400/50 bg-amber-950/70 p-2 text-xs text-amber-100">{data.error} 当前代码可能不完整，请重新生成后使用。</p>}
    {section("1. 简短思路", data?.thoughts?.length ? data.thoughts.map((text, i) => <p key={i}>{text}</p>) : <span className="text-gray-400">{pending ? "等待首段内容…" : "未提供"}</span>)}
    {section("2. 时间与空间复杂度", <div className="space-y-1"><p>时间复杂度：{data?.time_complexity || (pending ? "生成中…" : "未提供")}</p><p>空间复杂度：{data?.space_complexity || (pending ? "生成中…" : "未提供")}</p></div>)}
    {section("3. 完整代码", data?.code ? pending || data.error ? <pre className="overflow-x-auto rounded bg-slate-950/60 p-3 font-mono text-xs whitespace-pre-wrap">{data.code}</pre> : <SyntaxHighlighter language={language === "golang" ? "go" : language} style={dracula} showLineNumbers wrapLongLines customStyle={{ margin: 0, padding: "0.75rem", background: "rgba(22,27,34,.5)" }}>{data.code}</SyntaxHighlighter> : <span className="text-gray-400">{pending ? "生成中…" : "未提供代码"}</span>)}
    {section("4. 其他解法", data?.alternatives?.length ? data.alternatives.map((text, i) => <p key={i}>{text}</p>) : <span className="text-gray-400">{pending ? "生成中…" : "暂无值得补充的其他解法。"}</span>)}
  </div>;
}
