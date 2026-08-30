import {
  getApiUser,
  jsonError,
  validatePassword,
} from "@/lib/auth";
import {
  signInWithPassword,
  SupabaseRequestError,
  updateAuthUserPassword,
} from "@/lib/supabase";

export async function POST(request: Request) {
  const user = await getApiUser(request);
  if (!user) return jsonError("Please sign in.", 401);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  const validationError = validatePassword(newPassword);
  if (validationError) return jsonError(validationError, 400);
  if (currentPassword === newPassword) {
    return jsonError("Choose a password different from your current password.", 400);
  }

  try {
    await signInWithPassword(user.email, currentPassword);
    await updateAuthUserPassword(user.id, newPassword);
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof SupabaseRequestError && [400, 401].includes(error.status)) {
      return jsonError("Current password is incorrect.", 400);
    }
    return jsonError("Password could not be changed.", 503);
  }
}
