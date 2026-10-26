import type { DownloadPlatform } from "./downloads";

export type DownloadOperatingSystem = "macos" | "windows" | "other" | "unknown";
export type DownloadArchitecture = "arm64" | "x64" | "unknown";
export type DownloadDetectionSource = "client-hints" | "user-agent" | "unknown";

/** Browser values are optional, untrusted observations, including in embedded browsers. */
export interface DownloadNavigator {
  userAgent?: unknown;
  platform?: unknown;
  maxTouchPoints?: unknown;
  userAgentData?: unknown;
}

export interface DownloadPlatformDetection {
  os: DownloadOperatingSystem;
  architecture: DownloadArchitecture;
  recommendedPlatform: DownloadPlatform | null;
  /** The observation supporting this result; it does not certify physical hardware. */
  source: DownloadDetectionSource;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Legacy MacIntel/Intel Mac OS X values identify an OS, never a CPU architecture. */
export function detectDownloadOperatingSystem(
  input?: DownloadNavigator | null,
): Pick<DownloadPlatformDetection, "os" | "source"> {
  const userAgent = string(input?.userAgent);
  const platform = string(input?.platform);
  const hints = object(input?.userAgentData);
  const hintedPlatform = string(hints?.platform);
  const legacyMac = /\bMacintosh\b|\bMac OS X\b/i.test(userAgent) || /^Mac/i.test(platform);

  if (/\b(?:iPhone|iPad|iPod|Android)\b/i.test(userAgent)) {
    return { os: "other", source: "user-agent" };
  }
  if (hints?.mobile === true) return { os: "other", source: "client-hints" };

  // iPad desktop browsing can share Mac identifiers. Touch does not establish macOS.
  if ((legacyMac || hintedPlatform === "macOS") &&
      typeof input?.maxTouchPoints === "number" && input.maxTouchPoints > 1) {
    return { os: "unknown", source: "unknown" };
  }

  if (hintedPlatform === "macOS") return { os: "macos", source: "client-hints" };
  if (hintedPlatform === "Windows") return { os: "windows", source: "client-hints" };
  if (["Android", "Chrome OS", "Chromium OS", "iOS", "Linux", "Fuchsia", "FreeBSD", "OpenBSD"].includes(hintedPlatform)) {
    return { os: "other", source: "client-hints" };
  }

  const legacyWindows = /\bWindows\b/i.test(userAgent) || /^Win/i.test(platform);
  if (legacyMac && legacyWindows) return { os: "unknown", source: "unknown" };
  if (legacyMac) return { os: "macos", source: "user-agent" };
  if (legacyWindows) return { os: "windows", source: "user-agent" };
  if (/\b(?:Linux|CrOS|FreeBSD|OpenBSD)\b/i.test(`${userAgent} ${platform}`)) {
    return { os: "other", source: "user-agent" };
  }
  return { os: "unknown", source: "unknown" };
}

/**
 * Recommend an available package family from browser observations, without persisting them.
 * The caller owns one invocation per page and any explicit user choice.
 * Windows has one offered package; its recommendation does not infer x64 hardware.
 */
export async function detectDownloadPlatform(
  input?: DownloadNavigator | null,
  options: { timeoutMs?: number } = {},
): Promise<DownloadPlatformDetection> {
  const operatingSystem = detectDownloadOperatingSystem(input);
  const fallback: DownloadPlatformDetection = {
    ...operatingSystem,
    architecture: "unknown",
    recommendedPlatform: operatingSystem.os === "windows" ? "windows-x64" : null,
  };
  if (operatingSystem.os !== "macos") return fallback;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const hints = object(input?.userAgentData);
    const getHighEntropyValues = hints?.getHighEntropyValues;
    if (typeof getHighEntropyValues !== "function") return fallback;
    const timeoutMs = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs >= 0
      ? Math.min(options.timeoutMs, 1000)
      : 1000;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const values = object(await Promise.race([
      Promise.resolve(getHighEntropyValues.call(hints, ["architecture"])),
      deadline,
    ]));
    const architecture = values?.architecture === "arm" ? "arm64"
      : values?.architecture === "x86" ? "x64"
        : "unknown";
    if (architecture === "unknown") return fallback;
    return {
      os: "macos",
      architecture,
      recommendedPlatform: architecture === "arm64" ? "mac-arm64" : "mac-x64",
      source: "client-hints",
    };
  } catch {
    // A denied or unavailable hint leaves both Mac packages as explicit choices.
    return fallback;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
