import type { CaptureStatus, TranscriptSegment } from "./types";
import type { CaptureSession } from "../../shared/captureSession";
export type { CaptureSession, NativeCaptureSession, RecallCaptureSession } from "../../shared/captureSession";

export interface CaptureCallbacks {
  onTranscript: (segment: TranscriptSegment) => void;
  onState: (status: CaptureStatus) => void;
  onError: (message: string) => void;
}
export type AudioPermissionStatus = "granted" | "not_requested" | "denied" | "not_installed" | "error" | "unknown" | "not-required";
export interface AudioPermissionObservation {
  status: AudioPermissionStatus;
  /** Time of the provider's observation, never a claim of current OS state. */
  observedAt?: number;
}
export interface AudioPermissionSnapshot {
  microphone: AudioPermissionObservation;
  systemAudio: AudioPermissionObservation;
  accessibility?: AudioPermissionObservation;
}
export interface AudioPermissionOptions { recallApiUrl?: string }
export interface AudioPermissionResult {
  success: boolean;
  permissions: AudioPermissionSnapshot | null;
  cleanupRequired: boolean;
  error?: string;
}
export interface AudioCapture {
  prepare?: (signal: AbortSignal) => Promise<void>;
  /** Explicit permission request only: no source recording or ASR session. */
  preparePermissions?: (signal: AbortSignal, options: AudioPermissionOptions) => Promise<void>;
  /** Read retained provider evidence without initializing or requesting access. */
  getPermissionSnapshot?: () => AudioPermissionSnapshot;
  start: (session: CaptureSession) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  dispose: () => Promise<void>;
}
