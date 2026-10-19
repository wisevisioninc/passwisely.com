import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import Queue from "../_pages/Queue";
import Solutions from "../_pages/Solutions";
import LiveWorkspace from "../components/Live/LiveWorkspace";
import { CaptureStatusNotice } from "../components/Live/CaptureStatusNotice";
import type { LiveSnapshot } from "../../electron/live/types";
import { useToast } from "../contexts/toast";

type SolutionPayload = {
  code: string;
  thoughts: string[];
  time_complexity: string;
  space_complexity: string;
  alternatives: string[];
};

function normalizeSolutionPayload(data: any): SolutionPayload | null {
  if (!data || typeof data.code !== "string" || !data.code.trim()) return null;
  return {
    code: data.code.trim(),
    alternatives: Array.isArray(data.alternatives) ? data.alternatives.filter((item: unknown) => typeof item === "string") : [],
    thoughts: Array.isArray(data.thoughts)
      ? data.thoughts.filter((item: unknown) => typeof item === "string")
      : [],
    time_complexity:
      typeof data.time_complexity === "string"
        ? data.time_complexity
        : "未提供",
    space_complexity:
      typeof data.space_complexity === "string"
        ? data.space_complexity
        : "未提供",
  };
}

interface SubscribedAppProps {
  credits: number;
  currentLanguage: string;
  setLanguage: (language: string) => void;
  currentQuery: string;
  setQuery: (query: string) => void;
}

