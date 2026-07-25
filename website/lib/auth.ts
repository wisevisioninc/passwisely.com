import { cookies } from "next/headers";
import { getD1 } from "@/db";

const SESSION_COOKIE = "pw_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

export interface AccountUser {
  id: string;
  email: string;
  locale: "zh" | "en";
  credits: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(byteLength = 32): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(byteLength)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

export async function hashPassword(
  password: string,
  salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16))),
): Promise<{ hash: string; salt: string }> {
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
  return { hash: bytesToBase64(new Uint8Array(finalBits)), salt };
}

export async function verifyPassword(
  password: string,
  expectedHash: string,
  salt: string,
): Promise<boolean> {
  const { hash } = await hashPassword(password, salt);
  if (hash.length !== expectedHash.length) return false;
  let difference = 0;
  for (let index = 0; index < hash.length; index += 1) {
    difference |= hash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }
  return difference === 0;
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validateCredentials(email: string, password: unknown): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return "Please enter a valid email address.";
  }
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

export async function createSession(userId: string): Promise<void> {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  await getD1()
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(tokenHash, userId, now + SESSION_SECONDS, now)
    .run();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await getD1()
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await sha256(token))
      .run();
  }
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getCurrentUser(): Promise<AccountUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = await getD1()
    .prepare(
      `SELECT u.id, u.email, u.locale, u.credits
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(await sha256(token), now)
    .first<AccountUser>();
  return row || null;
}

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export function getBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

export async function getApiUser(request: Request): Promise<AccountUser | null> {
  const token = getBearerToken(request);
  if (!token) return getCurrentUser();
  const now = Math.floor(Date.now() / 1000);
  return (
    (await getD1()
      .prepare(
        `SELECT u.id, u.email, u.locale, u.credits
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .bind(await sha256(token), now)
      .first<AccountUser>()) || null
  );
}

export async function createApiSession(userId: string): Promise<string> {
  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  await getD1()
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(await sha256(token), userId, now + SESSION_SECONDS, now)
    .run();
  return token;
}
