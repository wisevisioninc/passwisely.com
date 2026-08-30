import { env } from "cloudflare:workers";

type SupabaseEnvironment = Record<string, string | undefined>;

export interface SupabaseAuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type: string;
  user: SupabaseAuthUser;
}

export interface ProfileRow {
  id: string;
  email: string;
  locale: "zh" | "en";
  credits: number;
  created_at: string;
  updated_at: string;
}

export class SupabaseRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function runtimeEnv(): SupabaseEnvironment {
  return env as unknown as SupabaseEnvironment;
}

function required(name: string): string {
  const value = runtimeEnv()[name]?.trim();
  if (!value) throw new Error(`Supabase configuration is missing: ${name}`);
  return value;
}

export function getSupabaseConfig() {
  return {
    url: required("SUPABASE_URL").replace(/\/+$/, ""),
    publishableKey:
      runtimeEnv().SUPABASE_PUBLISHABLE_KEY?.trim() ||
      required("SUPABASE_ANON_KEY"),
    secretKey:
      runtimeEnv().SUPABASE_SECRET_KEY?.trim() ||
      required("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

function messageFromPayload(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const data = payload as Record<string, unknown>;
  for (const key of ["msg", "message", "error_description", "error", "hint"]) {
    if (typeof data[key] === "string" && data[key]) return data[key];
  }
  return fallback;
}

async function request<T>(
  path: string,
  init: RequestInit,
  options: { accessToken?: string; admin?: boolean } = {},
): Promise<T> {
  const config = getSupabaseConfig();
  const apiKey = options.admin ? config.secretKey : config.publishableKey;
  const headers = new Headers(init.headers);
  headers.set("apikey", apiKey);
  headers.set("authorization", `Bearer ${options.accessToken || apiKey}`);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");

  const response = await fetch(`${config.url}${path}`, { ...init, headers });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new SupabaseRequestError(
      messageFromPayload(payload, `Supabase request failed (${response.status}).`),
      response.status,
      payload,
    );
  }
  return payload as T;
}

export function signInWithPassword(
  email: string,
  password: string,
): Promise<SupabaseSession> {
  return request<SupabaseSession>(
    "/auth/v1/token?grant_type=password",
    { method: "POST", body: JSON.stringify({ email, password }) },
  );
}

export function refreshSession(refreshToken: string): Promise<SupabaseSession> {
  return request<SupabaseSession>(
    "/auth/v1/token?grant_type=refresh_token",
    { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) },
  );
}

export function requestPasswordReset(
  email: string,
  redirectTo: string,
): Promise<unknown> {
  return request(
    `/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`,
    { method: "POST", body: JSON.stringify({ email }) },
  );
}

export async function createConfirmedUser(input: {
  email: string;
  password: string;
  locale: "zh" | "en";
}): Promise<SupabaseAuthUser> {
  const response = await request<{ user?: SupabaseAuthUser } | SupabaseAuthUser>(
    "/auth/v1/admin/users",
    {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: { locale: input.locale },
      }),
    },
    { admin: true },
  );
  if ("user" in response && !("id" in response)) {
    if (response.user) return response.user;
    throw new SupabaseRequestError("Supabase did not return the created user.", 502);
  }
  return response as SupabaseAuthUser;
}

export async function findAuthUserByEmail(
  email: string,
): Promise<SupabaseAuthUser | null> {
  const response = await request<{ users: SupabaseAuthUser[] }>(
    `/auth/v1/admin/users?page=1&per_page=100`,
    { method: "GET" },
    { admin: true },
  );
  return (
    response.users.find(
      (user) => (user.email || "").toLowerCase() === email.toLowerCase(),
    ) || null
  );
}

export function updateAuthUserPassword(
  userId: string,
  password: string,
): Promise<SupabaseAuthUser> {
  return request<SupabaseAuthUser>(
    `/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    { method: "PUT", body: JSON.stringify({ password, email_confirm: true }) },
    { admin: true },
  );
}

export function getAuthUser(accessToken: string): Promise<SupabaseAuthUser> {
  return request<SupabaseAuthUser>(
    "/auth/v1/user",
    { method: "GET" },
    { accessToken },
  );
}

export function signOut(accessToken: string): Promise<unknown> {
  return request(
    "/auth/v1/logout",
    { method: "POST" },
    { accessToken },
  );
}

export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const rows = await request<ProfileRow[]>(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,locale,credits,created_at,updated_at&limit=1`,
    { method: "GET" },
    { admin: true },
  );
  return rows[0] || null;
}

export async function findProfileByEmail(
  email: string,
): Promise<ProfileRow | null> {
  const rows = await request<ProfileRow[]>(
    `/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id,email,locale,credits,created_at,updated_at&limit=1`,
    { method: "GET" },
    { admin: true },
  );
  return rows[0] || null;
}

export async function upsertProfile(input: {
  id: string;
  email: string;
  locale: "zh" | "en";
  credits: number;
}): Promise<void> {
  await request(
    "/rest/v1/profiles?on_conflict=id",
    {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        ...input,
        updated_at: new Date().toISOString(),
      }),
    },
    { admin: true },
  );
}

export function adminRest<T>(
  path: string,
  init: RequestInit = { method: "GET" },
): Promise<T> {
  return request<T>(`/rest/v1/${path}`, init, { admin: true });
}

export function adminRpc<T>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  return adminRest<T>(`rpc/${functionName}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
