#!/usr/bin/env node
"use strict";

/** Native-host macOS package check. No npm dependencies or SDK initialization.
 * Executes only the selected app's Electron in Node mode, with a fresh minimal
 * environment. This is a trusted-package smoke test, not an untrusted-code sandbox.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MARKER = "PW_RECALL_RUNTIME:";
const CHILD_PROBE = String.raw`
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const marker = "PW_RECALL_RUNTIME:";
let stage = "resolve-sdk";
const resources = path.join(process.argv[1], "Contents", "Resources");
const roots = [path.join(resources, "app.asar"), path.join(resources, "app.asar.unpacked")];
const inRoot = (filename, root) => filename === root || filename.startsWith(root + path.sep);
const owned = filename => {
  if (typeof filename !== "string" || !path.isAbsolute(filename)) return false;
  let canonical;
  try { canonical = fs.realpathSync(filename); } catch { return false; }
  return roots.some(root => inRoot(path.normalize(filename), root) && inRoot(canonical, root));
};
const fail = code => { throw Object.assign(new Error("Package runtime check failed."), { probeCode: code }); };
const knownMissing = () => stage === "resolve-sdk" ? "@recallai/desktop-sdk" : stage === "resolve-uuid" ? "uuid" : "other";
const denyOperation = () => fail("UNEXPECTED_RUNTIME_OPERATION");

// Requiring the current SDK has no network or native-process side effects.
// Fail if a future package tries either during import; never call SDK init.
const child = require("node:child_process");
for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) child[key] = denyOperation;
const net = require("node:net");
net.Socket.prototype.connect = denyOperation;
net.Server.prototype.listen = denyOperation;
const tls = require("node:tls"); tls.connect = denyOperation;
const http = require("node:http"); http.request = http.get = denyOperation;
const https = require("node:https"); https.request = https.get = denyOperation;
const dgram = require("node:dgram"); dgram.createSocket = denyOperation;
const dns = require("node:dns");
for (const key of Object.keys(dns)) if (/^(lookup|resolve|reverse)/.test(key) && typeof dns[key] === "function") dns[key] = denyOperation;
for (const key of Object.keys(dns.promises)) if (/^(lookup|resolve|reverse)/.test(key) && typeof dns.promises[key] === "function") dns.promises[key] = denyOperation;
globalThis.fetch = denyOperation;
for (const name of ["log", "warn", "error", "info", "debug"]) console[name] = () => {};

let originalResolve;
try {
  const appRequire = Module.createRequire(path.join(roots[0], "package.json"));
  const sdkEntry = appRequire.resolve("@recallai/desktop-sdk");
  if (!owned(sdkEntry)) fail("SDK_OUTSIDE_APP");
  stage = "resolve-uuid";
  const sdkRequire = Module.createRequire(sdkEntry);
  const uuidEntry = sdkRequire.resolve("uuid");
  if (!owned(uuidEntry)) fail("DEPENDENCY_OUTSIDE_APP");

  // Guard the whole import closure as well as the two explicit entry points.
  // An ancestor or NODE_PATH installation must not make a broken app pass.
  originalResolve = Module._resolveFilename;
  Module._resolveFilename = function(request, parent, ...options) {
    const resolved = originalResolve.call(this, request, parent, ...options);
    if (!Module.isBuiltin(resolved) && path.isAbsolute(resolved) && !owned(resolved)) fail("DEPENDENCY_OUTSIDE_APP");
    return resolved;
  };
  stage = "load-sdk";
  const loaded = appRequire("@recallai/desktop-sdk");
  const sdk = loaded.default || loaded;
  stage = "check-interface";
  const methods = ["init", "prepareDesktopAudioRecording", "startRecording"];
  if (!methods.every(name => typeof sdk[name] === "function")) fail("INVALID_SDK_INTERFACE");
  process.stdout.write(marker + JSON.stringify({ success: true, code: "RECALL_RUNTIME_OK", stage: "complete", sdk: path.relative(resources, sdkEntry), uuid: path.relative(resources, uuidEntry), methods }) + "\n");
} catch (error) {
  const allowed = new Set(["SDK_OUTSIDE_APP", "DEPENDENCY_OUTSIDE_APP", "INVALID_SDK_INTERFACE", "UNEXPECTED_RUNTIME_OPERATION"]);
  const code = allowed.has(error && error.probeCode) ? error.probeCode : error && error.code === "MODULE_NOT_FOUND" ? "MODULE_NOT_FOUND" : "SDK_LOAD_FAILED";
  process.stdout.write(marker + JSON.stringify({ success: false, code, stage, ...(code === "MODULE_NOT_FOUND" ? { missingModule: knownMissing() } : {}) }) + "\n");
  process.exitCode = 1;
} finally {
  if (originalResolve) Module._resolveFilename = originalResolve;
}
`;

function result(value, exitCode = 1) {
  process.stdout.write(JSON.stringify(value) + "\n");
  process.exitCode = exitCode;
}

function main() {
  if (process.argv.length !== 3) return result({ success: false, code: "USAGE", usage: "node scripts/verify-recall-runtime.cjs /absolute/path/PassWisely.app" }, 2);
  if (process.platform !== "darwin") return result({ success: false, code: "MACOS_HOST_REQUIRED" });
  let appPath;
  try { appPath = fs.realpathSync(path.resolve(process.argv[2])); }
  catch { return result({ success: false, code: "APP_NOT_FOUND" }); }
  const resources = path.join(appPath, "Contents", "Resources");
  const info = path.join(appPath, "Contents", "Info.plist");
  if (!fs.existsSync(path.join(resources, "app.asar"))) return result({ success: false, code: "APP_ARCHIVE_NOT_FOUND" });
  // Do not forward ambient authentication, Node loader flags or search paths.
  const env = { ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin:/bin", LANG: "C" };
  const plist = spawnSync("/usr/bin/plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", info], { encoding: "utf8", env, timeout: 5000, maxBuffer: 16 * 1024 });
  const executableName = typeof plist.stdout === "string" ? plist.stdout.trim() : "";
  if (plist.status !== 0 || !executableName || /[/\x00\r\n]/.test(executableName) || [".", ".."].includes(executableName)) return result({ success: false, code: "INVALID_APP_EXECUTABLE" });
  let executable;
  const executableRoot = path.join(appPath, "Contents", "MacOS");
  try { executable = fs.realpathSync(path.join(executableRoot, executableName)); }
  catch { return result({ success: false, code: "APP_EXECUTABLE_NOT_FOUND" }); }
  if (!executable.startsWith(executableRoot + path.sep)) return result({ success: false, code: "APP_EXECUTABLE_OUTSIDE_APP" });
  const child = spawnSync(executable, ["-e", CHILD_PROBE, appPath], { cwd: resources, env, encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024 });
  const safeProcessCode = new Set(["ENOENT", "EACCES", "ENOEXEC", "ETIMEDOUT", "ENOBUFS"]);
  if (child.error) return result({ success: false, code: safeProcessCode.has(child.error.code) ? child.error.code : "APP_EXEC_FAILED" });
  const line = (child.stdout || "").split(/\r?\n/).filter(line => line.startsWith(MARKER)).at(-1);
  let verdict;
  try { verdict = JSON.parse(line.slice(MARKER.length)); }
  catch { return result({ success: false, code: "NO_RUNTIME_RESULT", exitCode: child.status }); }
  // Only this probe's bounded schema reaches the caller. Never echo child logs,
  // exception messages, stacks, environment, command arguments or SDK credentials.
  const codes = new Set(["RECALL_RUNTIME_OK", "SDK_OUTSIDE_APP", "DEPENDENCY_OUTSIDE_APP", "INVALID_SDK_INTERFACE", "UNEXPECTED_RUNTIME_OPERATION", "MODULE_NOT_FOUND", "SDK_LOAD_FAILED"]);
  const stages = new Set(["complete", "resolve-sdk", "resolve-uuid", "load-sdk", "check-interface"]);
  if (!codes.has(verdict.code) || !stages.has(verdict.stage)) return result({ success: false, code: "INVALID_RUNTIME_RESULT" });
  if (verdict.success === true && verdict.code === "RECALL_RUNTIME_OK" && child.status === 0) {
    const relative = value => typeof value === "string" && value.length < 1024 && !path.isAbsolute(value) && !value.split(path.sep).includes("..") && /^(app\.asar|app\.asar\.unpacked)\//.test(value);
    if (!relative(verdict.sdk) || !relative(verdict.uuid)) return result({ success: false, code: "INVALID_RUNTIME_RESULT" });
    return result({ success: true, code: verdict.code, stage: verdict.stage, sdk: verdict.sdk, uuid: verdict.uuid, methods: ["init", "prepareDesktopAudioRecording", "startRecording"] }, 0);
  }
  return result({ success: false, code: verdict.code, stage: verdict.stage, ...(["@recallai/desktop-sdk", "uuid", "other"].includes(verdict.missingModule) ? { missingModule: verdict.missingModule } : {}) });
}

try { main(); }
catch { result({ success: false, code: "RUNTIME_CHECK_FAILED" }); }
