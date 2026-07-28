import {
  createApiSession,
  createSession,
  jsonError,
  normalizeEmail,
  validateCredentials,
} from "@/lib/auth";
import {
  createConfirmedUser,
  getProfile,
  signInWithPassword,
  SupabaseRequestError,
} from "@/lib/supabase";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const validationError = validateCredentials(email, password);
  if (validationError) return jsonError(validationError, 400);

  const locale = body.locale === "en" ? "en" : "zh";
  try {
    const authUser = await createConfirmedUser({ email, password, locale });
    const session = await signInWithPassword(email, password);
    const profile = await getProfile(authUser.id);
    if (!profile) throw new Error("Account profile was not created.");
    const user = {
      id: profile.id,
      email: profile.email,
      locale: profile.locale,
      credits: profile.credits,
    };
    if (body.client === "desktop") {
      const token = await createApiSession(profile.id);
      return Response.json({ user, token });
    }
    await createSession(session);
    return Response.json({ user });
  } catch (error) {
    if (
      error instanceof SupabaseRequestError &&
      (error.status === 409 ||
        error.status === 422 ||
        /already|registered|exists/i.test(error.message))
    ) {
      return jsonError("An account with this email already exists.", 409);
    }
    return jsonError("Could not create the account. Please try again.", 500);
  }
}
