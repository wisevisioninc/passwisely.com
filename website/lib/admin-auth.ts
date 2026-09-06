import { env } from "cloudflare:workers";
import { cookies } from "next/headers";

const COOKIE_NAME = "pw_admin";
const SESSION_SECONDS = 60 * 60 * 12;
const encoder = new TextEncoder();

function environment(): Record<string, string | undefined> {
  return env as unknown as Record<string, string | undefined>;
}

export function adminCredentials() {
  const values = environment();
  const development = process.env.NODE_ENV !== "production";
  return {
    username: values.ADMIN_USERNAME?.trim() || (development ? "admin" : ""),
    password: values.ADMIN_PASSWORD?.trim() || (development ? "admin" : ""),
    secret:
      values.ADMIN_SESSION_SECRET?.trim() ||
      (development ? "passwisely-development-admin-secret" : ""),
  };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function signature(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(adminCredentials().secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function verifyAdminCredentials(username: unknown, password: unknown): boolean {
  const expected = adminCredentials();
  return (
    Boolean(expected.username && expected.password && expected.secret) &&
    typeof username === "string" &&
    typeof password === "string" &&
    safeEqual(username, expected.username) &&
    safeEqual(password, expected.password)
  );
}

export async function createAdminSession(): Promise<void> {
  if (!adminCredentials().secret) {
    throw new Error("Admin session secret is not configured.");
  }
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `admin.${expiresAt}`;
  (await cookies()).set(COOKIE_NAME, `${payload}.${await signature(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function clearAdminSession(): Promise<void> {
  (await cookies()).set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const value = (await cookies()).get(COOKIE_NAME)?.value || "";
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "admin") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() / 1000) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  return safeEqual(parts[2], await signature(payload));
}
