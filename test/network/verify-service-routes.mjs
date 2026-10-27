#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HELP = `Read-only public PassWisely route verification:
  node test/network/verify-service-routes.mjs --origin HTTPS_ORIGIN --grpc HOST:PORT --out NEW_JSON
  Add --dry-run to validate arguments, catalog and proto without network.

Required: --origin HTTPS origin only; --grpc TLS authority; --out new JSON path.
Optional: --timeout-ms 1000..60000 (default 15000); --dry-run; --help.
No account, credentials, payment order, recording or model request is accepted.
`;
const PLATFORMS = ["mac-arm64", "mac-x64", "windows-x64"];
const MAX_HTML_BYTES = 2 * 1024 * 1024;
class VerificationError extends Error {
  constructor(code, facts = {}) {
    super(code); this.code = code; this.publicFacts = {};
    if (Number.isInteger(facts.httpStatus) && facts.httpStatus >= 100 && facts.httpStatus <= 599) this.publicFacts.httpStatus = facts.httpStatus;
    if (Number.isInteger(facts.grpcCode) && facts.grpcCode >= 0 && facts.grpcCode <= 16) this.publicFacts.grpcCode = facts.grpcCode;
  }
}
const fail = (code, facts) => { throw new VerificationError(code, facts); };

export function parseArgs(argv) {
  const options = { timeoutMs: 15_000, dryRun: false };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (seen.has(name)) fail("DUPLICATE_ARGUMENT");
    seen.add(name);
    if (name === "--help") { options.help = true; continue; }
    if (name === "--dry-run") { options.dryRun = true; continue; }
    const key = { "--origin": "origin", "--grpc": "grpc", "--out": "out", "--timeout-ms": "timeoutMs" }[name];
    if (!key) fail("UNKNOWN_ARGUMENT");
    const value = argv[++i];
    if (!value || value.startsWith("--")) fail("MISSING_ARGUMENT_VALUE");
    options[key] = value;
  }
  if (options.help) return options;
  if (!options.origin || !options.grpc || !options.out) fail("EXPLICIT_ORIGIN_GRPC_OUT_REQUIRED");
  if (!/^https:\/\/[^/?#\\@\s]+\/?$/.test(options.origin)) fail("HTTPS_ORIGIN_ONLY_REQUIRED");
  let origin;
  try { origin = new URL(options.origin); } catch { fail("HTTPS_ORIGIN_ONLY_REQUIRED"); }
  if (origin.protocol !== "https:" || !origin.hostname || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) fail("HTTPS_ORIGIN_ONLY_REQUIRED");
  options.origin = origin.origin;
  const authority = /^(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+):(\d+)$/.exec(options.grpc);
  if (!authority || Number(authority[2]) < 1 || Number(authority[2]) > 65535) fail("GRPC_TLS_AUTHORITY_REQUIRED");
  try { if (!new URL(`https://${options.grpc}`).hostname) fail("GRPC_TLS_AUTHORITY_REQUIRED"); } catch { fail("GRPC_TLS_AUTHORITY_REQUIRED"); }
  if (!/^\d+$/.test(String(options.timeoutMs)) || Number(options.timeoutMs) < 1000 || Number(options.timeoutMs) > 60_000) fail("INVALID_TIMEOUT");
  options.timeoutMs = Number(options.timeoutMs);
  options.out = path.resolve(options.out);
  if (fs.existsSync(options.out)) fail("OUTPUT_ALREADY_EXISTS");
  return options;
}

