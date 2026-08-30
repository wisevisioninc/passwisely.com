import {
  getBearerToken,
  jsonError,
  validatePassword,
} from "@/lib/auth";
import {
  getAuthUser,
  SupabaseRequestError,
  updateAuthUserPassword,
} from "@/lib/supabase";

export async function POST(request: Request) {
  const token = getBearerToken(request);
  if (!token) return jsonError("This password reset link is invalid or expired.", 401);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const password = typeof body.password === "string" ? body.password : "";
  const validationError = validatePassword(password);
  if (validationError) return jsonError(validationError, 400);

  try {
    const authUser = await getAuthUser(token);
    await updateAuthUserPassword(authUser.id, password);
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof SupabaseRequestError && [400, 401, 403].includes(error.status)) {
      return jsonError("This password reset link is invalid or expired.", 401);
    }
    return jsonError("Password could not be reset.", 503);
  }
}
