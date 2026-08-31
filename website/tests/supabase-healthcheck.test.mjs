import assert from "node:assert/strict";
import test from "node:test";

import {
  checkSupabase,
  configFromEnvironment,
} from "../scripts/supabase-healthcheck.mjs";

test("health check performs three authenticated read-only database queries", async () => {
  const requests = [];
  const result = await checkSupabase(
    {
      url: "https://example.supabase.co",
      key: "test-service-key",
    },
    async (url, init) => {
      requests.push({ url, init });
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );

  assert.deepEqual(result.checks, [
    "profiles",
    "credit_transactions",
    "purchases",
  ]);
  assert.equal(requests.length, 3);

  for (const request of requests) {
    assert.equal(request.init.method, "GET");
    assert.equal(request.init.headers.apikey, "test-service-key");
    assert.equal(
      request.init.headers.authorization,
      "Bearer test-service-key",
    );
    assert.match(request.url, /\?select=id&limit=1$/);
  }
});

test("health check requires server-side Supabase configuration", () => {
  assert.throws(
    () => configFromEnvironment({}),
    /SUPABASE_URL is not configured/,
  );
  assert.throws(
    () => configFromEnvironment({ SUPABASE_URL: "https://example.test" }),
    /SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is not configured/,
  );
});
