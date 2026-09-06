import assert from "node:assert/strict";
import test from "node:test";
import { checkAdminStatistics, configFromEnvironment } from "../scripts/supabase-healthcheck.mjs";

test("health check logs into the admin dashboard and fetches statistics", async () => {
  const requests = [];
  const result = await checkAdminStatistics(
    { baseUrl: "https://admin.passwisely.com", username: "admin", password: "admin" },
    async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith("/login")) return new Response('{"success":true}', { status: 200, headers: { "set-cookie": "pw_admin=session; Path=/; HttpOnly" } });
      return Response.json({ totalUsers: 12, activeUsers: 5, dau: 2, requests7d: 18, tokens7d: 4000, totalTokens: 9000, daily: [], services: [{ state: "healthy" }] });
    },
  );
  assert.deepEqual(result.checks, ["admin-login", "admin-statistics", "service-health"]);
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(requests[0].init.body).username, "admin");
  assert.match(requests[1].init.headers.cookie, /^pw_admin=/);
  assert.equal(result.summary.totalUsers, 12);
  assert.equal(result.summary.servicesHealthy, 1);
});

test("health check requires explicit admin credentials", () => {
  assert.throws(() => configFromEnvironment({}), /must be configured/);
  assert.deepEqual(configFromEnvironment({ ADMIN_USERNAME: "ops", ADMIN_PASSWORD: "secret" }), { baseUrl: "https://admin.passwisely.com", username: "ops", password: "secret" });
});
