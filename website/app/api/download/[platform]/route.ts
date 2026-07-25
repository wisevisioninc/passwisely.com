import { env } from "cloudflare:workers";

const DOWNLOADS: Record<string, { key: string; filename: string; type: string }> = {
  "mac-arm64": {
    key: "releases/latest/PassWisely-macOS-arm64.dmg",
    filename: "PassWisely-macOS-arm64.dmg",
    type: "application/x-apple-diskimage",
  },
  "mac-x64": {
    key: "releases/latest/PassWisely-macOS-x64.dmg",
    filename: "PassWisely-macOS-x64.dmg",
    type: "application/x-apple-diskimage",
  },
  "windows-x64": {
    key: "releases/latest/PassWisely-Windows-x64.exe",
    filename: "PassWisely-Windows-x64.exe",
    type: "application/vnd.microsoft.portable-executable",
  },
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ platform: string }> },
) {
  const { platform } = await context.params;
  const download = DOWNLOADS[platform];
  if (!download) return new Response("Download not found.", { status: 404 });
  const bucket = (env as unknown as { DOWNLOADS?: R2Bucket }).DOWNLOADS;
  if (!bucket) return new Response("Downloads are temporarily unavailable.", { status: 503 });
  const object = await bucket.get(download.key);
  if (!object) return new Response("This build is being prepared.", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", download.type);
  headers.set("content-disposition", `attachment; filename="${download.filename}"`);
  headers.set("cache-control", "public, max-age=300");
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}
