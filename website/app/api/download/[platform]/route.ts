const OSS_RELEASE_BASE =
  "https://passwisely-releases-prod.oss-cn-beijing.aliyuncs.com/releases/v1.2.0";

const DOWNLOADS: Record<string, string> = {
  "mac-arm64": "PassWisely-macOS-arm64.dmg",
  "mac-x64": "PassWisely-macOS-x64.dmg",
  "windows-x64": "PassWisely-Windows-x64.exe",
};

async function downloadRedirect(
  context: { params: Promise<{ platform: string }> },
): Promise<Response> {
  const { platform } = await context.params;
  const filename = DOWNLOADS[platform];
  if (!filename) return new Response("Download not found.", { status: 404 });
  return new Response(null, {
    status: 307,
    headers: {
      location: `${OSS_RELEASE_BASE}/${encodeURIComponent(filename)}`,
      "cache-control": "public, max-age=300",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ platform: string }> },
) {
  return downloadRedirect(context);
}

export async function HEAD(
  _request: Request,
  context: { params: Promise<{ platform: string }> },
) {
  return downloadRedirect(context);
}
