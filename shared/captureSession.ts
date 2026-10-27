/** Credential-bearing capture session returned only to the desktop main process. */
export type TranscriptionProfileId = "recall-en" | "deepgram-en" | "deepgram-zh" | "recall-zh";
export type NativeTranscriptionProfileId = Extract<TranscriptionProfileId, "deepgram-en" | "deepgram-zh">;
export interface RecallCaptureSession {
  kind: "recall-upload";
  uploadToken: string;
  apiUrl: string;
  transcriptionProfile?: TranscriptionProfileId;
}
export interface NativeCaptureSession {
  kind: "native-deepgram";
  accessToken: string;
  /** Absolute expiry of the connection credential, in milliseconds since epoch. */
  expiresAt: number;
  transcriptionProfile: NativeTranscriptionProfileId;
  language: "en" | "zh";
  model: "nova-3";
  wsUrl: "wss://api.deepgram.com/v1/listen";
}
export type CaptureSession = RecallCaptureSession | NativeCaptureSession;