const SubscribedApp: React.FC<SubscribedAppProps> = ({
  credits,
  currentLanguage,
  setLanguage,
  currentQuery,
  setQuery,
}) => {
  const queryClient = useQueryClient();
  const [workspace, setWorkspace] = useState<"live" | "code">("live");
  const [liveSnapshot, setLiveSnapshot] = useState<LiveSnapshot | null>(null);
  const [view, setView] = useState<"queue" | "solutions" | "debug">("queue");
  const [processingError, setProcessingError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const processingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const { showToast } = useToast();

  useEffect(() => {
    if (workspace === "code") {
      // Live can change the shared screenshot queue while Queue is unmounted.
      void queryClient.invalidateQueries({ queryKey: ["screenshots"] });
    }
  }, [workspace, queryClient]);

  // Keep all initial-processing listeners on this component because it never
  // unmounts during queue -> solutions transitions. This prevents fast success
  // or error events from falling into the listener gap between both pages.
  useEffect(() => {
    const clearProcessingTimeout = () => {
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }
    };
    let activeInitial = false, activeDebug = false;
    const markIncomplete = (message: string) => {
      clearProcessingTimeout();
      const key = activeDebug ? "new_solution" : "solution";
      activeInitial = false; activeDebug = false;
      const previous = queryClient.getQueryData([key]) as any;
      queryClient.setQueryData([key], { ...previous, isStreaming: false, error: message });
      setView("solutions");
    };
    const cleanupFunctions = [
      window.electronAPI.onSolutionStart(() => {
        setWorkspace("code");
        activeInitial = true; activeDebug = false;
        queryClient.setQueryData(["new_solution"], null);
        clearProcessingTimeout();
        setProcessingError("");
        queryClient.setQueryData(["problem_statement"], null);
        queryClient.setQueryData(["solution"], null);
        setView("solutions");
        processingTimeoutRef.current = setTimeout(() => {
          markIncomplete("AI 服务未在规定时间内完成，请重试。");
          void window.electronAPI.cancelProcessing();
        }, 100_000);
      }),
      window.electronAPI.onUnauthorized(() => {
        activeInitial = false; activeDebug = false;
        clearProcessingTimeout();
        queryClient.removeQueries({ queryKey: ["screenshots"] });
        queryClient.removeQueries({ queryKey: ["solution"] });
        queryClient.removeQueries({ queryKey: ["new_solution"] });
        queryClient.removeQueries({ queryKey: ["problem_statement"] });
        setView("queue");
      }),
      window.electronAPI.onResetView(() => {
        activeInitial = false; activeDebug = false;
        clearProcessingTimeout();
        setProcessingError("");
        queryClient.removeQueries({ queryKey: ["screenshots"] });
        queryClient.removeQueries({ queryKey: ["solution"] });
        queryClient.removeQueries({ queryKey: ["new_solution"] });
        queryClient.removeQueries({ queryKey: ["problem_statement"] });
        setView("queue");
      }),
      window.electronAPI.onProblemExtracted((data: any) => {
        if (typeof data?.problem_statement === "string") {
          queryClient.setQueryData(["problem_statement"], data);
        }
      }),
      window.electronAPI.onSolutionSuccess((data: any) => {
        if (!activeInitial) return;
        clearProcessingTimeout();
        const solution = normalizeSolutionPayload(data);
        if (!solution) {
          markIncomplete("AI 返回的解答不完整，请重试。");
          return;
        }
        activeInitial = false;
        queryClient.setQueryData(["solution"], { ...solution, isStreaming: false, model: (queryClient.getQueryData(["solution"]) as any)?.model });
        setView("solutions");
      }),
      window.electronAPI.onSolutionProgress((update) => {
        if (update.phase === "initial" ? !activeInitial : !activeDebug) return;
        queryClient.setQueryData([update.phase === "debug" ? "new_solution" : "solution"], { ...update.data, isStreaming: true, model: update.model });
      }),
      window.electronAPI.onProcessingCancelled(() => {
        if (activeInitial || activeDebug) markIncomplete("已停止生成。");
      }),
      window.electronAPI.onSolutionError((error: string) => {
        if (!activeInitial) return;
        markIncomplete(error?.trim() || "处理失败，请重试。");
      }),
      window.electronAPI.onDebugStart(() => {
        setWorkspace("code");
        clearProcessingTimeout();
        activeDebug = true; activeInitial = false;
        processingTimeoutRef.current = setTimeout(() => {
          markIncomplete("AI 服务未在规定时间内完成，请重试。");
          void window.electronAPI.cancelProcessing();
        }, 100_000);
        queryClient.setQueryData(["new_solution"], { isStreaming: true });
      }),
      window.electronAPI.onDebugSuccess((data: any) => {
        if (!activeDebug) return;
        const solution = normalizeSolutionPayload(data);
        if (!solution) { markIncomplete("AI 返回的解答不完整，请重试。"); return; }
        activeDebug = false;
        clearProcessingTimeout();
        queryClient.setQueryData(["new_solution"], { ...solution, isStreaming: false, model: (queryClient.getQueryData(["new_solution"]) as any)?.model });
      }),
      window.electronAPI.onDebugError((error: string) => {
        if (activeDebug) markIncomplete(error || "处理失败，请重试。");
      }),
    ];
    return () => {
      clearProcessingTimeout();
      cleanupFunctions.forEach((fn) => fn());
    };
  }, [queryClient, showToast]);

  return (
    <div ref={containerRef} className="pw-workspace-shell min-h-0">
      {workspace === "code" && <nav className="pw-code-return" aria-label="编程模式">
        <button type="button" onClick={() => setWorkspace("live")}><Radio size={13} aria-hidden="true" />Back to conversation / 返回会话</button>
        <CaptureStatusNotice snapshot={liveSnapshot} onReturn={() => setWorkspace("live")} />
      </nav>}
      <LiveWorkspace visible={workspace === "live"} onSnapshot={setLiveSnapshot} onProgramming={() => setWorkspace("code")} credits={credits} />
      {workspace === "code" && view === "queue" && processingError && (
        <div
          role="alert"
          className="mx-4 mt-3 flex max-w-xl items-start justify-between gap-3 rounded-lg border border-red-300/30 bg-red-950/80 px-3 py-2 text-xs text-red-50 shadow-lg backdrop-blur-xl"
        >
          <span>{processingError}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            className="shrink-0 text-red-100/70 hover:text-white"
            onClick={() => setProcessingError("")}
          >
            ×
          </button>
        </div>
      )}
      {workspace === "code" && (view === "queue" ? (
        <Queue
          setView={(nextView) => setView(nextView)}
          credits={credits}
          currentLanguage={currentLanguage}
          setLanguage={setLanguage}
          currentQuery={currentQuery}
          setQuery={setQuery}
        />
      ) : view === "solutions" ? (
        <Solutions
          setView={(nextView) => setView(nextView)}
          credits={credits}
          currentLanguage={currentLanguage}
          setLanguage={setLanguage}
          currentQuery={currentQuery}
          setQuery={setQuery}
        />
      ) : null)}
    </div>
  );
};

export default SubscribedApp;
