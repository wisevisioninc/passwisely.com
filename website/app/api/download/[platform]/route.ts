import { downloadResponse } from "@/lib/downloads";

async function downloadRedirect(
  context: { params: Promise<{ platform: string }> },
): Promise<Response> {
  const { platform } = await context.params;
  return downloadResponse(platform);
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
