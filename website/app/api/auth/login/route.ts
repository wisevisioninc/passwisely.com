import {
  createApiSession,
  createSession,
  jsonError,
  normalizeEmail,
} from "@/lib/auth";
import { getD1 } from "@/db";
import {
  adminRest,
  createConfirmedUser,
  findAuthUserByEmail,
  getProfile,
  signInWithPassword,
  updateAuthUserPassword,
  upsertProfile,
  type SupabaseSession,
} from "@/lib/supabase";

interface LegacyLoginRow {
  id: string;
  email: string;
  locale: "zh" | "en";
  credits: number;
  password_hash: string;
  password_salt: string;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function verifyLegacyPassword(
  password: string,
  expectedHash: string,
  salt: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const firstStage = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64ToBytes(salt).buffer as ArrayBuffer,
      iterations: 100_000,
    },
    passwordKey,
    256,
  );
  const secondStageKey = await crypto.subtle.importKey(
    "raw",
    firstStage,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const secondSalt = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`passwisely:v2:${salt}`),
  );
  const finalBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: secondSalt,
      iterations: 100_000,
    },
    secondStageKey,
    256,
  );
  const actualHash = bytesToBase64(new Uint8Array(finalBits));
  if (actualHash.length !== expectedHash.length) return false;
  let difference = 0;
  for (let index = 0; index < actualHash.length; index += 1) {
    difference |= actualHash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }
  return difference === 0;
}

async function migrateLegacyUser(
  legacy: LegacyLoginRow,
  password: string,
): Promise<SupabaseSession> {
  let authUser = await findAuthUserByEmail(legacy.email);
  if (authUser) {
    await updateAuthUserPassword(authUser.id, password);
  } else {
    authUser = await createConfirmedUser({
      email: legacy.email,
      password,
      locale: legacy.locale,
    });
  }

  await upsertProfile({
    id: authUser.id,
    email: legacy.email,
    locale: legacy.locale,
    credits: legacy.credits,
  });

  const legacyTransactions = await getD1()
    .prepare(
      `SELECT id, amount, balance_after, type, reference, created_at
       FROM credit_transactions WHERE user_id = ? ORDER BY created_at ASC`,
    )
    .bind(legacy.id)
    .all<{
      id: string;
      amount: number;
      balance_after: number;
      type: string;
      reference: string;
      created_at: number;
    }>();
  if (legacyTransactions.results.length) {
    await adminRest("credit_transactions?on_conflict=reference", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(
        legacyTransactions.results.map((transaction) => ({
          id: transaction.id,
          user_id: authUser.id,
          amount: transaction.amount,
          balance_after: transaction.balance_after,
          type: transaction.type,
          reference: transaction.reference,
          created_at: new Date(transaction.created_at * 1000).toISOString(),
        })),
      ),
    });
  }
  return signInWithPassword(legacy.email, password);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  let session: SupabaseSession;
  try {
    session = await signInWithPassword(email, password);
  } catch {
    const legacy = await getD1()
      .prepare(
        `SELECT id, email, locale, credits, password_hash, password_salt
         FROM users WHERE email = ?`,
      )
      .bind(email)
      .first<LegacyLoginRow>();
    if (
      !legacy ||
      !(await verifyLegacyPassword(password, legacy.password_hash, legacy.password_salt))
    ) {
      return jsonError("Email or password is incorrect.", 401);
    }
    try {
      session = await migrateLegacyUser(legacy, password);
    } catch {
      return jsonError("Could not migrate this account. Please try again.", 503);
    }
  }

  const profile = await getProfile(session.user.id);
  if (!profile) return jsonError("Account profile is unavailable.", 503);
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
}
