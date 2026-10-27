import type { CaptureStatus, TranscriptSegment } from "./types";
import type { CaptureSession } from "../../shared/captureSession";
export type { CaptureSession, NativeCaptureSession, RecallCaptureSession } from "../../shared/captureSession";

export interface CaptureCallbacks {
  onTranscript: (segment: TranscriptSegment) => void;
  onState: (status: CaptureStatus) => void;
  onError: (message: string) => void;
}
export interface AudioCapture {
  prepare?: (signal: AbortSignal) => Promise<void>;
  start: (session: CaptureSession) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  dispose: () => Promise<void>;
}
