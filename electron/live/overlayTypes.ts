export type LiveShortcutAction = "ask" | "clear" | "toggle-session" | "response" | "transcripts" | "move-up" | "move-down" | "move-left" | "move-right" | "scroll-up" | "scroll-down";

export interface OverlayGeometry {
  displayId: number;
  width: number;
  height: number;
}

export interface OverlayDisplay {
  id: number;
  label: string;
  isPrimary: boolean;
  selected: boolean;
}

export interface OverlayWindowAPI {
  getOverlayDisplays: () => Promise<OverlayDisplay[]>;
  selectOverlayDisplay: (displayId: number) => Promise<OverlayGeometry | null>;
  getOverlayGeometry: () => Promise<OverlayGeometry | null>;
  onOverlayGeometryChanged: (callback: (geometry: OverlayGeometry) => void) => () => void;
  setOverlayInteractive: (interactive: boolean) => Promise<void>;
  setOverlayFocus: (focused: boolean) => Promise<void>;
  onOverlayRecenter: (callback: () => void) => () => void;
  onOverlayVisibilityChanged: (callback: (visible: boolean) => void) => () => void;
  onLiveShortcut: (callback: (action: LiveShortcutAction) => void) => () => void;
}
