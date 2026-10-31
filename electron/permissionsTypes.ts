export type CapturePermissionId = "screen" | "microphone" | "system-audio" | "accessibility";
export type CapturePermissionStatus = "granted" | "not-determined" | "not_requested" | "denied" | "restricted" | "not_installed" | "error" | "unknown" | "not-required" | "unsupported";
export interface CapturePermissionItem {
  id: CapturePermissionId;
  status: CapturePermissionStatus;
  detail: string;
  action: "request" | "settings" | "none";
  observedAt?: number;
}
export interface CapturePermissionSnapshot {
  platform: "darwin" | "win32" | "other";
  architecture: string;
  firstRun: boolean;
  restartRecommended: boolean;
  audioCheckBusy: boolean;
  cleanupRequired: boolean;
  audioSupported: boolean;
  audioSupportMessage?: string;
  items: CapturePermissionItem[];
}
export interface CapturePermissionResult {
  success: boolean;
  snapshot: CapturePermissionSnapshot;
  error?: string;
}
export interface CapturePermissionAPI {
  getCapturePermissions(): Promise<CapturePermissionSnapshot>;
  requestCapturePermission(id: CapturePermissionId): Promise<CapturePermissionResult>;
  openCapturePermissionSettings(id: CapturePermissionId): Promise<CapturePermissionResult>;
  acknowledgeCapturePermissionGuide(): Promise<CapturePermissionResult>;
  openCapturePermissionGuide(): Promise<void>;
  restartForCapturePermissions(): Promise<{success: boolean; error?: string}>;
  onCapturePermissionsNeeded(callback: () => void): () => void;
}
