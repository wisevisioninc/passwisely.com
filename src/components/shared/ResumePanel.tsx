import {
  BriefcaseBusiness,
  ClipboardCheck,
  Copy,
  FileText,
  Globe2,
  Loader2,
  Save,
  Sparkles,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useState } from "react";

import type {
  ResumeAction,
  ResumeDocument,
  ResumeResult,
} from "../../../electron/resumeTypes";
import { useToast } from "../../contexts/toast";

const ACTION_LABELS: Record<ResumeAction, string> = {
  review: "优化建议",
  optimize: "优化版简历",
  interview: "面试准备",
};

export function ResumePanel() {
  const [resumeDocument, setResumeDocument] = useState<ResumeDocument | null>(
    null,
  );
  const [resumeText, setResumeText] = useState("");
  const [resumeUrl, setResumeUrl] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [loadingSource, setLoadingSource] = useState<"file" | "url" | null>(
    null,
  );
  const [processingAction, setProcessingAction] =
    useState<ResumeAction | null>(null);
  const [result, setResult] = useState<ResumeResult | null>(null);
  const { showToast } = useToast();

  const applyDocument = (document: ResumeDocument) => {
    setResumeDocument(document);
    setResumeText(document.text);
    setResult(null);
    showToast(
      "简历已读取",
      `已从 ${document.name} 提取 ${document.characterCount.toLocaleString()} 个字符。`,
      "success",
    );
  };

  const chooseFile = async () => {
    setLoadingSource("file");
    try {
      const response = await window.electronAPI.selectResumeFile();
      if (response.canceled) return;
      if (!response.success || !response.document) {
        throw new Error(response.error || "无法读取简历文件。");
      }
      applyDocument(response.document);
    } catch (error) {
      showToast(
        "读取失败",
        error instanceof Error ? error.message : "无法读取简历文件。",
        "error",
      );
    } finally {
      setLoadingSource(null);
    }
  };

  const loadUrl = async () => {
    if (!resumeUrl.trim()) {
      showToast("缺少 URL", "请输入公开可访问的网页简历地址。", "neutral");
      return;
    }
    setLoadingSource("url");
    try {
      const response = await window.electronAPI.loadResumeUrl(resumeUrl.trim());
      if (!response.success || !response.document) {
        throw new Error(response.error || "无法读取网页简历。");
      }
      applyDocument(response.document);
    } catch (error) {
      showToast(
        "网页读取失败",
        error instanceof Error ? error.message : "无法读取网页简历。",
        "error",
      );
    } finally {
      setLoadingSource(null);
    }
  };

  const runAction = async (action: ResumeAction) => {
    if (resumeText.trim().length < 20) {
      showToast("缺少简历", "请先上传简历或粘贴简历文字。", "neutral");
      return;
    }
    if (action === "interview" && !jobDescription.trim()) {
      showToast(
        "缺少 Job Description",
        "请粘贴目标岗位描述后再生成针对性面试建议。",
        "neutral",
      );
      return;
    }

    setProcessingAction(action);
    try {
      const response = await window.electronAPI.processResume({
        action,
        resumeText: resumeText.trim(),
        jobDescription: jobDescription.trim() || undefined,
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || "AI 处理失败。");
      }
      setResult(response.data);
      showToast(
        ACTION_LABELS[action],
        `${response.data.provider} / ${response.data.model} 已完成处理。`,
        "success",
      );
    } catch (error) {
      showToast(
        "处理失败",
        error instanceof Error ? error.message : "AI 处理失败。",
        "error",
      );
    } finally {
      setProcessingAction(null);
    }
  };

  const copyResult = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.content);
      showToast("已复制", "结果已复制到剪贴板。", "success");
    } catch {
      showToast("复制失败", "无法访问系统剪贴板。", "error");
    }
  };

  const saveResult = async () => {
    if (!result) return;
    const response = await window.electronAPI.saveResumeResult({
      content: result.content,
      suggestedName: `PassWisely-${ACTION_LABELS[result.action]}`,
    });
    if (response.canceled) return;
    showToast(
      response.success ? "保存成功" : "保存失败",
      response.success
        ? response.path || "结果已保存。"
        : response.error || "无法保存结果。",
      response.success ? "success" : "error",
    );
  };

  const busy = Boolean(loadingSource || processingAction);

  return (
    <div className="max-h-[680px] overflow-y-auto p-3 text-white/90">
      <div className="mb-3 flex items-start gap-2 border-b border-white/10 pb-3">
        <div className="rounded-lg bg-cyan-400/10 p-2 text-cyan-300">
          <FileText className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-[13px] font-semibold">Resume</h3>
          <p className="mt-0.5 text-[9px] leading-relaxed text-white/45">
            简历优化、完整改写与针对性面试准备
          </p>
        </div>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-medium">1. 导入简历</h4>
          {resumeDocument && (
            <span className="max-w-[210px] truncate text-[9px] text-emerald-300">
              {resumeDocument.name} · {resumeText.length.toLocaleString()} 字符
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={chooseFile}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-cyan-300/25 bg-cyan-400/[0.08] px-3 py-2 text-[10px] text-cyan-100 transition-colors hover:bg-cyan-400/[0.13] disabled:opacity-50"
        >
          {loadingSource === "file" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          上传 Word / PDF / HTML
        </button>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Globe2 className="absolute left-2 top-2.5 h-3 w-3 text-white/35" />
            <input
              type="url"
              value={resumeUrl}
              onChange={(event) => setResumeUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void loadUrl();
              }}
              placeholder="公开网页简历 URL"
              className="w-full rounded-lg bg-white/[0.06] py-2 pl-7 pr-2 text-[10px] outline-none ring-1 ring-white/10 focus:ring-cyan-300/50"
            />
          </div>
          <button
            type="button"
            onClick={loadUrl}
            disabled={busy}
            className="rounded-lg bg-white/10 px-3 text-[10px] hover:bg-white/15 disabled:opacity-50"
          >
            {loadingSource === "url" ? "读取中…" : "读取"}
          </button>
        </div>
        <textarea
          value={resumeText}
          onChange={(event) => {
            setResumeText(event.target.value);
            setResult(null);
          }}
          placeholder="也可以直接粘贴简历全文…"
          className="h-32 w-full resize-y rounded-lg bg-white/[0.06] p-2.5 text-[10px] leading-relaxed outline-none ring-1 ring-white/10 focus:ring-cyan-300/50"
        />
      </section>

      <section className="mt-4 space-y-2">
        <div className="flex items-center gap-1.5">
          <BriefcaseBusiness className="h-3.5 w-3.5 text-amber-300" />
          <h4 className="text-[11px] font-medium">
            2. Job Description（面试建议必填）
          </h4>
        </div>
        <textarea
          value={jobDescription}
          onChange={(event) => setJobDescription(event.target.value)}
          placeholder="粘贴目标岗位职责、要求和技术栈…"
          className="h-24 w-full resize-y rounded-lg bg-white/[0.06] p-2.5 text-[10px] leading-relaxed outline-none ring-1 ring-white/10 focus:ring-amber-300/50"
        />
      </section>

      <section className="mt-4 space-y-2">
        <h4 className="text-[11px] font-medium">3. 选择处理方式</h4>
        <div className="grid grid-cols-3 gap-1.5">
          <ActionButton
            icon={<ClipboardCheck className="h-3.5 w-3.5" />}
            label="优化意见"
            loading={processingAction === "review"}
            disabled={busy}
            onClick={() => runAction("review")}
          />
          <ActionButton
            icon={<WandSparkles className="h-3.5 w-3.5" />}
            label="一键优化"
            loading={processingAction === "optimize"}
            disabled={busy}
            featured
            onClick={() => runAction("optimize")}
          />
          <ActionButton
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label="面试准备"
            loading={processingAction === "interview"}
            disabled={busy}
            onClick={() => runAction("interview")}
          />
        </div>
      </section>

      {result && (
        <section className="mt-4 overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div>
              <h4 className="text-[11px] font-medium">
                {ACTION_LABELS[result.action]}
              </h4>
              <p className="text-[8px] text-white/40">
                {result.provider} · {result.model}
              </p>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={copyResult}
                className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-[9px] hover:bg-white/15"
              >
                <Copy className="h-3 w-3" />
                复制
              </button>
              <button
                type="button"
                onClick={saveResult}
                className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-[9px] hover:bg-white/15"
              >
                <Save className="h-3 w-3" />
                保存
              </button>
            </div>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 font-sans text-[10px] leading-relaxed text-white/85">
            {result.content}
          </pre>
        </section>
      )}

      <p className="mt-3 text-[8px] leading-relaxed text-white/30">
        原始文件不会被覆盖；缺失信息会标记为“待补充”。
      </p>
    </div>
  );
}

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  loading: boolean;
  disabled: boolean;
  featured?: boolean;
  onClick: () => void;
}

function ActionButton({
  icon,
  label,
  loading,
  disabled,
  featured = false,
  onClick,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-[9px] transition-colors disabled:opacity-50 ${
        featured
          ? "border-cyan-300/25 bg-cyan-400/[0.12] text-cyan-100 hover:bg-cyan-400/[0.18]"
          : "border-white/10 bg-white/[0.05] text-white/70 hover:bg-white/10"
      }`}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}
