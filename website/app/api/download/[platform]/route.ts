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
  request: Request,
  context: { params: Promise<{ platform: string }> },
) {
  const { platform } = await context.params;
  const download = DOWNLOADS[platform];
  if (!download) return new Response("Download not found.", { status: 404 });
  const bucket = (env as unknown as { DOWNLOADS?: R2Bucket }).DOWNLOADS;
  if (!bucket) return new Response("Downloads are temporarily unavailable.", { status: 503 });
  const metadata = await bucket.head(download.key);
  if (!metadata) return new Response("This build is being prepared.", { status: 404 });
  const requestedRange = request.headers.get("range");
  const match = requestedRange?.match(/^bytes=(\d+)-(\d*)$/);
  let range: { offset: number; length: number } | undefined;
  if (match) {
    const offset = Number(match[1]);
    const end = match[2] ? Number(match[2]) : metadata.size - 1;
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(end) ||
      offset < 0 ||
      end < offset ||
      offset >= metadata.size
    ) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${metadata.size}` },
      });
    }
    range = { offset, length: Math.min(end, metadata.size - 1) - offset + 1 };
  }
  const object = await bucket.get(download.key, range ? { range } : undefined);
  if (!object) return new Response("This build is being prepared.", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", download.type);
  headers.set("content-disposition", `attachment; filename="${download.filename}"`);
  headers.set("cache-control", "public, max-age=300");
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("content-length", String(range?.length ?? metadata.size));
  if (range) {
    headers.set(
      "content-range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`,
    );
  }
  return new Response(object.body, { status: range ? 206 : 200, headers });
}
