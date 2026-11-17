import { cookies } from "next/headers";
import type { CreditBalanceDetails } from "../../shared/billing";
import {
  adminRest,
  getAuthUser,
  getProfile,
  refreshSession,
  signOut,
  type ProfileRow,
  type SupabaseSession,
} from "@/lib/supabase";

const ACCESS_COOKIE = "pw_access";
const REFRESH_COOKIE = "pw_refresh";
const DESKTOP_SESSION_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

export interface AccountUser {
  id: string;
  email: string;
  locale: "zh" | "en";
  credits: number;
  creditBalance: CreditBalanceDetails;
}

function profileToUser(profile: ProfileRow): AccountUser {
  return {
    id: profile.id,
    email: profile.email,
    locale: profile.locale,
    credits: profile.credits,
    creditBalance: profile.creditBalance,
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function randomToken(byteLength = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validateCredentials(email: string, password: unknown): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return "Please enter a valid email address.";
  }
  return validatePassword(password);
}

export function validatePassword(password: unknown): string | null {
  if (
    typeof password !== "string" ||
    password.length < 10 ||
    password.length > 128 ||
    !/[A-Za-z]/.test(password) ||
    !/\d/.test(password)
  ) {
    return "Password must be 10–128 characters and include a letter and a number.";
  }
  return null;
}

async function setWebSession(session: SupabaseSession): Promise<void> {
  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV !== "development";
  cookieStore.set(ACCESS_COOKIE, session.access_token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(60, session.expires_in || 3600),
  });
  cookieStore.set(REFRESH_COOKIE, session.refresh_token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: DESKTOP_SESSION_SECONDS,
  });
}

export async function createSession(session: SupabaseSession): Promise<void> {
  await setWebSession(session);
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  if (accessToken) await signOut(accessToken).catch(() => undefined);
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
    cookieStore.set(name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV !== "development",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}

async function userFromAccessToken(accessToken: string): Promise<AccountUser | null> {
  try {
    const authUser = await getAuthUser(accessToken);
    const profile = await getProfile(authUser.id);
    return profile ? profileToUser(profile) : null;
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<AccountUser | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value || "";
  if (accessToken) {
    const user = await userFromAccessToken(accessToken);
    if (user) return user;
  }

  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value || "";
  if (!refreshToken) return null;
  try {
    const session = await refreshSession(refreshToken);
    try {
      await setWebSession(session);
    } catch {
      // Server-rendered reads may not be allowed to mutate cookies. The API
      // route that follows will refresh and persist the session.
    }
    const profile = await getProfile(session.user.id);
    return profile ? profileToUser(profile) : null;
  } catch {
    return null;
  }
}

export function jsonError(
  message: string,
  status: number,
  code?: string,
): Response {
  return Response.json(code ? { error: message, code } : { error: message }, {
    status,
  });
}

export function getBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

/** Supabase access tokens are JWTs (three dot-separated parts). Desktop session
 * tokens are opaque base64url strings, so asking Supabase Auth about one always
 * fails and only adds a network round trip. */
function looksLikeJwt(token: string): boolean {
  return token.split(".").length === 3;
}

async function desktopSessionUserId(token: string): Promise<string | null> {
  const tokenHash = await sha256(token);
  const sessions = await adminRest<Array<{ user_id: string }>>(
    `desktop_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=user_id&limit=1`,
  );
  return sessions[0]?.user_id || null;
}

export async function getApiUser(request: Request): Promise<AccountUser | null> {
  const token = getBearerToken(request);
  if (!token) return getCurrentUser();

  if (looksLikeJwt(token)) {
    const supabaseUser = await userFromAccessToken(token);
    if (supabaseUser) return supabaseUser;
  }

  const userId = await desktopSessionUserId(token);
  if (!userId) return null;
  const profile = await getProfile(userId);
  return profile ? profileToUser(profile) : null;
}

/** Identity only, for hot paths that do not need the profile or balance (the
 * AI relay debits atomically and fails with 402 on its own). A desktop token
 * costs one session lookup instead of four sequential Supabase requests. */
export async function getApiUserId(request: Request): Promise<string | null> {
  const token = getBearerToken(request);
  if (!token) return (await getCurrentUser())?.id || null;
  if (looksLikeJwt(token)) {
    const supabaseUser = await userFromAccessToken(token);
    if (supabaseUser) return supabaseUser.id;
  }
  // A database failure propagates (as before) rather than posing as an
  // expired session, which would send the desktop client to re-authenticate.
  return desktopSessionUserId(token);
}

export async function createApiSession(userId: string): Promise<string> {
  const token = randomToken();
  await adminRest("desktop_sessions", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      token_hash: await sha256(token),
      user_id: userId,
      expires_at: new Date(Date.now() + DESKTOP_SESSION_SECONDS * 1000).toISOString(),
    }),
  });
  return token;
}
