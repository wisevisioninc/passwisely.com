#!/usr/bin/env node
"use strict";
// Native Windows package/import smoke only. No SDK init, recording or credentials.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const MARKER = "PW_WINDOWS_RUNTIME:";
const METHODS = ["init", "prepareDesktopAudioRecording", "startRecording", "pauseRecording", "resumeRecording", "stopRecording", "shutdown"];

function inside(filename, root) { return filename === root || filename.startsWith(root + path.sep); }
function ownedFile(filename, root) {
  const real = fs.realpathSync(filename);
  if (!inside(real, root) || !fs.statSync(real).isFile()) throw new Error("PACKAGE_FILE_OUTSIDE_ROOT");
  return real;
}
function assertPeX64(filename) {
  const fd = fs.openSync(filename, "r");
  try {
    const header = Buffer.alloc(64), size = fs.fstatSync(fd).size;
    if (fs.readSync(fd, header, 0, 64, 0) !== 64 || header.toString("ascii", 0, 2) !== "MZ") throw new Error("INVALID_PE_HEADER");
    const offset = header.readUInt32LE(0x3c), pe = Buffer.alloc(6);
    if (offset < 64 || offset > size - 6 || fs.readSync(fd, pe, 0, 6, offset) !== 6 || pe.readUInt32LE(0) !== 0x00004550 || pe.readUInt16LE(4) !== 0x8664) throw new Error("WINDOWS_X64_PE_REQUIRED");
  } finally { fs.closeSync(fd); }
}
function packagePaths(directory) {
  const app = fs.realpathSync(path.resolve(directory));
  if (!fs.statSync(app).isDirectory()) throw new Error("APP_DIRECTORY_REQUIRED");
  if (!fs.existsSync(path.join(app, "PassWisely.exe"))) throw new Error("APP_EXECUTABLE_MISSING");
  const executable = ownedFile(path.join(app, "PassWisely.exe"), app);
  const resources = fs.realpathSync(path.join(app, "resources"));
  if (!inside(resources, app)) throw new Error("PACKAGE_FILE_OUTSIDE_ROOT");
  if (!fs.existsSync(path.join(resources, "app.asar"))) throw new Error("APP_ARCHIVE_MISSING");
  ownedFile(path.join(resources, "app.asar"), app);
  const native = path.join(resources, "app.asar.unpacked", "node_modules", "@recallai", "desktop-sdk");
  if (!fs.existsSync(path.join(native, "agent-windows.exe"))) throw new Error("RECALL_AGENT_MISSING");
  const agent = ownedFile(path.join(native, "agent-windows.exe"), app);
  if (!fs.existsSync(path.join(native, "gstreamer-1.0"))) throw new Error("GSTREAMER_PLUGINS_REQUIRED");
  const plugins = fs.realpathSync(path.join(native, "gstreamer-1.0"));
  if (!inside(plugins, native) || !fs.statSync(plugins).isDirectory() || !fs.readdirSync(plugins, { withFileTypes: true }).some(entry => entry.isFile() && /\.dll$/i.test(entry.name))) throw new Error("GSTREAMER_PLUGINS_REQUIRED");
  assertPeX64(executable); assertPeX64(agent);
  return { app, executable, resources, agent };
}

