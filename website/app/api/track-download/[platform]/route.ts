import { adminRest } from "@/lib/supabase";
import { downloadResponse } from "@/lib/downloads";

export async function GET(
  _request: Request,
  context: { params: Promise<{ platform: string }> },
) {
  const { platform } = await context.params;
  const response = downloadResponse(platform);
  if (response.status !== 307) return response;

  await adminRest("download_events", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ platform, source: "website" }),
  }).catch(() => undefined);
  return response;
}
