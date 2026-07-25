import { env } from "cloudflare:workers";

const KEYS: Record<string, string> = {
  "mac-arm64": "releases/latest/PassWisely-macOS-arm64.dmg",
  "mac-x64": "releases/latest/PassWisely-macOS-x64.dmg",
  "windows-x64": "releases/latest/PassWisely-Windows-x64.exe",
};

export async function PUT(request: Request) {
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
  if (!key || !request.body) {
    return Response.json({ error: "Invalid upload." }, { status: 400 });
  }
  if (!bindings.DOWNLOADS) {
    return Response.json({ error: "Storage unavailable." }, { status: 503 });
  }
  await bindings.DOWNLOADS.put(key, request.body, {
    httpMetadata: {
      contentType:
        platform.startsWith("mac")
          ? "application/x-apple-diskimage"
          : "application/vnd.microsoft.portable-executable",
    },
  });
  return Response.json({ success: true, key });
}