const CHILD_PROBE = String.raw`
"use strict";
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const resources = process.argv[1], roots = [path.join(resources, "app.asar"), path.join(resources, "app.asar.unpacked")];
const inside = (filename, root) => filename === root || filename.startsWith(root + path.sep);
const owned = filename => { try { return typeof filename === "string" && path.isAbsolute(filename) && roots.some(root => inside(path.normalize(filename), root) && inside(fs.realpathSync(filename), root)); } catch { return false; } };
const fail = code => { throw Object.assign(new Error("Package import check failed"), { probeCode: code }); };
const deny = () => fail("UNEXPECTED_RUNTIME_OPERATION");
const child = require("node:child_process");
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) child[name] = deny;
const net = require("node:net"); net.Socket.prototype.connect = deny; net.Server.prototype.listen = deny;
require("node:tls").connect = deny;
for (const name of ["node:http", "node:https"]) { const http = require(name); http.request = http.get = deny; }
require("node:dgram").createSocket = deny;
const dns = require("node:dns");
for (const owner of [dns, dns.promises]) for (const key of Object.keys(owner)) if (/^(lookup|resolve|reverse)/.test(key) && typeof owner[key] === "function") owner[key] = deny;
globalThis.fetch = deny;
for (const name of ["log", "warn", "error", "info", "debug"]) console[name] = () => {};
let stage = "resolve-sdk", original;
try {
  const appRequire = Module.createRequire(path.join(roots[0], "package.json"));
  const sdkEntry = appRequire.resolve("@recallai/desktop-sdk"); if (!owned(sdkEntry)) fail("DEPENDENCY_OUTSIDE_APP");
  stage = "resolve-uuid";
  const uuidEntry = Module.createRequire(sdkEntry).resolve("uuid"); if (!owned(uuidEntry)) fail("DEPENDENCY_OUTSIDE_APP");
  original = Module._resolveFilename;
  Module._resolveFilename = function(request, parent, ...options) { const resolved = original.call(this, request, parent, ...options); if (!Module.isBuiltin(resolved) && path.isAbsolute(resolved) && !owned(resolved)) fail("DEPENDENCY_OUTSIDE_APP"); return resolved; };
  stage = "load-sdk";
  const loaded = appRequire("@recallai/desktop-sdk"), sdk = loaded.default || loaded;
  stage = "check-interface";
  const methods = ["init", "prepareDesktopAudioRecording", "startRecording", "pauseRecording", "resumeRecording", "stopRecording", "shutdown"];
  if (!methods.every(name => typeof sdk[name] === "function")) fail("INVALID_SDK_INTERFACE");
  process.stdout.write("PW_WINDOWS_RUNTIME:" + JSON.stringify({ success: true, code: "WINDOWS_IMPORT_OK", stage: "complete", sdk: path.relative(resources, sdkEntry).split(path.sep).join("/"), uuid: path.relative(resources, uuidEntry).split(path.sep).join("/") }) + "\n");
} catch (error) {
  const allowed = new Set(["DEPENDENCY_OUTSIDE_APP", "INVALID_SDK_INTERFACE", "UNEXPECTED_RUNTIME_OPERATION"]);
  const code = allowed.has(error && error.probeCode) ? error.probeCode : error && error.code === "MODULE_NOT_FOUND" ? "MODULE_NOT_FOUND" : "SDK_LOAD_FAILED";
  process.stdout.write("PW_WINDOWS_RUNTIME:" + JSON.stringify({ success: false, code, stage }) + "\n"); process.exitCode = 1;
} finally { if (original) Module._resolveFilename = original; }
`;
function parseProbe(child) {
  if (child.error) return { success: false, code: ["ENOENT", "EACCES", "ENOEXEC", "ETIMEDOUT", "ENOBUFS"].includes(child.error.code) ? child.error.code : "APP_EXEC_FAILED" };
  let verdict;
  try { const line = String(child.stdout || "").split(/\r?\n/).filter(line => line.startsWith(MARKER)).at(-1); verdict = JSON.parse(line.slice(MARKER.length)); }
  catch { return { success: false, code: "NO_RUNTIME_RESULT" }; }
  const codes = new Set(["WINDOWS_IMPORT_OK", "DEPENDENCY_OUTSIDE_APP", "INVALID_SDK_INTERFACE", "UNEXPECTED_RUNTIME_OPERATION", "MODULE_NOT_FOUND", "SDK_LOAD_FAILED"]);
  if (!verdict || !codes.has(verdict.code) || !["complete", "resolve-sdk", "resolve-uuid", "load-sdk", "check-interface"].includes(verdict.stage)) return { success: false, code: "INVALID_RUNTIME_RESULT" };
  if (verdict.success === true && verdict.code === "WINDOWS_IMPORT_OK" && verdict.stage === "complete" && child.status === 0) {
    const relative = value => typeof value === "string" && value.length < 1024 && !path.win32.isAbsolute(value) && !value.includes("\\") && !value.split("/").includes("..") && /^(app\.asar|app\.asar\.unpacked)\//.test(value);
    if (!relative(verdict.sdk) || !relative(verdict.uuid)) return { success: false, code: "INVALID_RUNTIME_RESULT" };
    return { success: true, code: verdict.code, stage: verdict.stage, sdk: verdict.sdk, uuid: verdict.uuid, methods: METHODS, native: ["agent-windows.exe:PE-x64-header", "gstreamer-1.0:unpacked-DLLs"], scope: "Package resources and SDK JavaScript import only; no native agent initialization, capture, upload or ASR." };
  }
  if (verdict.code === "WINDOWS_IMPORT_OK") return { success: false, code: "INVALID_RUNTIME_RESULT" };
  return { success: false, code: verdict.code, stage: verdict.stage };
}
function run(directory, host = process.platform) {
  if (host !== "win32") return { success: false, code: "WINDOWS_HOST_REQUIRED" };
  try {
    const locations = packagePaths(directory);
    const systemRoot = process.env.SystemRoot || process.env.WINDIR;
    if (!systemRoot || !path.isAbsolute(systemRoot)) return { success: false, code: "WINDOWS_SYSTEMROOT_REQUIRED" };
    const temporary = os.tmpdir();
    const env = { ELECTRON_RUN_AS_NODE: "1", SystemRoot: systemRoot, WINDIR: systemRoot, PATH: path.join(systemRoot, "System32"), TEMP: temporary, TMP: temporary, LANG: "C" };
    return parseProbe(spawnSync(locations.executable, ["-e", CHILD_PROBE, locations.resources], { cwd: locations.resources, env, encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true }));
  } catch (error) {
    const codes = new Set(["PACKAGE_FILE_OUTSIDE_ROOT", "INVALID_PE_HEADER", "WINDOWS_X64_PE_REQUIRED", "GSTREAMER_PLUGINS_REQUIRED", "APP_DIRECTORY_REQUIRED", "APP_EXECUTABLE_MISSING", "APP_ARCHIVE_MISSING", "RECALL_AGENT_MISSING"]);
    return { success: false, code: codes.has(error && error.message) ? error.message : "WINDOWS_PACKAGE_CHECK_FAILED" };
  }
}
if (require.main === module) {
  const verdict = process.argv.length === 3 ? run(process.argv[2]) : { success: false, code: "USAGE" };
  process.stdout.write(JSON.stringify(verdict) + "\n"); process.exitCode = verdict.success ? 0 : 1;
}
module.exports = { assertPeX64, packagePaths, parseProbe, run, CHILD_PROBE };