function loadContracts(repo) {
  const require = createRequire(path.join(repo, "package.json"));
  const ts = require("typescript");
  const catalogFile = path.join(repo, "website/lib/download-artifacts.json");
  let catalog;
  try { catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8")); } catch { fail("LOCAL_CATALOG_INVALID"); }
  const sourceFile = path.join(repo, "website/lib/downloads.ts");
  const code = ts.transpileModule(fs.readFileSync(sourceFile, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: sourceFile,
  }).outputText;
  const module = { exports: {} };
  // Execute the actual download owner with its actual JSON input. Do not copy
  // its URL/version/SHA interpretation into this verifier.
  try {
    new Function("require", "module", "exports", code)(id => {
      if (id !== "./download-artifacts.json") fail("DOWNLOAD_OWNER_IMPORT_CHANGED");
      return catalog;
    }, module, module.exports);
  } catch (error) { if (error instanceof VerificationError) throw error; fail("LOCAL_CATALOG_INVALID"); }
  const artifacts = PLATFORMS.map(platform => module.exports.downloadArtifact(platform));
  if (artifacts.some(item => !item?.available || !item.sha256 || item.version !== catalog.releaseVersion || !item.bytes)) fail("LOCAL_CATALOG_INCOMPLETE");
  const grpc = require("@grpc/grpc-js"), loader = require("@grpc/proto-loader");
  const definition = loader.loadSync(path.join(repo, "proto/desktop_ai.proto"), { defaults: true, oneofs: true });
  const Client = grpc.loadPackageDefinition(definition)?.passwisely?.desktop?.v1?.DesktopAI;
  if (!Client) fail("LOCAL_GRPC_CONTRACT_INVALID");
  return { artifacts, releaseVersion: catalog.releaseVersion, grpc, Client };
}

function transportCode(error) {
  if (error instanceof VerificationError) return error.code;
  if (["ENOTFOUND", "EAI_AGAIN"].includes(error?.code)) return "DNS_FAILED";
  if (["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"].includes(error?.code)) return "CONNECTION_FAILED";
  if (["CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_NOT_YET_VALID", "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED"].includes(error?.code)) return "TLS_VERIFICATION_FAILED";
  return "TRANSPORT_FAILED";
}

function publicCertificate(socket) {
  if (!socket?.authorized) fail("TLS_NOT_AUTHORIZED");
  const certificate = socket.getPeerCertificate();
  return { authorized: true, protocol: socket.getProtocol(), fingerprint256: certificate.fingerprint256, validFrom: certificate.valid_from, validTo: certificate.valid_to,
    subjectCN: certificate.subject?.CN || null, issuerCN: certificate.issuer?.CN || null, subjectAltName: certificate.subjectaltname || null };
}

async function request(url, { method = "GET", body = undefined, html = false, timeoutMs }) {
  const secure = url.protocol === "https:";
  const agent = secure ? new https.Agent({ keepAlive: false, maxSockets: 1, rejectUnauthorized: true }) : new http.Agent({ keepAlive: false, maxSockets: 1 });
  try {
    return await new Promise((resolve, reject) => {
      let done = false, response, timer;
      const finish = (error, value) => {
        if (done) return;
        done = true; clearTimeout(timer);
        response?.destroy(); call.destroy();
        if (error) reject(error); else resolve(value);
      };
      const call = (secure ? https : http).request(url, { method, agent, rejectUnauthorized: true,
        headers: { accept: html ? "text/html" : "application/json", ...(body !== undefined ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}) } }, incoming => {
        response = incoming;
        let certificate;
        try { certificate = secure ? publicCertificate(incoming.socket) : undefined; } catch (error) { finish(error); return; }
        const base = { status: incoming.statusCode, location: incoming.headers.location, version: incoming.headers["x-passwisely-release-version"], sha256: incoming.headers["x-passwisely-artifact-sha256"], certificate };
        if (!html) { finish(null, base); return; }
        let bytes = 0; const chunks = [];
        incoming.on("data", chunk => {
          bytes += chunk.length;
          if (bytes > MAX_HTML_BYTES) { finish(new VerificationError("HTML_CAPACITY_EXCEEDED")); return; }
          chunks.push(chunk);
        });
        incoming.once("end", () => finish(null, { ...base, html: Buffer.concat(chunks).toString("utf8") }));
        incoming.once("error", error => finish(error));
      });
      timer = setTimeout(() => finish(new VerificationError("REQUEST_TIMEOUT")), timeoutMs);
      call.once("error", error => finish(error));
      call.end(body);
    });
  } finally { agent.destroy(); }
}

