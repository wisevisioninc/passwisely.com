import {
  ArrowLeft,
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
import { useEffect, useRef, useState } from "react";

import type {
  ResumeAction,
  ResumeDocument,
  ResumeResult,
} from "../../electron/resumeTypes";
import { useToast } from "../contexts/toast";

interface ResumeAssistantProps {
  onClose: () => void;
}

const ACTION_LABELS: Record<ResumeAction, string> = {
  review: "优化建议",
  optimize: "优化版简历",
  interview: "面试准备",
};

const ResumeAssistant: React.FC<ResumeAssistantProps> = ({ onClose }) => {
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
  const containerRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (!containerRef.current) return;
    const updateDimensions = () => {
      const height = Math.min(containerRef.current?.scrollHeight || 720, 820);
      void window.electronAPI.updateContentDimensions({ width: 680, height });
    };
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(containerRef.current);
    updateDimensions();
    return () => observer.disconnect();
  }, [result, resumeDocument]);

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
    if (response.success) {
      showToast("保存成功", response.path || "结果已保存。", "success");
    } else {
      showToast("保存失败", response.error || "无法保存结果。", "error");
    }
  };

  const busy = Boolean(loadingSource || processingAction);

  return (
    <div ref={containerRef} className="w-[680px] p-4 text-white">
      <div className="overflow-hidden rounded-xl border border-white/10 bg-black/90 shadow-2xl backdrop-blur-xl">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-blue-500/20 p-2 text-blue-300">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold">简历助手</h1>
              <p className="text-[10px] text-white/45">
                简历优化、完整改写与针对性面试准备
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="返回截图助手"
            className="flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1.5 text-[10px] text-white/70 hover:bg-white/15"
          >
            <ArrowLeft className="h-3 w-3" />
            返回
          </button>
        </header>

        <div className="max-h-[730px] space-y-4 overflow-y-auto p-4">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium">1. 导入简历</h2>
              {resumeDocument && (
                <span className="max-w-[360px] truncate text-[9px] text-green-300">
                  {resumeDocument.name} · {resumeText.length.toLocaleString()} 字符
                </span>
              )}
            </div>
            <div className="grid grid-cols-[170px_1fr] gap-2">
              <button
                type="button"
                onClick={chooseFile}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-blue-400/30 bg-blue-500/10 px-3 py-2 text-[10px] text-blue-200 hover:bg-blue-500/15 disabled:opacity-50"
              >
                {loadingSource === "file" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Word (.doc/.docx) / PDF / HTML
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
                    placeholder="https://example.com/resume"
                    className="w-full rounded-lg bg-white/5 py-2 pl-7 pr-2 text-[10px] outline-none ring-1 ring-white/10 focus:ring-blue-400/50"
                  />
                </div>
                <button
                  type="button"
                  onClick={loadUrl}
                  disabled={busy}
                  className="rounded-lg bg-white/10 px-3 text-[10px] hover:bg-white/15 disabled:opacity-50"
                >
                  {loadingSource === "url" ? "读取中…" : "读取网页"}
                </button>
              </div>
            </div>
            <textarea
              value={resumeText}
              onChange={(event) => {
                setResumeText(event.target.value);
                setResult(null);
              }}
              placeholder="上传后会在这里显示提取内容，也可以直接粘贴简历文字。请检查 PDF 换行和表格提取是否正确；纯图片扫描 PDF 请先进行 OCR。"
              className="h-44 w-full resize-y rounded-lg bg-white/5 p-3 text-[10px] leading-relaxed text-white/85 outline-none ring-1 ring-white/10 focus:ring-blue-400/50"
            />
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <BriefcaseBusiness className="h-3.5 w-3.5 text-amber-300" />
              <h2 className="text-xs font-medium">
                2. Job Description（面试建议必填）
              </h2>
            </div>
            <textarea
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
              placeholder="粘贴目标岗位的职责、任职要求和技术栈。优化建议和一键优化也会参考此内容。"
              className="h-28 w-full resize-y rounded-lg bg-white/5 p-3 text-[10px] leading-relaxed text-white/85 outline-none ring-1 ring-white/10 focus:ring-amber-400/50"
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-medium">3. 选择处理方式</h2>
            <div className="grid grid-cols-3 gap-2">
              <ActionButton
                icon={<ClipboardCheck className="h-4 w-4" />}
                title="给出优化意见"
                description="问题排序、ATS、量化与改写示例"
                loading={processingAction === "review"}
                disabled={busy}
                onClick={() => runAction("review")}
              />
              <ActionButton
                icon={<WandSparkles className="h-4 w-4" />}
                title="一键优化简历"
                description="保留事实，生成可直接使用的完整版本"
                loading={processingAction === "optimize"}
                disabled={busy}
                featured
                onClick={() => runAction("optimize")}
              />
              <ActionButton
                icon={<Sparkles className="h-4 w-4" />}
                title="面试准备建议"
                description="匹配 JD，预测问题并给出准备计划"
                loading={processingAction === "interview"}
                disabled={busy}
                onClick={() => runAction("interview")}
              />
            </div>
          </section>

          {result && (
            <section className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                <div>
                  <h2 className="text-xs font-medium">
                    {ACTION_LABELS[result.action]}
                  </h2>
                  <p className="text-[9px] text-white/40">
                    {result.provider} · {result.model}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={copyResult}
                    className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-[9px] hover:bg-white/15"
                  >
                    <Copy className="h-3 w-3" />复制
                  </button>
                  <button
                    type="button"
                    onClick={saveResult}
                    className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-[9px] hover:bg-white/15"
                  >
                    <Save className="h-3 w-3" />保存
                  </button>
                </div>
              </div>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-3 font-sans text-[10px] leading-relaxed text-white/85">
                {result.content}
              </pre>
            </section>
          )}

          <p className="text-[9px] leading-relaxed text-white/35">
            PassWisely 不会自动覆盖原始文件。AI 被要求保留事实，不得编造公司、日期、技能或业绩；缺失信息会以“待补充”标记。
          </p>
        </div>
      </div>
    </div>
  );
};

interface ActionButtonProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  loading: boolean;
  disabled: boolean;
  featured?: boolean;
  onClick: () => void;
}

const ActionButton: React.FC<ActionButtonProps> = ({
  icon,
  title,
  description,
  loading,
  disabled,
  featured = false,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
      featured
        ? "border-blue-400/30 bg-blue-500/15 hover:bg-blue-500/20"
        : "border-white/10 bg-white/5 hover:bg-white/10"
    }`}
  >
    <div className="mb-2 text-blue-300">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
    </div>
    <div className="text-[10px] font-medium">{title}</div>
    <div className="mt-1 text-[9px] leading-relaxed text-white/40">
      {description}
    </div>
  </button>
);

export default ResumeAssistant;
