import React, { useEffect, useRef, useState } from "react";
import { FileUser } from "lucide-react";
import { useToast } from "../../contexts/toast";
import { COMMAND_KEY } from "../../utils/platform";
import { LanguageSelector } from "../shared/LanguageSelector";
import { QuerySelector } from "../shared/QueryText";
import { AISettings } from "../shared/AISettings";
import { ResumePanel } from "../shared/ResumePanel";
import { QuitButton } from "../shared/QuitButton";

interface QueueCommandsProps {
  onTooltipVisibilityChange: (visible: boolean, height: number) => void;
  screenshotCount?: number;
  credits: number;
  currentLanguage: string;
  setLanguage: (language: string) => void;
  currentQuery: string;
  setQuery: (query: string) => void;
}

const QueueCommands: React.FC<QueueCommandsProps> = ({
  onTooltipVisibilityChange,
  screenshotCount = 0,
  credits,
  currentLanguage,
  setLanguage,
  currentQuery,
  setQuery,
}) => {
  const [activePanel, setActivePanel] = useState<
    "settings" | "resume" | null
  >(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    const panel = tooltipRef.current;
    if (!activePanel || !panel) {
      onTooltipVisibilityChange(false, 0);
      return;
    }

    const reportSize = () => {
      onTooltipVisibilityChange(true, panel.offsetHeight + 10);
    };
    const observer = new ResizeObserver(reportSize);
    observer.observe(panel);
    reportSize();

    return () => observer.disconnect();
  }, [activePanel, onTooltipVisibilityChange]);

  return (
    <div>
      <div className="pt-2 w-fit cursor-default">
        <div className="text-xs text-white/90 backdrop-blur-md bg-black/60 rounded-lg py-2 px-4 flex items-center justify-center gap-4">
          <button
            type="button"
            aria-label="PassWisely"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 p-0.5 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition-colors hover:bg-white/15"
          >
            <img
              src="./logo192.png"
              alt="PassWisely"
              draggable={false}
              className="h-7 w-7 select-none rounded-[10px]"
            />
          </button>

          <div className="h-4 w-px bg-white/20" />

          {/* Screenshot */}
          <div
            className="flex items-center gap-2 cursor-default rounded px-2 py-1.5 hover:bg-white/10 transition-colors"
            onClick={async () => {
              try {
                const result = await window.electronAPI.triggerScreenshot();
                if (!result.success) {
                  console.error("Failed to take screenshot:", result.error);
                  showToast("Error", "Failed to take screenshot", "error");
                }
              } catch (error) {
                console.error("Error taking screenshot:", error);
                showToast("Error", "Failed to take screenshot", "error");
              }
            }}
          >
            <span className="text-[11px] leading-none truncate cursor-default">
              {screenshotCount === 0 ? "Take first screenshot" : "Screenshot"}
            </span>
            <div className="flex gap-1">
              <button className="cursor-default bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                {COMMAND_KEY}
              </button>
              <button className="cursor-default bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                H
              </button>
            </div>
          </div>

          {/* New Input and Button */}
          <div className="flex items-center gap-2 mt-2">
            <QuerySelector currentQuery={currentQuery} setQuery={setQuery} />
            {/* <InputText1 label="Your Text" placeholder="Enter text here" /> */}
            {/* <input
                          type="text"
                          value={inputValue}
                          onChange={handleInputChange}
                          placeholder="Enter text"
                          className="bg-white/10 rounded-md px-2 py-1 text-[11px] leading-none text-white/70"
                        /> */}
            {/* <button
              onClick={handleButtonClick}
              className="bg-white/10 rounded-md px-2 py-1 text-[11px] leading-none text-white/70"
            >
              →
            </button> */}
          </div>

          {/* Solve Command */}
          {(screenshotCount > 0 || currentQuery.trim().length > 0) && (
            <div
              className={`flex flex-col cursor-default rounded px-2 py-1.5 hover:bg-white/10 transition-colors ${
                credits <= 0 ? "opacity-50 cursor-not-allowed" : ""
              }`}
              onClick={async () => {
                if (credits <= 0) {
                  showToast(
                    "Out of Credits",
                    "You are out of credits. Open your PassWisely account to refill.",
                    "error",
                  );
                  await window.electronAPI.accountOpenPortal();
                  return;
                }

                try {
                  const result =
                    await window.electronAPI.triggerProcessScreenshots();
                  if (!result.success) {
                    console.error(
                      "Failed to process screenshots:",
                      result.error,
                    );
                    showToast(
                      "Error",
                      "Failed to process screenshots",
                      "error",
                    );
                  }
                } catch (error) {
                  console.error("Error processing screenshots:", error);
                  showToast("Error", "Failed to process screenshots", "error");
                }
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] leading-none">Solve </span>
                <div className="flex gap-1 ml-2">
                  <button className="cursor-default bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                    {COMMAND_KEY}
                  </button>
                  <button className="cursor-default bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                    ↵
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Separator */}
          <div className="mx-2 h-4 w-px bg-white/20" />

          {/* Settings with Tooltip */}
          <div
            className="relative inline-block"
          >
            {/* Gear icon */}
            <button
              type="button"
              aria-label="Settings"
              onClick={() =>
                setActivePanel((panel) =>
                  panel === "settings" ? null : "settings",
                )
              }
              className={`flex h-7 items-center gap-1.5 rounded px-2 text-[11px] transition-colors ${
                activePanel === "settings"
                  ? "bg-white/10 text-white"
                  : "text-white/70 hover:bg-white/10 hover:text-white/90"
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-3.5 h-3.5"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Settings
            </button>

            {/* Tooltip Content */}
            {activePanel === "settings" && (
              <div
                ref={tooltipRef}
                className="absolute right-0 top-full mt-2 w-80"
                style={{ zIndex: 100 }}
              >
                {/* Add transparent bridge */}
                <div className="absolute -top-2 right-0 w-full h-2" />
                <div style={{ maxHeight: Math.max(240, window.screen.availHeight - 130) }} className="overflow-y-auto p-3 text-xs bg-black/80 backdrop-blur-md rounded-lg border border-white/10 text-white/90 shadow-lg">
                  <div className="space-y-4">
                    <h3 className="font-medium truncate">Keyboard Shortcuts</h3>
                    <div className="space-y-3">
                      {/* Toggle Command */}
                      <div
                        className="cursor-default rounded px-2 py-1.5 hover:bg-white/10 transition-colors"
                        onClick={async () => {
                          try {
                            const result =
                              await window.electronAPI.toggleMainWindow();
                            if (!result.success) {
                              console.error(
                                "Failed to toggle window:",
                                result.error,
                              );
                              showToast(
                                "Error",
                                "Failed to toggle window",
                                "error",
                              );
                            }
                          } catch (error) {
                            console.error("Error toggling window:", error);
                            showToast(
                              "Error",
                              "Failed to toggle window",
                              "error",
                            );
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate">Toggle Window</span>
                          <div className="flex gap-1 flex-shrink-0">
                            <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] leading-none">
                              {COMMAND_KEY}
                            </span>
                            <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] leading-none">
                              B
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] leading-relaxed text-white/70 truncate mt-1">
                          Show or hide this window.
                        </p>
                      </div>

                      {/* Screenshot Command */}
                      <div
                        className="cursor-default rounded px-2 py-1.5 hover:bg-white/10 transition-colors"
                        onClick={async () => {
                          try {
                            const result =
                              await window.electronAPI.triggerScreenshot();
                            if (!result.success) {
                              console.error(
                                "Failed to take screenshot:",
                                result.error,
                              );
                              showToast(
                                "Error",
                                "Failed to take screenshot",
                                "error",
                              );
                            }
                          } catch (error) {
                            console.error("Error taking screenshot:", error);
                            showToast(
                              "Error",
                              "Failed to take screenshot",
                              "error",
                            );
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate">Take Screenshot</span>
                          <div className="flex gap-1 flex-shrink-0">
                            <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] leading-none">
                              {COMMAND_KEY}
                            </span>
                            <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] leading-none">
                              H
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] leading-relaxed text-white/70 truncate mt-1">
                          Take a screenshot of the problem description.
                        </p>
                      </div>

                      {/* Solve Command */}
                      <div
                        className={`cursor-default rounded px-2 py-1.5 hover:bg-white/10 transition-colors ${
                          screenshotCount > 0 || currentQuery.trim().length > 0
                            ? ""
                            : "opacity-50 cursor-not-allowed"
                        }`}
                        onClick={async () => {
                          if (screenshotCount === 0 && !currentQuery.trim()) return;

                          try {
                            const result =
                              await window.electronAPI.triggerProcessScreenshots();
                            if (!result.success) {
                              console.error(
                                "Failed to process screenshots:",
                                result.error,
                              );
                              showToast(
                                "Error",
                                "Failed to process screenshots",
                                "error",
                              );
                            }
                          } catch (error) {
                            console.error(
                              "Error processing screenshots:",
                              error,
                            );
                            showToast(
                              "Error",
                              "Failed to process screenshots",
                              "error",
                            );
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate">Solve</span>
                          <div className="flex gap-1 flex-shrink-0">
                            <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] leading-none">
                              {COMMAND_KEY}
                            </span>
                            <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] leading-none">
                              ↵
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] leading-relaxed text-white/70 truncate mt-1">
                          {screenshotCount > 0 || currentQuery.trim()
                            ? "Generate a solution based on the current problem."
                            : "Take a screenshot first to generate a solution."}
                        </p>
                      </div>
                    </div>

                    {/* Separator and Log Out */}
                    <div className="pt-3 mt-3 border-t border-white/10">
                      <LanguageSelector
                        currentLanguage={currentLanguage}
                        setLanguage={setLanguage}
                      />
                      <AISettings />

                      <button
                        className="mt-3 w-full flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-white/70 hover:bg-white/[0.08]"
                        onClick={() => window.electronAPI.accountOpenPortal()}
                      >
                        <span>PassWisely credits</span>
                        <strong className="text-violet-300">{credits}</strong>
                      </button>
                      {!showPasswordForm ? (
                        <button
                          type="button"
                          className="mt-2 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] text-white/55 hover:bg-white/[0.08] hover:text-white/80"
                          onClick={() => setShowPasswordForm(true)}
                        >
                          Change password
                        </button>
                      ) : (
                        <form
                          className="mt-2 grid gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2"
                          onSubmit={async (event: React.FormEvent<HTMLFormElement>) => {
                            event.preventDefault();
                            const formElement = event.currentTarget;
                            const form = new FormData(formElement);
                            const currentPassword = String(form.get("currentPassword") || "");
                            const newPassword = String(form.get("newPassword") || "");
                            const confirmPassword = String(form.get("confirmPassword") || "");
                            if (newPassword !== confirmPassword) {
                              showToast("Password mismatch", "The new passwords do not match.", "error");
                              return;
                            }
                            setPasswordBusy(true);
                            const result = await window.electronAPI.accountChangePassword({ currentPassword, newPassword });
                            setPasswordBusy(false);
                            if (!result.success) {
                              showToast("Password not changed", result.error || "Please try again.", "error");
                              return;
                            }
                            formElement.reset();
                            setShowPasswordForm(false);
                            showToast("Password updated", "Your password has been changed.", "success");
                          }}
                        >
                          <input name="currentPassword" type="password" autoComplete="current-password" required placeholder="Current password" className="h-8 rounded-md border border-white/10 bg-black/25 px-2 text-[10px] outline-none focus:border-violet-400" />
                          <input name="newPassword" type="password" autoComplete="new-password" minLength={10} required placeholder="New password" className="h-8 rounded-md border border-white/10 bg-black/25 px-2 text-[10px] outline-none focus:border-violet-400" />
                          <input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required placeholder="Confirm new password" className="h-8 rounded-md border border-white/10 bg-black/25 px-2 text-[10px] outline-none focus:border-violet-400" />
                          <div className="flex gap-2">
                            <button type="button" className="h-8 flex-1 rounded-md border border-white/10 text-[10px] text-white/55" onClick={() => setShowPasswordForm(false)}>Cancel</button>
                            <button type="submit" disabled={passwordBusy} className="h-8 flex-1 rounded-md bg-violet-500 text-[10px] font-medium disabled:opacity-50">{passwordBusy ? "Saving…" : "Save"}</button>
                          </div>
                        </form>
                      )}
                      <button
                        className="mt-2 w-full text-[10px] text-white/35 hover:text-red-300"
                        onClick={async () => {
                          await window.electronAPI.accountLogout();
                          window.location.reload();
                        }}
                      >
                        Sign out
                      </button>
                      <QuitButton />

                      {/* Credits Display */}
                      {/* <div className="mb-3 px-2 space-y-1">
                        <div className="flex items-center justify-between text-[13px] font-medium text-white/90">
                          <span>Credits Remaining</span>
                          <span>{credits} / 50</span>
                        </div>
                        <div className="text-[11px] text-white/50">
                          Refill at{" "}
                          <span
                            className="underline cursor-default hover:opacity-80"
                            onClick={() =>
                              window.electronAPI.openSettingsPortal()
                            }
                          >
                            www.interviewcoder.co/settings
                          </span>
                        </div>
                      </div> */}

                      {/* <button
                        onClick={handleSignOut}
                        className="flex items-center gap-2 text-[11px] text-red-400 hover:text-red-300 transition-colors w-full cursor-default"
                      >
                        <div className="w-4 h-4 flex items-center justify-center">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="w-3 h-3"
                          >
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                          </svg>
                        </div>
                        Log Out
                      </button> */}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="relative inline-block">
            <button
              type="button"
              aria-label="Resume"
              onClick={() =>
                setActivePanel((panel) =>
                  panel === "resume" ? null : "resume",
                )
              }
              className={`flex h-7 items-center gap-1.5 rounded px-2 text-[11px] transition-colors ${
                activePanel === "resume"
                  ? "bg-white/10 text-white"
                  : "text-white/70 hover:bg-white/10 hover:text-white/90"
              }`}
            >
              <FileUser className="h-3.5 w-3.5 text-cyan-300" />
              Resume
            </button>

            {activePanel === "resume" && (
              <div
                ref={tooltipRef}
                className="absolute right-0 top-full mt-2 w-[390px]"
                style={{ zIndex: 100 }}
              >
                <div className="absolute -top-2 right-0 h-2 w-full" />
                <div className="overflow-hidden rounded-xl border border-white/10 bg-black/80 shadow-2xl backdrop-blur-xl">
                  <ResumePanel />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QueueCommands;