async function grpcUnary(client, method, grpc, timeoutMs, expectedUnauthenticated = false) {
  let call;
  try {
    return await new Promise((resolve, reject) => {
      call = client[method]({}, new grpc.Metadata(), { deadline: Date.now() + timeoutMs }, (error, result) => {
        if (expectedUnauthenticated) {
          if (error?.code === grpc.status.UNAUTHENTICATED) resolve({ grpcCode: grpc.status.UNAUTHENTICATED });
          else reject(new VerificationError(error?.code === grpc.status.DEADLINE_EXCEEDED ? "GRPC_TIMEOUT" : "GRPC_UNAUTHENTICATED_REQUIRED", { grpcCode: error?.code }));
        } else if (error) reject(new VerificationError(error.code === grpc.status.DEADLINE_EXCEEDED ? "GRPC_TIMEOUT" : "GRPC_HEALTH_FAILED", { grpcCode: error.code }));
        else if (result?.status !== "SERVING") reject(new VerificationError("GRPC_NOT_SERVING"));
        else resolve({ status: "SERVING", transport: result.transport === "grpc+protobuf" ? result.transport : "other" });
      });
    });
  } finally { call?.cancel(); }
}

async function grpcStream(client, grpc, timeoutMs) {
  let stream;
  try {
    return await new Promise((resolve, reject) => {
      let done = false, receivedData = false;
      const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
      const timer = setTimeout(() => finish(new VerificationError("GRPC_TIMEOUT")), timeoutMs);
      try { stream = client.ChatStream({}, new grpc.Metadata(), { deadline: Date.now() + timeoutMs }); }
      catch { finish(new VerificationError("GRPC_STREAM_SETUP_FAILED")); return; }
      stream.on("data", () => { receivedData = true; finish(new VerificationError("GRPC_UNEXPECTED_CONTENT")); stream.cancel(); });
      stream.on("error", error => {
        if (error.code === grpc.status.UNAUTHENTICATED && !receivedData) finish(null, { grpcCode: grpc.status.UNAUTHENTICATED, receivedData: false });
        else finish(new VerificationError(error.code === grpc.status.DEADLINE_EXCEEDED ? "GRPC_TIMEOUT" : "GRPC_UNAUTHENTICATED_REQUIRED", { grpcCode: error.code }));
      });
      stream.once("end", () => finish(new VerificationError("GRPC_STREAM_ENDED_WITHOUT_AUTH_REJECTION")));
    });
  } finally { stream?.cancel(); }
}

