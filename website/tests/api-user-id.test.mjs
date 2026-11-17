import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createProductionTsLoader } from "../../desktop-api/tests/helpers/production-typescript.mjs";
const source = relative => fileURLToPath(new URL(relative, import.meta.url));

function auth({ sessions = [{ user_id: "desktop-user" }], jwtUser = { id: "web-user" }, profile = true } = {}) {
  const calls = [];
  const mocks = {
    "next/headers": { cookies: async () => ({ get: () => undefined, set() {} }) },
    "@/lib/supabase": {
      getAuthUser: async token => { calls.push(["auth-user", token]); if (!jwtUser) throw new Error("invalid"); return jwtUser; },
      getProfile: async id => { calls.push(["profile", id]); return profile ? { id, email: "user@example.invalid", locale: "zh", credits: 5, creditBalance: { balance: 5 } } : null; },
      adminRest: async path => { calls.push(["rest", path.split("?")[0]]); return sessions; },
      refreshSession: async () => { throw new Error("no refresh"); },
      signOut: async () => {},
    },
  };
  const owner = createProductionTsLoader({ mocks })(source("../lib/auth.ts"));
  return { calls, ...owner };
}
const request = token => new Request("https://site.example.invalid/api/ai/chat/completions", { headers: token ? { authorization: `Bearer ${token}` } : {} });
const desktopToken = "A".repeat(43); // opaque base64url session token, never a JWT
const jwt = "aaa.bbb.ccc";

test("a desktop session token is resolved with one session lookup and no Supabase Auth or profile reads", async () => {
  const f = auth();
  assert.equal(await f.getApiUserId(request(desktopToken)), "desktop-user");
  assert.deepEqual(f.calls, [["rest", "desktop_sessions"]]);
});

test("an unknown or expired desktop token is rejected without consulting Supabase Auth", async () => {
  const f = auth({ sessions: [] });
  assert.equal(await f.getApiUserId(request(desktopToken)), null);
  assert.equal(await f.getApiUser(request(desktopToken)), null);
  assert.ok(f.calls.every(([name]) => name === "rest"));
});

test("a Supabase access token is still verified with Supabase Auth and requires a profile", async () => {
  const f = auth();
  assert.equal(await f.getApiUserId(request(jwt)), "web-user");
  assert.deepEqual(f.calls.map(([name]) => name), ["auth-user", "profile"]);
  const rejected = auth({ jwtUser: null, sessions: [] });
  assert.equal(await rejected.getApiUserId(request(jwt)), null);
  assert.deepEqual(rejected.calls.map(([name]) => name), ["auth-user", "rest"]);
});

test("account reads keep returning the full profile for a desktop token, minus the wasted Auth request", async () => {
  const f = auth();
  const user = await f.getApiUser(request(desktopToken));
  assert.equal(user.id, "desktop-user"); assert.equal(user.credits, 5);
  assert.deepEqual(f.calls.map(([name]) => name), ["rest", "profile"]);
});

test("a database failure is not reported as an expired session; a missing token is unauthenticated", async () => {
  const f = auth();
  const failing = createProductionTsLoader({ mocks: {
    "next/headers": { cookies: async () => ({ get: () => undefined, set() {} }) },
    "@/lib/supabase": { getAuthUser: async () => { throw new Error("x"); }, getProfile: async () => null, adminRest: async () => { throw new Error("database unavailable"); }, refreshSession: async () => { throw new Error("x"); }, signOut: async () => {} },
  } })(source("../lib/auth.ts"));
  await assert.rejects(failing.getApiUserId(request(desktopToken)), /database unavailable/);
  assert.equal(await f.getApiUserId(request("")), null);
});
