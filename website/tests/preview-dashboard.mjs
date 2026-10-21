/**
 * Browser QA with the actual PassWiselySite/Dashboard and synthetic API transport.
 * Run with the repo's Node runtime: node website/tests/preview-dashboard.mjs
 * Open the printed 127.0.0.1 URL. ?scenario=success|empty|error|unauthorized selects
 * deterministic fixtures. No production credentials, providers, payments, or DB.
 * The temporary compiled output is removed on SIGINT/SIGTERM or server close.
 */
import { createServer } from "node:http";
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_SCENARIOS, fixtureAccount, fixtureUsage, fixtureUser } from "./fixtures/dashboard-usage.mjs";

const website = fileURLToPath(new URL("..", import.meta.url));
const repo = path.dirname(website);
const require = createRequire(path.join(website, "package.json"));
const { build } = require("esbuild");
const temporary = await mkdtemp(path.join(tmpdir(), "passwisely-dashboard-preview-"));
const cookieName = "pw_dashboard_preview_case";
const contentTypes = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon" };
let server;
let closing = false;

async function cleanup(exitCode = 0) {
  if (closing) return;
  closing = true;
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await rm(temporary, { recursive: true, force: true });
  process.exitCode = exitCode;
}

try {
  const entry = path.join(temporary, "entry.tsx");
  await writeFile(entry, `import { createRoot } from ${JSON.stringify(require.resolve("react-dom/client"))};\nimport { PassWiselySite } from ${JSON.stringify(path.join(website, "app/PassWiselySite.tsx"))};\nimport ${JSON.stringify(path.join(website, "app/globals.css"))};\ncreateRoot(document.getElementById("root")!).render(<PassWiselySite initialDashboard={window.location.pathname === "/dashboard"} />);\n`);
  const output = path.join(temporary, "out");
  await build({
    entryPoints: [entry], outdir: output, entryNames: "preview", assetNames: "assets/[name]-[hash]",
    absWorkingDir: website, bundle: true, format: "esm", platform: "browser", jsx: "automatic", target: "es2022",
    nodePaths: [path.join(website, "node_modules"), path.join(repo, "node_modules")],
    tsconfig: path.join(website, "tsconfig.json"), loader: { ".woff2": "file" }, conditions: ["style", "browser", "import", "default"],
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
    logLevel: "warning",
  });
  // Serve only the exact compiler outputs and these existing public assets.
  const assets = new Map();
  async function collect(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) await collect(absolute);
      else if (item.isFile()) assets.set(`/${path.relative(output, absolute).split(path.sep).join("/")}`, absolute);
      else throw new Error("Unexpected preview output entry.");
    }
  }
  await collect(output);
  for (const filename of ["passwisely-logo.png", "passwisely-logo-192.png", "favicon.ico"]) {
    const absolute = path.join(website, "public", filename);
    if (!(await lstat(absolute)).isFile()) throw new Error("Missing preview asset.");
    assets.set(`/${filename}`, absolute);
  }
  const json = (response, status, value, extra = {}) => {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra });
    response.end(JSON.stringify(value));
  };
  function scenarioFor(request) {
    const value = request.headers.cookie?.split(";").map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    return FIXTURE_SCENARIOS.includes(value) ? value : "success";
  }
  const scenarioCookie = scenario => `${cookieName}=${scenario}; Path=/; HttpOnly; SameSite=Strict`;
  async function drain(request) { for await (const chunk of request) { void chunk; } }
  server = createServer(async (request, response) => {
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      if (request.headers.host !== `127.0.0.1:${address.port}` || request.headers.origin && request.headers.origin !== origin) { await drain(request); json(response, 403, { error: "Local preview origin only." }); return; }
      const url = new URL(request.url, origin);
      const scenario = scenarioFor(request);
      const api = url.pathname.startsWith("/api/");
      if (api) await drain(request);
      if (request.method === "GET" && url.pathname === "/api/account/usage") {
        if (scenario === "unauthorized") return json(response, 401, { error: "Synthetic signed-out scenario." });
        if (scenario === "error") return json(response, 503, { error: "Synthetic usage service failure.", code: "USAGE_UNAVAILABLE" });
        const requestedDays = url.searchParams.get("days") || "30";
        if (!["7", "30"].includes(requestedDays)) return json(response, 400, { error: "Invalid preview period." });
        try { return json(response, 200, fixtureUsage({ days: Number(requestedDays), scenario, cursor: url.searchParams.get("cursor") })); }
        catch { return json(response, 400, { error: "Invalid preview cursor." }); }
      }
      if (request.method === "GET" && url.pathname === "/api/account") return scenario === "unauthorized" ? json(response, 401, { error: "Synthetic signed-out scenario." }) : json(response, 200, fixtureAccount(scenario));
      if (request.method === "POST" && url.pathname === "/api/auth/logout") return json(response, 200, { ok: true }, { "set-cookie": scenarioCookie("unauthorized") });
      if (request.method === "POST" && ["/api/auth/login", "/api/auth/register"].includes(url.pathname)) return json(response, 200, { user: fixtureUser() }, { "set-cookie": scenarioCookie("success") });
      if (request.method === "POST" && ["/api/auth/change-password", "/api/auth/reset-password", "/api/auth/forgot-password"].includes(url.pathname)) return json(response, 200, { ok: true, message: "Synthetic preview only. No account changed." });
      if (url.pathname === "/api/checkout") return json(response, 503, { error: "合成测试：支付在本地预览中禁用。 Payments are disabled in this local preview." });
      if (url.pathname.startsWith("/api/download/")) { response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); response.end("Synthetic local preview only. No installer is downloaded.\n"); return; }
      if (api) return json(response, 404, { error: "No local fixture for this API." });
      if (request.method === "GET" && assets.has(url.pathname)) {
        const file = assets.get(url.pathname);
        response.writeHead(200, { "content-type": contentTypes[path.extname(file)] || "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" });
        response.end(await readFile(file)); return;
      }
      if (request.method === "GET" && ["/", "/dashboard"].includes(url.pathname)) {
        const selected = url.searchParams.get("scenario");
        if (selected !== null && !FIXTURE_SCENARIOS.includes(selected)) return json(response, 400, { error: "Unknown synthetic preview scenario." });
        const activeScenario = selected || scenario;
        const options = FIXTURE_SCENARIOS.map(value => `<a href="/dashboard?scenario=${value}"${value === activeScenario ? ' aria-current="page"' : ""}>${value}</a>`).join("");
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
          ...(selected ? { "set-cookie": scenarioCookie(selected) } : {}),
        });
        response.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>合成测试 · PassWisely Dashboard</title><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/preview.css"><style>body{margin:0}.preview-banner{display:flex;align-items:center;flex-wrap:wrap;gap:8px 20px;min-height:38px;padding:8px 18px;color:#d4bd5d;background:#302b17;font:10px/1.5 system-ui,sans-serif;border-bottom:1px solid #64572b}.preview-banner strong{letter-spacing:.6px;font-size:10px}.preview-banner nav{display:flex;gap:12px}.preview-banner a{color:#c4b98d;text-decoration:none}.preview-banner a[aria-current]{color:#ffe281;text-decoration:underline}.preview-banner span{margin-left:auto;color:#a89c72}</style></head><body><aside class="preview-banner" aria-label="Synthetic fixture controls"><strong>合成测试数据 · LOCAL PREVIEW</strong><nav>${options}</nav><span>dashboard-preview@example.test · ${activeScenario}</span></aside><div id="root"></div><script type="module" src="/preview.js"></script></body></html>`); return;
      }
      await drain(request);
      json(response, 404, { error: "Preview route not found." });
    } catch {
      if (!response.headersSent) json(response, 500, { error: "Local preview failed." });
      else response.end();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  process.once("SIGINT", () => void cleanup());
  process.once("SIGTERM", () => void cleanup());
  server.once("close", () => void cleanup());
  console.log(JSON.stringify({ url: `http://127.0.0.1:${address.port}/dashboard?scenario=success`, purpose: "Actual PassWiselySite with synthetic local-only transport. No production account, keys, providers, or payments.", pid: process.pid, temporaryOutput: temporary }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Preview initialization failed.");
  await cleanup(1);
}