export async function verifyRoutes(options, repo = fileURLToPath(new URL("../../", import.meta.url))) {
  const contracts = loadContracts(repo), began = performance.now();
  const report = { schemaVersion: 1, startedAtUtc: new Date().toISOString(), origin: options.origin, grpcAuthority: options.grpc, mode: options.dryRun ? "offline-plan" : "public-read-only", success: false, checks: [], releaseVersion: contracts.releaseVersion,
    expectedDownloads: contracts.artifacts.map(({ platform, version, sha256, url, bytes }) => ({ platform, version, sha256, url, bytes })) };
  if (options.dryRun) return { ...report, success: true, elapsedMs: performance.now() - began, networkRequests: 0, publicVerificationPerformed: false };
  async function check(id, operation) {
    const start = performance.now();
    try { report.checks.push({ id, success: true, ...(await operation()), elapsedMs: performance.now() - start }); }
    catch (error) { report.checks.push({ id, success: false, errorCode: transportCode(error), ...(error instanceof VerificationError ? error.publicFacts : {}), elapsedMs: performance.now() - start }); }
  }
  const requestOptions = { timeoutMs: options.timeoutMs };
  await check("https-homepage", async () => {
    const result = await request(new URL("/", options.origin), { ...requestOptions, html: true });
    if (result.status !== 200) fail("HOMEPAGE_HTTP_STATUS", { httpStatus: result.status });
    const headings = [...result.html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(match => match[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
    const heroLocale = headings.some(value => value.includes("每一场面试，都机灵地通过")) ? "zh" : headings.some(value => /Pass Every Interview Wisely\.?/.test(value)) ? "en" : null;
    if (!heroLocale) fail("HERO_NOT_FOUND");
    return { httpStatus: result.status, heroLocale, certificate: result.certificate };
  });
  await check("http-redirect-preserves-route", async () => {
    const expected = new URL("/api/account?route_probe=1", options.origin), insecure = new URL(expected);
    insecure.protocol = "http:"; insecure.port = "80";
    const result = await request(insecure, { ...requestOptions, method: "HEAD" });
    if (![301, 308].includes(result.status)) fail("HTTP_PERMANENT_REDIRECT_REQUIRED", { httpStatus: result.status });
    if (result.location !== expected.href) fail("HTTP_REDIRECT_TARGET_MISMATCH", { httpStatus: result.status });
    return { httpStatus: result.status, target: expected.href };
  });
  for (const [method, pathname] of [["GET", "/api/account"], ["POST", "/api/desktop/recall/upload-token"], ["POST", "/api/desktop/deepgram/token"], ["POST", "/api/ai/chat/completions"]]) {
    await check(`${method} ${pathname}`, async () => {
      const result = await request(new URL(pathname, options.origin), { ...requestOptions, method, ...(method === "POST" ? { body: "{}" } : {}) });
      if (result.status !== 401) fail("HTTP_UNAUTHENTICATED_REQUIRED", { httpStatus: result.status });
      return { httpStatus: result.status };
    });
  }
  for (const artifact of contracts.artifacts) {
    await check(`download-${artifact.platform}`, async () => {
      // Explicit HEAD /api/download is side-effect free. Never use the
      // /api/track-download route, which records a database event.
      const result = await request(new URL(`/api/download/${artifact.platform}`, options.origin), { ...requestOptions, method: "HEAD" });
      if (result.status !== 307) fail("DOWNLOAD_REDIRECT_REQUIRED", { httpStatus: result.status });
      if (result.location !== artifact.url || result.version !== artifact.version || result.sha256 !== artifact.sha256) fail("DOWNLOAD_CATALOG_MISMATCH", { httpStatus: result.status });
      return { httpStatus: result.status, version: artifact.version, sha256: artifact.sha256, location: artifact.url };
    });
  }
  const client = new contracts.Client(options.grpc, contracts.grpc.credentials.createSsl(), { "grpc.enable_retries": 0 });
  try {
    await check("grpc-health", () => grpcUnary(client, "Health", contracts.grpc, options.timeoutMs));
    await check("grpc-chat-auth-first", () => grpcUnary(client, "Chat", contracts.grpc, options.timeoutMs, true));
    await check("grpc-chat-stream-auth-first", () => grpcStream(client, contracts.grpc, options.timeoutMs));
  } finally { client.close(); }
  report.success = report.checks.every(item => item.success);
  report.elapsedMs = performance.now() - began;
  report.publicVerificationPerformed = true;
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(HELP); return; }
  let output;
  try {
    output = await fsp.open(options.out, "wx", 0o600);
    let report;
    try { report = await verifyRoutes(options); }
    catch (error) { report = { schemaVersion: 1, startedAtUtc: new Date().toISOString(), success: false, mode: options.dryRun ? "offline-plan" : "public-read-only", origin: options.origin, grpcAuthority: options.grpc, checks: [], errorCode: error instanceof VerificationError ? error.code : "VERIFIER_SETUP_FAILED", publicVerificationPerformed: false }; }
    await output.writeFile(JSON.stringify(report, null, 2) + "\n"); await output.sync();
    console.log(JSON.stringify({ success: report.success, mode: report.mode, report: options.out, checks: report.checks.length, ...(report.errorCode ? { errorCode: report.errorCode } : {}), failed: report.checks.filter(item => !item.success).map(item => ({ id: item.id, errorCode: item.errorCode })), elapsedMs: report.elapsedMs }));
    if (!report.success) process.exitCode = 1;
  } finally { await output?.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.log(JSON.stringify({ success: false, errorCode: error instanceof VerificationError ? error.code : error?.code === "EEXIST" ? "OUTPUT_ALREADY_EXISTS" : "VERIFIER_SETUP_FAILED" })); process.exitCode = 1;
});
