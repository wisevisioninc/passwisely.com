import {
  createApiSession,
  createSession,
  jsonError,
  normalizeEmail,
  verifyPassword,
} from "@/lib/auth";
import { getD1 } from "@/db";

interface LoginRow {
  id: string;
  email: string;
  locale: "zh" | "en";
  credits: number;
  password_hash: string;
  password_salt: string;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const user = await getD1()
    .prepare(
      `SELECT id, email, locale, credits, password_hash, password_salt
       FROM users WHERE email = ?`,
    )
    .bind(email)
    .first<LoginRow>();

  if (
    !user ||
    !(await verifyPassword(password, user.password_hash, user.password_salt))
  ) {
    return jsonError("Email or password is incorrect.", 401);
  }

  const publicUser = {
    id: user.id,
    email: user.email,
    locale: user.locale,
    credits: user.credits,
  };
  if (body.client === "desktop") {
    const token = await createApiSession(user.id);
    return Response.json({ user: publicUser, token });
  }
  await createSession(user.id);
  return Response.json({ user: publicUser });
}
