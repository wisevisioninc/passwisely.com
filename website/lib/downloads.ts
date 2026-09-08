export const OSS_RELEASE_BASE =
  "https://passwisely-releases-prod.oss-cn-beijing.aliyuncs.com/releases/v1.2.5";

export const DOWNLOADS: Record<string, string> = {
  "mac-arm64": "PassWisely-macOS-arm64.dmg",
  "mac-x64": "PassWisely-macOS-x64.dmg",
  "windows-x64": "PassWisely-Windows-x64.exe",
};

export function downloadUrl(platform: string): string | null {
  const filename = DOWNLOADS[platform];
  return filename ? `${OSS_RELEASE_BASE}/${encodeURIComponent(filename)}` : null;
}

export function downloadResponse(platform: string): Response {
  const location = downloadUrl(platform);
  if (!location) return new Response("Download not found.", { status: 404 });
  return new Response(null, {
    status: 307,
    headers: {
      location,
      "cache-control": "public, max-age=300",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
