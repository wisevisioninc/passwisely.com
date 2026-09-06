import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import Queue from "../_pages/Queue";
import Solutions from "../_pages/Solutions";
import { useToast } from "../contexts/toast";

type SolutionPayload = {
  code: string;
  thoughts: string[];
  time_complexity: string;
  space_complexity: string;
};

function normalizeSolutionPayload(data: any): SolutionPayload | null {
  if (!data || typeof data.code !== "string" || !data.code.trim()) return null;
  return {
    code: data.code.replace(/\\n/g, "\n").trim(),
    thoughts: Array.isArray(data.thoughts)
      ? data.thoughts.filter((item: unknown) => typeof item === "string")
      : [],
    time_complexity:
      typeof data.time_complexity === "string"
        ? data.time_complexity
        : "Not specified",
    space_complexity:
      typeof data.space_complexity === "string"
        ? data.space_complexity
        : "Not specified",
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
  const [view, setView] = useState<"queue" | "solutions" | "debug">("queue");
  const [processingError, setProcessingError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const processingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const { showToast } = useToast();

  // Removed the dynamic window dimension update effect that was causing the overlay.
  /*
  useEffect(() => {
    if (!containerRef.current) return

    const updateDimensions = () => {
      if (!containerRef.current) return
      const height = containerRef.current.scrollHeight
      const width = containerRef.current.scrollWidth
      window.electronAPI?.updateContentDimensions({ width, height })
    }

    const resizeObserver = new ResizeObserver(updateDimensions)
    resizeObserver.observe(containerRef.current)

    const mutationObserver = new MutationObserver(updateDimensions)
    mutationObserver.observe(containerRef.current, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    })

    updateDimensions()

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [view])
  */

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
    const cleanupFunctions = [
      window.electronAPI.onSolutionStart(() => {
        clearProcessingTimeout();
        setProcessingError("");
        queryClient.setQueryData(["problem_statement"], null);
        queryClient.setQueryData(["solution"], null);
        setView("solutions");
        processingTimeoutRef.current = setTimeout(() => {
          queryClient.setQueryData(["solution"], null);
          setView("queue");
          setProcessingError(
            "AI 服务未在规定时间内返回结果，请检查网络后重试。",
          );
          showToast(
            "Processing timed out",
            "The AI service did not finish in time. Please try again.",
            "error",
          );
        }, 100_000);
      }),
      window.electronAPI.onUnauthorized(() => {
        clearProcessingTimeout();
        queryClient.removeQueries({ queryKey: ["screenshots"] });
        queryClient.removeQueries({ queryKey: ["solution"] });
        queryClient.removeQueries({ queryKey: ["problem_statement"] });
        setView("queue");
      }),
      window.electronAPI.onResetView(() => {
        clearProcessingTimeout();
        setProcessingError("");
        queryClient.removeQueries({ queryKey: ["screenshots"] });
        queryClient.removeQueries({ queryKey: ["solution"] });
        queryClient.removeQueries({ queryKey: ["problem_statement"] });
        setView("queue");
      }),
      window.electronAPI.onProblemExtracted((data: any) => {
        if (typeof data?.problem_statement === "string") {
          queryClient.setQueryData(["problem_statement"], data);
        }
      }),
      window.electronAPI.onSolutionSuccess((data: any) => {
        clearProcessingTimeout();
        const solution = normalizeSolutionPayload(data);
        if (!solution) {
          queryClient.setQueryData(["solution"], null);
          setView("queue");
          setProcessingError("AI 返回的解答不完整，请重新尝试。不会丢失当前截图。");
          showToast(
            "Processing Failed",
            "The AI service returned an incomplete solution. Please try again.",
            "error",
          );
          return;
        }
        queryClient.setQueryData(["solution"], solution);
        setView("solutions");
      }),
      window.electronAPI.onSolutionError((error: string) => {
        clearProcessingTimeout();
        queryClient.setQueryData(["solution"], null);
        setView("queue");
        const message = error?.trim() || "处理失败，请重试。";
        setProcessingError(message);
        showToast("处理失败", message, "error");
      }),
    ];
    return () => {
      clearProcessingTimeout();
      cleanupFunctions.forEach((fn) => fn());
    };
  }, [queryClient, showToast]);

  return (
    <div ref={containerRef} className="min-h-0">
      {view === "queue" && processingError && (
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
      {view === "queue" ? (
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
      ) : null}
    </div>
  );
};

export default SubscribedApp;
