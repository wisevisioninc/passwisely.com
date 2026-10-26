import manifest from "./download-artifacts.json";

export const OSS_RELEASE_ORIGIN = "https://passwisely-releases-prod.oss-cn-beijing.aliyuncs.com";
export type DownloadPlatform = "mac-arm64" | "mac-x64" | "windows-x64";
export interface DownloadArtifact {
  platform: DownloadPlatform;
  version: string;
  revision: number;
  filename: string;
  sha256: string | null;
  bytes: number | null;
  legacy: boolean;
  liveAudio: "included" | "not_included";
  available: boolean;
  notice: Readonly<{ zh: string; en: string }> | null;
  url: string;
}

// Parse once at the owner. A v2 artifact stays unavailable until its concrete
// byte length and digest are supplied; no route can silently select an old file.
export function versionedArtifact(platform: DownloadPlatform, input: unknown): DownloadArtifact {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid release artifact.");
  const value = input as Record<string, unknown>;
  const revision = value.revision === undefined ? 1 : value.revision;
  if (!Number.isSafeInteger(revision) || Number(revision) < 1) throw new Error("Invalid release artifact revision.");
  const filenames: Record<DownloadPlatform, string> = {
    "mac-arm64": "PassWisely-macOS-arm64.dmg",
    "mac-x64": "PassWisely-macOS-x64.dmg",
    "windows-x64": "PassWisely-Windows-x64.exe",
  };
  if (!Object.hasOwn(filenames, platform) || typeof value.version !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(value.version) || value.filename !== filenames[platform] ||
      (value.sha256 !== null && (typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256))) ||
      (value.bytes !== null && (!Number.isSafeInteger(value.bytes) || Number(value.bytes) <= 0)) ||
      typeof value.legacy !== "boolean" || !["included", "not_included"].includes(String(value.liveAudio))) {
    throw new Error("Invalid release artifact.");
  }
  if (value.legacy && !(platform === "mac-x64" && value.version === "1.2.6" && value.liveAudio === "not_included")) {
    throw new Error("Unsupported legacy release artifact.");
  }
  const rawNotice = value.notice;
  if (rawNotice !== undefined && rawNotice !== null &&
      (typeof rawNotice !== "object" || Array.isArray(rawNotice) ||
       typeof (rawNotice as Record<string, unknown>).zh !== "string" || typeof (rawNotice as Record<string, unknown>).en !== "string")) {
    throw new Error("Invalid release artifact notice.");
  }
  const notice = rawNotice ? Object.freeze({ zh: (rawNotice as { zh: string }).zh, en: (rawNotice as { en: string }).en }) : null;
  const available = value.legacy || (value.sha256 !== null && value.bytes !== null);
  return Object.freeze({ platform, version: value.version, revision: Number(revision), filename: value.filename as string,
    sha256: value.sha256 as string | null, bytes: value.bytes as number | null,
    legacy: value.legacy, notice, liveAudio: value.liveAudio as DownloadArtifact["liveAudio"], available,
    url: `${OSS_RELEASE_ORIGIN}/releases/v${value.version}/${Number(revision) > 1 ? `r${revision}/` : ""}${encodeURIComponent(value.filename as string)}` });
}

export const DOWNLOAD_ARTIFACTS = Object.freeze(Object.fromEntries(
  (Object.keys(manifest.artifacts) as DownloadPlatform[]).map(platform =>
    [platform, versionedArtifact(platform, manifest.artifacts[platform])]),
)) as Readonly<Record<DownloadPlatform, DownloadArtifact>>;

export function downloadArtifact(platform: string): DownloadArtifact | null {
  return Object.hasOwn(DOWNLOAD_ARTIFACTS, platform) ? DOWNLOAD_ARTIFACTS[platform as DownloadPlatform] : null;
}

export function downloadUrl(platform: string): string | null {
  const artifact = downloadArtifact(platform);
  return artifact?.available ? artifact.url : null;
}

export function downloadResponse(platform: string): Response {
  const artifact = downloadArtifact(platform);
  if (!artifact) return new Response("Download not found.", { status: 404 });
  if (!artifact.available) return new Response("This release is being verified. Please try again later.", {
    status: 503, headers: { "cache-control": "no-store", "retry-after": "300" },
  });
  return new Response(null, { status: 307, headers: {
    location: artifact.url, "cache-control": "no-store", "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff", "x-passwisely-release-version": artifact.version,
    ...(artifact.sha256 ? { "x-passwisely-artifact-sha256": artifact.sha256 } : {}),
  } });
}
