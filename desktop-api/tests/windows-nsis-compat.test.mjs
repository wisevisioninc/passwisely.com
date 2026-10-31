import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptPath = fileURLToPath(new URL('../../scripts/apply-windows-nsis-compat.cjs', import.meta.url));
const compat = require(scriptPath);
// npm ci's real package is read-only evidence, never an application target here.
const packageRoot = path.dirname(require.resolve('app-builder-lib/package.json'));
const installedManifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const original = fs.readFileSync(path.join(packageRoot, 'templates/nsis/multiUser.nsh'));

function runner(context, { bytes = original, version = compat.VERSION, env = {}, foreignTemplate = false } = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'passwisely-nsis-compat-test-'));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const workspace = path.join(temporary, 'workspace'), runnerTemp = path.join(temporary, 'runner-temp');
  const dependency = path.join(workspace, 'node_modules', 'app-builder-lib');
  const template = path.join(dependency, 'templates/nsis/multiUser.nsh');
  fs.mkdirSync(path.dirname(template), { recursive: true }); fs.mkdirSync(runnerTemp);
  fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: 'app-builder-lib', version }));
  fs.writeFileSync(template, bytes);
  const module = { exports: {} };
  const process = { platform: 'win32', env: { RUNNER_OS: 'Windows', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_ACTIONS: 'true', CI: 'true', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_WORKSPACE: workspace, RUNNER_TEMP: runnerTemp, GITHUB_SHA: 'd8c9dbe556fb89c39a30ffede72db2511c6a6fe4', ...env } };
  // Run production file operations and runner guards against an isolated copy.
  const templateIdentity = fs.realpathSync(template);
  const fixtureFs = foreignTemplate ? { ...fs, realpathSync: filename => filename === templateIdentity ? path.join(temporary, 'foreign', 'multiUser.nsh') : fs.realpathSync(filename) } : fs;
  const fixtureRequire = name => name === 'node:fs' ? fixtureFs : require(name);
  vm.runInNewContext(fs.readFileSync(scriptPath, 'utf8'), { require: fixtureRequire, module, process, __dirname: path.join(workspace, 'scripts'), Buffer });
  return { api: module.exports, template, runnerTemp, process };
}

test('pinned real NSIS template receives only the upstream WinVer include and Windows 8 guard', () => {
  assert.equal(installedManifest.version, compat.VERSION);
  assert.equal(compat.sha256(original), compat.ORIGINAL_SHA256);
  const result = compat.transformTemplate(original);
  assert.equal(result.status, 'applied'); assert.equal(compat.sha256(result.bytes), compat.PATCHED_SHA256);
  const reverted = result.bytes.toString('utf8').replace('!include WinVer.nsh\n', '').replace(/      \$\{IfNot\} \$\{AtLeastWin8\}\n([\s\S]*?)      \$\{EndIf\}\n/, (_, body) => body.split('\n').map(line => line.startsWith('  ') ? line.slice(2) : line).join('\n'));
  assert.equal(reverted, original.toString('utf8'));
  assert.equal(compat.transformTemplate(result.bytes).status, 'already-applied');
});

test('unknown bytes and unexpected versions fail before any patch or backup', context => {
  const changed = Buffer.concat([original, Buffer.from('\n; unexpected template')]);
  assert.throws(() => compat.transformTemplate(changed), { code: 'NSIS_COMPAT_UNKNOWN_TEMPLATE' });
  for (const options of [{ bytes: changed }, { version: '26.9.0' }]) {
    const fixture = runner(context, options);
    assert.throws(() => fixture.api.run(), { code: options.bytes ? 'NSIS_COMPAT_UNKNOWN_TEMPLATE' : 'NSIS_COMPAT_BUILDER_VERSION_MISMATCH' });
    assert.deepEqual(fs.readFileSync(fixture.template), options.bytes || original);
    assert.deepEqual(fs.readdirSync(fixture.runnerTemp), []);
  }
});

test('production runner application preserves the original, is idempotent, and rejects a corrupted or missing backup', context => {
  const fixture = runner(context);
  const first = fixture.api.run();
  assert.equal(first.status, 'applied'); assert.equal(first.version, compat.VERSION);
  const backup = path.join(fixture.runnerTemp, first.backup.path);
  assert.deepEqual(fs.readFileSync(backup), original);
  assert.equal(compat.sha256(fs.readFileSync(fixture.template)), compat.PATCHED_SHA256);
  assert.equal(fixture.api.run().status, 'already-applied');
  fs.writeFileSync(backup, 'unexpected backup');
  assert.throws(() => fixture.api.run(), { code: 'NSIS_COMPAT_BACKUP_MISMATCH' });
  fs.unlinkSync(backup);
  assert.throws(() => fixture.api.run(), { code: 'NSIS_COMPAT_ORIGINAL_BACKUP_REQUIRED' });
  assert.equal(compat.sha256(fs.readFileSync(fixture.template)), compat.PATCHED_SHA256);
});

test('application is restricted to this disposable GitHub Windows workspace', context => {
  for (const env of [{ RUNNER_ENVIRONMENT: 'self-hosted' }, { GITHUB_ACTIONS: 'false' }, { CI: 'false' }, { GITHUB_RUN_ID: '../foreign' }]) {
    const fixture = runner(context, { env });
    assert.throws(() => fixture.api.run(), { code: env.GITHUB_RUN_ID ? 'NSIS_COMPAT_RUNNER_IDENTITY_REQUIRED' : 'NSIS_COMPAT_DISPOSABLE_GITHUB_WINDOWS_REQUIRED' });
    assert.deepEqual(fs.readFileSync(fixture.template), original);
    assert.deepEqual(fs.readdirSync(fixture.runnerTemp), []);
  }
  // A junction in templates/nsis can escape an otherwise owned package root.
  const foreign = runner(context, { foreignTemplate: true });
  assert.throws(() => foreign.api.run(), { code: 'NSIS_COMPAT_TEMPLATE_OUTSIDE_PACKAGE' });
  assert.deepEqual(fs.readFileSync(foreign.template), original);
  assert.deepEqual(fs.readdirSync(foreign.runnerTemp), []);
  const fixture = runner(context);
  fixture.process.env.GITHUB_WORKSPACE = fixture.runnerTemp;
  assert.throws(() => fixture.api.run(), { code: 'NSIS_COMPAT_WORKSPACE_MISMATCH' });
  assert.deepEqual(fs.readFileSync(fixture.template), original);
  if (process.platform !== 'win32') assert.throws(() => compat.run(), { code: 'NSIS_COMPAT_DISPOSABLE_GITHUB_WINDOWS_REQUIRED' });
});
