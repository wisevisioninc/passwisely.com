export type LiveShortcutAction = "ask" | "clear" | "toggle-session" | "response" | "transcripts" | "move-up" | "move-down" | "move-left" | "move-right" | "scroll-up" | "scroll-down";

export interface OverlayWindowAPI {
  setOverlayInteractive: (interactive: boolean) => Promise<void>;
  setOverlayFocus: (focused: boolean) => Promise<void>;
  onOverlayRecenter: (callback: () => void) => () => void;
  onOverlayVisibilityChanged: (callback: (visible: boolean) => void) => () => void;
  onLiveShortcut: (callback: (action: LiveShortcutAction) => void) => () => void;
}
