// Solutions.tsx
import SolutionPanel, { SolutionData } from "../components/Solutions/SolutionPanel";
import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import ScreenshotQueue from "../components/Queue/ScreenshotQueue";

import SolutionCommands from "../components/Solutions/SolutionCommands";
import Debug from "./Debug";
import { useToast } from "../contexts/toast";

export interface SolutionsProps {
  setView: (view: "queue" | "solutions" | "debug") => void;
  credits: number;
  currentLanguage: string;
  setLanguage: (language: string) => void;
  currentQuery: string;
  setQuery: (query: string) => void;
}
const Solutions: React.FC<SolutionsProps> = ({
  setView,
  credits,
  currentLanguage,
  setLanguage,
  currentQuery,
  setQuery,
}) => {
  const queryClient = useQueryClient();
  const { data: streamedSolution } = useQuery<SolutionData | null>({ queryKey: ["solution"], queryFn: () => null, enabled: false });
  const { data: streamedDebug } = useQuery<SolutionData | null>({ queryKey: ["new_solution"], queryFn: () => null, enabled: false });
  const contentRef = useRef<HTMLDivElement>(null);

  const [debugProcessing, setDebugProcessing] = useState(false);
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const [tooltipHeight, setTooltipHeight] = useState(0);

  const [isResetting, setIsResetting] = useState(false);

  interface Screenshot {
    id: string;
    path: string;
    preview: string;
    timestamp: number;
  }

  const [extraScreenshots, setExtraScreenshots] = useState<Screenshot[]>([]);

  useEffect(() => {
    const fetchScreenshots = async () => {
      try {
        const existing = await window.electronAPI.getScreenshots();
        console.log("Raw screenshot data:", existing);
        const screenshots = (Array.isArray(existing) ? existing : []).map(
          (p) => ({
            id: p.path,
            path: p.path,
            preview: p.preview,
            timestamp: Date.now(),
          }),
        );
        console.log("Processed screenshots:", screenshots);
        setExtraScreenshots(screenshots);
      } catch (error) {
        console.error("Error loading extra screenshots:", error);
        setExtraScreenshots([]);
      }
    };

    fetchScreenshots();
  }, []);

  const { showToast } = useToast();

  useEffect(() => {
    // Height update logic
    const updateDimensions = () => {
      if (contentRef.current) {
        let contentHeight = contentRef.current.scrollHeight;
        const contentWidth = contentRef.current.scrollWidth;
        if (isTooltipVisible) {
          contentHeight += tooltipHeight;
        }
        window.electronAPI.updateContentDimensions({
          width: contentWidth,
          height: contentHeight,
        });
      }
    };

    // Initialize resize observer
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (contentRef.current) {
      resizeObserver.observe(contentRef.current);
    }
    updateDimensions();

    // Set up event listeners
    const cleanupFunctions = [
      window.electronAPI.onScreenshotTaken(async () => {
        try {
          const existing = await window.electronAPI.getScreenshots();
          const screenshots = (Array.isArray(existing) ? existing : []).map(
            (p) => ({
              id: p.path,
              path: p.path,
              preview: p.preview,
              timestamp: Date.now(),
            }),
          );
          setExtraScreenshots(screenshots);
        } catch (error) {
          console.error("Error loading extra screenshots:", error);
        }
      }),
      window.electronAPI.onResetView(() => {
        // Set resetting state first
        setIsResetting(true);

        // Remove queries
        queryClient.removeQueries({
          queryKey: ["solution"],
        });
        queryClient.removeQueries({
          queryKey: ["new_solution"],
        });

        // Reset screenshots
        setExtraScreenshots([]);

        // After a small delay, clear the resetting state
        setTimeout(() => {
          setIsResetting(false);
        }, 0);
      }),
      //########################################################
      //DEBUG EVENTS
      //########################################################
      window.electronAPI.onDebugStart(() => {
        //we'll set the debug processing state to true and use that to render a little loader
        setDebugProcessing(true);
      }),
      //the first time debugging works, we'll set the view to debug and populate the cache with the data
      window.electronAPI.onDebugSuccess(() => {
        setDebugProcessing(false);
      }),
      //when there was an error in the initial debugging, we'll show a toast and stop the little generating pulsing thing.
      window.electronAPI.onDebugError(() => {
        showToast(
          "处理失败",
          "调试代码时发生错误，请重试。",
          "error",
        );
        setDebugProcessing(false);
      }),
      window.electronAPI.onProcessingNoScreenshots(() => {
        showToast(
          "No Screenshots",
          "There are no extra screenshots to process.",
          "neutral",
        );
      }),
      window.electronAPI.onOutOfCredits(() => {}),
    ];

    return () => {
      resizeObserver.disconnect();
      cleanupFunctions.forEach((cleanup) => cleanup());
    };
  }, [isTooltipVisible, tooltipHeight]);

  const handleTooltipVisibilityChange = (visible: boolean, height: number) => {
    setIsTooltipVisible(visible);
    setTooltipHeight(height);
  };

  const handleDeleteExtraScreenshot = async (index: number) => {
    const screenshotToDelete = extraScreenshots[index];

    try {
      const response = await window.electronAPI.deleteScreenshot(
        screenshotToDelete.path,
      );

      if (response.success) {
        // Fetch and update screenshots after successful deletion
        const existing = await window.electronAPI.getScreenshots();
        const screenshots = (Array.isArray(existing) ? existing : []).map(
          (p) => ({
            id: p.path,
            path: p.path,
            preview: p.preview,
            timestamp: Date.now(),
          }),
        );
        setExtraScreenshots(screenshots);
      } else {
        console.error("Failed to delete extra screenshot:", response.error);
        showToast("Error", "Failed to delete the screenshot", "error");
      }
    } catch (error) {
      console.error("Error deleting extra screenshot:", error);
      showToast("Error", "Failed to delete the screenshot", "error");
    }
  };

  return (
    <>
      {!isResetting && streamedDebug ? (
        <Debug
          isProcessing={debugProcessing}
          setIsProcessing={setDebugProcessing}
          currentLanguage={currentLanguage}
          setLanguage={setLanguage}
          currentQuery={currentQuery}
          setQuery={setQuery}
        />
      ) : (
        <div ref={contentRef} className="relative space-y-3 px-4 py-3">
          {/* Conditionally render the screenshot queue if solutionData is available */}
          {streamedSolution?.code && (
            <div className="bg-transparent w-fit">
              <div className="pb-3">
                <div className="space-y-3 w-fit">
                  <ScreenshotQueue
                    isLoading={debugProcessing}
                    screenshots={extraScreenshots}
                    onDeleteScreenshot={handleDeleteExtraScreenshot}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Navbar of commands with the SolutionsHelper */}
          <SolutionCommands
            onTooltipVisibilityChange={handleTooltipVisibilityChange}
            isProcessing={!streamedSolution || Boolean(streamedSolution.isStreaming)}
            extraScreenshots={extraScreenshots}
            credits={credits}
            currentLanguage={currentLanguage}
            setLanguage={setLanguage}
            currentQuery={currentQuery}
            setQuery={setQuery}
          />

          {/* Main Content - Modified width constraints */}
          <div className="w-full text-sm text-black bg-black/60 rounded-md">
            <div className="rounded-lg overflow-hidden">
              <div className="px-4 py-3 space-y-4 max-w-full">
                <SolutionPanel data={streamedSolution} language={currentLanguage} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Solutions;
