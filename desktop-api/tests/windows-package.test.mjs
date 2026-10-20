import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const verifier = require(fileURLToPath(new URL('../../scripts/verify-windows-runtime.cjs', import.meta.url)));
const { assertPeX64, packagePaths, parseProbe, run, CHILD_PROBE } = verifier;
const marker = 'PW_WINDOWS_RUNTIME:';
const success = { success: true, code: 'WINDOWS_IMPORT_OK', stage: 'complete', sdk: 'app.asar/node_modules/@recallai/desktop-sdk/index.js', uuid: 'app.asar/node_modules/uuid/index.js' };
const child = verdict => ({ status: 0, stdout: 'ignored SDK log\n' + marker + JSON.stringify(verdict) + '\n', stderr: 'not retained' });
function pe(machine = 0x8664) { const b = Buffer.alloc(96); b.write('MZ'); b.writeUInt32LE(64, 0x3c); b.writeUInt32LE(0x00004550, 64); b.writeUInt16LE(machine, 68); return b; }
function files(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'passwisely-win-package-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resources = path.join(root, 'resources'), sdk = path.join(resources, 'app.asar.unpacked', 'node_modules', '@recallai', 'desktop-sdk'), plugins = path.join(sdk, 'gstreamer-1.0');
  fs.mkdirSync(plugins, { recursive: true }); fs.writeFileSync(path.join(root, 'PassWisely.exe'), pe()); fs.writeFileSync(path.join(resources, 'app.asar'), 'synthetic archive marker'); fs.writeFileSync(path.join(sdk, 'agent-windows.exe'), pe()); fs.writeFileSync(path.join(plugins, 'synthetic.dll'), 'synthetic presence marker, not native code');
  return { root, sdk, plugins };
}
test('Windows package resource contract accepts x64 PE headers and rejects absent or wrong-platform Recall resources', context => {
  const f = files(context); assert.equal(packagePaths(f.root).app, fs.realpathSync(f.root));
  fs.writeFileSync(path.join(f.sdk, 'agent-windows.exe'), pe(0xaa64)); assert.throws(() => packagePaths(f.root), /WINDOWS_X64_PE_REQUIRED/);
  fs.writeFileSync(path.join(f.sdk, 'agent-windows.exe'), Buffer.from('not a PE')); assert.throws(() => assertPeX64(path.join(f.sdk, 'agent-windows.exe')), /INVALID_PE_HEADER/);
  fs.unlinkSync(path.join(f.sdk, 'agent-windows.exe')); assert.throws(() => packagePaths(f.root), /RECALL_AGENT_MISSING/);
  fs.writeFileSync(path.join(f.sdk, 'agent-windows.exe'), pe()); fs.unlinkSync(path.join(f.plugins, 'synthetic.dll')); assert.throws(() => packagePaths(f.root), /GSTREAMER_PLUGINS_REQUIRED/);
});
test('PE offsets are checked against file size before allocating or reading the claimed header', context => {
  const f = files(context), filename = path.join(f.root, 'PassWisely.exe'), invalid = pe(); invalid.writeUInt32LE(0xffffffff, 0x3c); fs.writeFileSync(filename, invalid);
  assert.throws(() => assertPeX64(filename), /WINDOWS_X64_PE_REQUIRED/);
});
test('only bounded probe fields are returned and success requires the selected child to exit zero', () => {
  const parsed = parseProbe(child({ ...success, token: 'fixture-secret' })); assert.equal(parsed.success, true); assert.doesNotMatch(JSON.stringify(parsed), /fixture-secret|ignored SDK|not retained/);
  for (const sdk of ['C:/foreign/sdk.js', '/foreign/sdk.js', 'app.asar/../foreign.js', 'app.asar\\node_modules\\sdk.js']) assert.equal(parseProbe(child({ ...success, sdk })).success, false);
  assert.equal(parseProbe({ ...child(success), status: 1 }).success, false);
  assert.deepEqual(parseProbe({ status: 0, stdout: 'no marker' }), { success: false, code: 'NO_RUNTIME_RESULT' });
  assert.deepEqual(parseProbe({ error: { code: 'ETIMEDOUT', message: 'fixture-secret' } }), { success: false, code: 'ETIMEDOUT' });
});
function probe({ foreignUuid = false, importOperation = false, invalidInterface = false } = {}) {
  const resources = path.resolve('/synthetic/windows/resources'), sdk = path.join(resources, 'app.asar', 'node_modules', '@recallai', 'desktop-sdk', 'index.js'), uuid = foreignUuid ? path.resolve('/foreign/uuid.js') : path.join(resources, 'app.asar', 'node_modules', 'uuid', 'index.js');
  const modules = {
    'node:fs': { realpathSync: value => value }, 'node:path': path,
    'node:child_process': {}, 'node:net': { Socket: function Socket() {}, Server: function Server() {} }, 'node:tls': {}, 'node:http': {}, 'node:https': {}, 'node:dgram': {}, 'node:dns': { promises: {} },
  };
  const sdkObject = Object.fromEntries(['init','prepareDesktopAudioRecording','startRecording','pauseRecording','resumeRecording','stopRecording','shutdown'].map(name => [name, () => assert.fail('SDK methods are never initialized/called')]));
  if (invalidInterface) delete sdkObject.pauseRecording;
  const appRequire = name => { assert.equal(name, '@recallai/desktop-sdk'); if (importOperation) modules['node:child_process'].spawn('unexpected'); return sdkObject; };
  appRequire.resolve = name => name === '@recallai/desktop-sdk' ? sdk : uuid;
  const Module = { createRequire: () => appRequire, isBuiltin: name => name.startsWith('node:'), _resolveFilename: name => name }; modules['node:module'] = Module;
  let output = ''; const process = { argv: ['fixture.exe', resources], stdout: { write: value => { output += value; } }, exitCode: 0 };
  vm.runInNewContext(CHILD_PROBE, { require: name => { assert.ok(name in modules, name); return modules[name]; }, process, console: { log() {}, warn() {}, error() {}, info() {}, debug() {} } });
  return parseProbe({ status: process.exitCode, stdout: output });
}
test('actual packaged import probe cannot borrow a host dependency, initialize audio, or execute an import-time child operation', () => {
  assert.equal(probe().success, true);
  assert.equal(probe({ foreignUuid: true }).code, 'DEPENDENCY_OUTSIDE_APP');
  assert.equal(probe({ importOperation: true }).code, 'UNEXPECTED_RUNTIME_OPERATION');
  assert.equal(probe({ invalidInterface: true }).code, 'INVALID_SDK_INTERFACE');
});
test('a non-Windows host cannot label a package as natively verified', () => {
  assert.deepEqual(run('/not-read', 'darwin'), { success: false, code: 'WINDOWS_HOST_REQUIRED' });
  assert.deepEqual(run('/not-read', 'linux'), { success: false, code: 'WINDOWS_HOST_REQUIRED' });
});
