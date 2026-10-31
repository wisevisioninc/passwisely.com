import { types } from "node:util";
import { WindowVisibilityCleanupError } from "./WindowVisibility";

export type ScreenshotStage = "screen-enumeration" | "display-selection" | "thumbnail" | "image-conversion" | "storage";
export type ScreenAccessStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown";
const STAGE_LABELS: Record<ScreenshotStage, string> = {
  "screen-enumeration": "screen source enumeration",
  "display-selection": "selected display lookup",
  thumbnail: "screen thumbnail capture",
  "image-conversion": "PNG conversion",
  storage: "screenshot storage",
};

/** Electron 29 rejects getSources with a string. Do not coerce arbitrary values. */
export function screenshotFailureMessage(error: unknown): string {
  if (error instanceof WindowVisibilityCleanupError) {
    return `${error.message} Capture: ${failureDetail(error.operationError)} Visibility restoration: ${failureDetail(error.cleanupError)}`;
  }
  return failureDetail(error);
}
function failureDetail(error: unknown): string {
  if (typeof error === "string") return error || "The capture backend returned an empty error string.";
  if (types.isNativeError(error)) return error.message || error.name || "An error without a message was reported.";
  return `Screenshot capture failed: unknown error value (${error === null ? "null" : typeof error}).`;
}

/** Facts observed at the capture boundary; denied access is never inferred from an image failure. */
export class ScreenshotFailure extends Error {
  readonly cause: unknown;
  readonly needsScreenPermission: boolean;

  constructor(readonly stage: ScreenshotStage, cause: unknown, readonly screenAccess: ScreenAccessStatus, platform: string) {
    const needsScreenPermission = platform === "darwin" && stage !== "storage" &&
      (screenAccess === "denied" || screenAccess === "restricted");
    const guidance = needsScreenPermission
      ? ` Screen Recording access is ${screenAccess}. Open System Settings → Privacy & Security → Screen Recording (or Screen & System Audio Recording), allow PassWisely, then quit and reopen it.`
      : "";
    super(`Screenshot failed during ${STAGE_LABELS[stage]}: ${screenshotFailureMessage(cause)} [stage=${stage}; screen=${screenAccess}].${guidance}`);
    this.name = "ScreenshotFailure";
    this.cause = cause;
    this.needsScreenPermission = needsScreenPermission;
  }
}

export function screenshotNeedsPermission(error: unknown): boolean {
  const capture = error instanceof WindowVisibilityCleanupError ? error.operationError : error;
  return capture instanceof ScreenshotFailure && capture.needsScreenPermission;
}
