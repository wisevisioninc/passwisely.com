import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
