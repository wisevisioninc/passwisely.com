import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createProductionTsLoader } from "../../desktop-api/tests/helpers/production-typescript.mjs";

test("admin analytics migration covers growth, revenue, conversion, and usage", async () => {
  const migration = await readFile(new URL("../supabase/migrations/0006_admin_observability.sql", import.meta.url), "utf8");
  for (const metric of [
    "new_users_30d",
    "online_sessions",
    "requests_30d",
    "revenue_30d",
    "payment_success_rate_30d",
    "resume_runs_30d",
    "action_breakdown",
    "provider_breakdown",
    "payment_breakdown",
  ]) assert.match(migration, new RegExp(`'${metric}'`));
  assert.match(migration, /Asia\/Shanghai/);
  assert.match(migration, /grant execute on function public\.admin_statistics\(\) to service_role/);
});

test("admin dashboard exposes business, service, and host monitoring views", async () => {
  const dashboard = await readFile(new URL("../app/admin/AdminDashboard.tsx", import.meta.url), "utf8");
  for (const label of ["运营概览", "服务监控", "站点设置", "月活用户 MAU", "支付成功率", "服务器资源", "当前 QPS", "安装包下载性能", "累计下载"]) {
    assert.match(dashboard, new RegExp(label));
  }
  assert.match(dashboard, /60_000/);
});

test("performance monitoring stores minute aggregates and download samples", async () => {
  const [migration, worker, site] = await Promise.all([
    readFile(new URL("../supabase/migrations/0007_performance_download_metrics.sql", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/LandingPage.tsx", import.meta.url), "utf8"),
  ]);
  for (const metric of ["qps_current", "qps_peak_1h", "avg_latency_ms_5m", "downloads_total", "download_performance"]) {
    assert.match(migration, new RegExp(`'${metric}'`));
  }
  assert.match(worker, /record_service_metrics/);
  assert.match(worker, /durationMsTotal/);
  assert.match(site, /\/api\/track-download\/mac-arm64/);
});

test("production admin authentication does not fall back to default credentials", async () => {
  const auth = await readFile(new URL("../lib/admin-auth.ts", import.meta.url), "utf8");
  assert.doesNotMatch(auth, /SUPABASE_SERVICE_ROLE_KEY\?\.trim\(\)/);
  assert.match(auth, /development \? "admin" : ""/);
});

// Execute the real health owner with synthetic runtime bindings. Network and AI
// seams are substituted because this checks configuration completeness only;
// it does not establish merchant-product permission or provider availability.
const alipayConfigFixture = {
  PUBLIC_SITE_URL: "https://site.example.invalid",
  ALIPAY_APP_ID: "synthetic-app",
  ALIPAY_SELLER_ID: "2088000000000000",
  ALIPAY_PRIVATE_KEY: "synthetic-application-key",
  ALIPAY_PUBLIC_KEY: "synthetic-platform-key",
};
for (const [description, overrides, expectedState] of [
  ["all required fields", {}, "healthy"],
  ["missing seller ID", { ALIPAY_SELLER_ID: undefined }, "degraded"],
  ["blank seller ID", { ALIPAY_SELLER_ID: "   " }, "degraded"],
  ["missing app ID", { ALIPAY_APP_ID: undefined }, "degraded"],
  ["missing private key", { ALIPAY_PRIVATE_KEY: undefined }, "degraded"],
  ["missing public key", { ALIPAY_PUBLIC_KEY: undefined }, "degraded"],
]) {
  test(`admin Alipay configuration health accounts for ${description}`, async t => {
    const env = { ...alipayConfigFixture, ...overrides };
    const { getAdminHealth } = createProductionTsLoader({ mocks: {
      "cloudflare:workers": { env },
      "@/lib/ai-catalog": { AI_PROVIDER_CATALOG: {} },
      "@/lib/ai-config": { getDefaultAiConfig: async () => null },
    } })(fileURLToPath(new URL("../lib/admin-health.ts", import.meta.url)));
    const requests = [];
    t.mock.method(globalThis, "fetch", async url => {
      requests.push(url);
      if (url === "http://127.0.0.1:3013/health") return Response.json({});
      assert.ok(String(url).startsWith("https://site.example.invalid/"));
      return new Response(null, { status: 200 });
    });
    const report = await getAdminHealth(1);
    const alipay = report.services.find(service => service.id === "alipay");
    assert.equal(alipay.group, "configuration");
    assert.equal(alipay.state, expectedState);
    assert.equal(alipay.detail, expectedState === "healthy" ? "生产配置完整" : "配置不完整");
    assert.equal(requests.length, 5);
  });
}
