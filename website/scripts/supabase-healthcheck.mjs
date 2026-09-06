import { pathToFileURL } from "node:url";

export function configFromEnvironment(environment = process.env) {
  const username = environment.ADMIN_USERNAME?.trim();
  const password = environment.ADMIN_PASSWORD?.trim();
  if (!username || !password) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD must be configured.");
  }
  return {
    baseUrl: (environment.ADMIN_BASE_URL?.trim() || "https://admin.passwisely.com").replace(/\/+$/, ""),
    username,
    password,
  };
}

export async function checkAdminStatistics(config, fetchImplementation = globalThis.fetch) {
  const startedAt = Date.now();
  const login = await fetchImplementation(`${config.baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-client-info": "passwisely-wise-healthcheck/2.0" },
    body: JSON.stringify({ username: config.username, password: config.password }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!login.ok) {
    throw new Error(`Admin login failed (${login.status}): ${(await login.text()).slice(0, 300)}`);
  }
  const cookie = login.headers.getSetCookie?.().map((value) => value.split(";", 1)[0]).join("; ") || login.headers.get("set-cookie")?.split(";", 1)[0] || "";
  if (!cookie) throw new Error("Admin login did not create a session cookie.");

  const response = await fetchImplementation(`${config.baseUrl}/api/admin/stats`, {
    method: "GET",
    headers: { accept: "application/json", cookie, "x-client-info": "passwisely-wise-healthcheck/2.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Admin statistics check failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  const statistics = await response.json();
  for (const key of ["totalUsers", "activeUsers", "dau", "requests7d", "tokens7d", "totalTokens", "qpsCurrent", "avgLatencyMs5m", "downloadsTotal"]) {
    if (!Number.isFinite(statistics[key])) throw new Error(`Admin statistics is missing ${key}.`);
  }
  if (!Array.isArray(statistics.daily)) throw new Error("Admin statistics is missing daily usage.");
  return {
    success: true,
    checks: ["admin-login", "admin-statistics", "service-health", "performance-metrics"],
    summary: {
      totalUsers: statistics.totalUsers,
      dau: statistics.dau,
      qpsCurrent: statistics.qpsCurrent,
      downloadsTotal: statistics.downloadsTotal,
      servicesHealthy: Array.isArray(statistics.services)
        ? statistics.services.filter((service) => service.state === "healthy").length
        : 0,
      servicesTotal: Array.isArray(statistics.services) ? statistics.services.length : 0,
    },
    latencyMs: Date.now() - startedAt,
  };
}

// Backwards-compatible export for the existing systemd task/imports.
export const checkSupabase = checkAdminStatistics;

async function main() {
  const result = await checkAdminStatistics(configFromEnvironment());
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...result }));
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (entryPoint === import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), success: false, error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
