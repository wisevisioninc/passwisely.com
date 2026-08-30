import { jsonError, normalizeEmail } from "@/lib/auth";
import {
  requestPasswordReset,
  SupabaseRequestError,
} from "@/lib/supabase";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return jsonError("Please enter a valid email address.", 400);
  }

  const origin = new URL(request.url).origin;
  try {
    await requestPasswordReset(email, `${origin}/?reset=password`);
  } catch (error) {
    // Supabase deliberately returns a generic result for unknown addresses.
    // Preserve that property here so this endpoint cannot enumerate accounts.
    if (!(error instanceof SupabaseRequestError) || error.status >= 500) {
      return jsonError("Password reset is temporarily unavailable.", 503);
    }
  }
  return Response.json({ success: true });
}
