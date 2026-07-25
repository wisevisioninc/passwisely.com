import { env } from "cloudflare:workers";

const KEYS: Record<string, string> = {
  "mac-arm64": "releases/latest/PassWisely-macOS-arm64.dmg",
  "mac-x64": "releases/latest/PassWisely-macOS-x64.dmg",
  "windows-x64": "releases/latest/PassWisely-Windows-x64.exe",
};

function authorize(request: Request): {
  bucket: R2Bucket;
  key: string;
  platform: string;
} | Response {
  const bindings = env as unknown as {
    DOWNLOADS?: R2Bucket;
    RELEASE_UPLOAD_KEY?: string;
  };
  const suppliedKey = request.headers.get("x-upload-key") || "";
  if (!bindings.RELEASE_UPLOAD_KEY || suppliedKey !== bindings.RELEASE_UPLOAD_KEY) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const platform = new URL(request.url).searchParams.get("platform") || "";
  const key = KEYS[platform];
  if (!key) {
    return Response.json({ error: "Invalid upload." }, { status: 400 });
  }
  if (!bindings.DOWNLOADS) {
    return Response.json({ error: "Storage unavailable." }, { status: 503 });
  }
  return { bucket: bindings.DOWNLOADS, key, platform };
}

function contentType(platform: string): string {
  return platform.startsWith("mac")
    ? "application/x-apple-diskimage"
    : "application/vnd.microsoft.portable-executable";
}

export async function PUT(request: Request) {
  const upload = authorize(request);
  if (upload instanceof Response) return upload;
  if (!request.body) {
    return Response.json({ error: "Invalid upload." }, { status: 400 });
  }
  const url = new URL(request.url);
  const uploadId = url.searchParams.get("uploadId");
  const partNumber = Number(url.searchParams.get("part"));
  if (uploadId) {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      return Response.json({ error: "Invalid multipart part." }, { status: 400 });
    }
    const part = await upload.bucket
      .resumeMultipartUpload(upload.key, uploadId)
      .uploadPart(partNumber, request.body);
    return Response.json({ success: true, partNumber, etag: part.etag });
  }
  await upload.bucket.put(upload.key, request.body, {
    httpMetadata: {
      contentType: contentType(upload.platform),
    },
  });
  return Response.json({ success: true, key: upload.key });
}

export async function POST(request: Request) {
  const upload = authorize(request);
  if (upload instanceof Response) return upload;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.mode === "start") {
    const multipart = await upload.bucket.createMultipartUpload(upload.key, {
      httpMetadata: { contentType: contentType(upload.platform) },
    });
    return Response.json({ uploadId: multipart.uploadId, key: upload.key });
  }
  if (
    body.mode !== "complete" ||
    typeof body.uploadId !== "string" ||
    !Array.isArray(body.parts)
  ) {
    return Response.json({ error: "Invalid multipart request." }, { status: 400 });
  }
  const parts = body.parts
    .map((part) => part as Record<string, unknown>)
    .filter(
      (part) =>
        Number.isInteger(part.partNumber) &&
        Number(part.partNumber) > 0 &&
        typeof part.etag === "string",
    )
    .map((part) => ({
      partNumber: Number(part.partNumber),
      etag: String(part.etag),
    }));
  if (parts.length !== body.parts.length || parts.length === 0) {
    return Response.json({ error: "Invalid multipart parts." }, { status: 400 });
  }
  await upload.bucket
    .resumeMultipartUpload(upload.key, body.uploadId)
    .complete(parts);
  return Response.json({ success: true, key: upload.key });
}
