import {
  createApiSession,
  createSession,
  hashPassword,
  jsonError,
  normalizeEmail,
  validateCredentials,
} from "@/lib/auth";
import { getD1 } from "@/db";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const validationError = validateCredentials(email, password);
  if (validationError) return jsonError(validationError, 400);

  const now = Math.floor(Date.now() / 1000);
  const userId = crypto.randomUUID();
  const { hash, salt } = await hashPassword(password);
  const locale = body.locale === "en" ? "en" : "zh";
  try {
    const db = getD1();
    await db.batch([
      db
        .prepare(
          `INSERT INTO users
           (id, email, password_hash, password_salt, locale, credits, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 10, ?, ?)`,
        )
        .bind(userId, email, hash, salt, locale, now, now),
      db
        .prepare(
          `INSERT INTO credit_transactions
           (id, user_id, amount, balance_after, type, reference, created_at)
           VALUES (?, ?, 10, 10, 'welcome', ?, ?)`,
        )
        .bind(crypto.randomUUID(), userId, `welcome:${userId}`, now),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) {
      return jsonError("An account with this email already exists.", 409);
    }
    return jsonError("Could not create the account. Please try again.", 500);
  }

  if (body.client === "desktop") {
    const token = await createApiSession(userId);
    return Response.json({ user: { id: userId, email, locale, credits: 10 }, token });
  }
  await createSession(userId);
  return Response.json({ user: { id: userId, email, locale, credits: 10 } });
}
