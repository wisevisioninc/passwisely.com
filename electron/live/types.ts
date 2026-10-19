export type AudioSource = "microphone" | "system" | "unknown";
export type CaptureStatus = "idle" | "starting" | "recording" | "pausing" | "paused" | "resuming" | "stopping" | "ended" | "error";
export interface TranscriptSegment {
  id: string;
  text: string;
  source: AudioSource;
  speaker?: string;
  participantId?: string;
  isFinal: boolean;
  receivedAt: number;
  startMs?: number;
  endMs?: number;
}
export interface LiveAnswer {
  id: string;
  question: string;
  text: string;
  model: string;
  status: "preparing" | "streaming" | "completed" | "cancelled" | "error";
  createdAt: number;
  error?: string;
  contextTruncated?: boolean;
  screenshotCount: number;
  screenshotCleanupError?: string;
}
export interface LiveSnapshot {
  sessionId: string;
  revision: number;
  provider: "recall-v2";
  captureStatus: CaptureStatus;
  startedAt?: number;
  endedAt?: number;
  transcripts: TranscriptSegment[];
  answers: LiveAnswer[];
  error?: string;
  transcriptTruncated: boolean;
  platformSupported: boolean;
  platformMessage?: string;
  captureNeedsCleanup: boolean;
  screenshotError?: string;
}
export type LiveResult = { success: boolean; error?: string; requestId?: string };
export interface LiveAskInput {
  question: string;
  includeScreenshots: boolean;
}
export interface LiveSessionAPI {
  liveSetWorkspace: (visible: boolean) => Promise<void>;
  liveGetSnapshot: () => Promise<LiveSnapshot>;
  liveStart: () => Promise<LiveResult>;
  livePause: () => Promise<LiveResult>;
  liveResume: () => Promise<LiveResult>;
  liveStop: () => Promise<LiveResult>;
  liveAsk: (input: LiveAskInput) => Promise<LiveResult>;
  liveCancelAnswer: () => Promise<LiveResult>;
  liveClearAnswers: () => Promise<LiveResult>;
  liveStartOver: () => Promise<LiveResult>;
  onLiveSnapshot: (listener: (snapshot: LiveSnapshot) => void) => () => void;
}
