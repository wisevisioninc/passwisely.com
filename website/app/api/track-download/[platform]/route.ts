import { adminRest } from "@/lib/supabase";
import { DOWNLOADS, downloadResponse } from "@/lib/downloads";

export async function GET(
  _request: Request,
  context: { params: Promise<{ platform: string }> },
) {
  const { platform } = await context.params;
  if (!DOWNLOADS[platform]) return new Response("Download not found.", { status: 404 });

  await adminRest("download_events", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ platform, source: "website" }),
  }).catch(() => undefined);
  return downloadResponse(platform);
}
