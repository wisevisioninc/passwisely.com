'use strict';

// Build-only backport of electron-builder 13d8535 (#9564). Do not change the
// pinned builder/NSIS versions or the application's per-user installer behavior.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = '24.13.3';
const ORIGINAL_SHA256 = 'afa9046492317e72e79e022cdb1f42edba4687ea605300bfc01c002f3106201c';
const PATCHED_SHA256 = '461144ae7e8e04d87a6d195530dba063c85fe340e8fb48997df86339564cd231';
const UPSTREAM = 'https://github.com/electron-userland/electron-builder/commit/13d8535';
const TEMPLATE = 'templates/nsis/multiUser.nsh';
const BLOCK = [
  '      System::Store S',
  '      # Win7 has a per-user programfiles known folder and this can be a non-default location',
  '      System::Call \'SHELL32::SHGetKnownFolderPath(g "${FOLDERID_UserProgramFiles}", i ${KF_FLAG_CREATE}, p 0, *p .r2)i.r1\'',
  '      ${If} $1 == 0',
  '        System::Call \'*$2(&w${NSIS_MAX_STRLEN} .s)\'',
  '        StrCpy $0 $1',
  '        System::Call \'OLE32::CoTaskMemFree(p r2)\'',
  '      ${endif}',
  '      System::Store L',
].join('\n') + '\n';

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function failure(code, facts = {}) { return Object.assign(new Error(code), { code, facts }); }

function transformTemplate(bytes) {
  const beforeSha256 = sha256(bytes);
  if (beforeSha256 === PATCHED_SHA256) return { status: 'already-applied', bytes, beforeSha256 };
  if (beforeSha256 !== ORIGINAL_SHA256) throw failure('NSIS_COMPAT_UNKNOWN_TEMPLATE', { observedSha256: beforeSha256 });
  const guarded = '      ${IfNot} ${AtLeastWin8}\n' + BLOCK.trimEnd().split('\n').map(line => '  ' + line).join('\n') + '\n      ${EndIf}\n';
  const patched = Buffer.from(bytes.toString('utf8').replace('!include UAC.nsh\n', '!include UAC.nsh\n!include WinVer.nsh\n').replace(BLOCK, guarded));
  if (sha256(patched) !== PATCHED_SHA256) throw failure('NSIS_COMPAT_TRANSFORM_MISMATCH');
  return { status: 'applied', bytes: patched, beforeSha256 };
}

function readRegularFile(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw failure('NSIS_COMPAT_REGULAR_BOUNDED_FILE_REQUIRED');
  return fs.readFileSync(filename);
}

function run() {
  const env = process.env;
  if (process.platform !== 'win32' || env.RUNNER_OS !== 'Windows' || env.RUNNER_ENVIRONMENT !== 'github-hosted' || env.GITHUB_ACTIONS !== 'true' || env.CI !== 'true') {
    throw failure('NSIS_COMPAT_DISPOSABLE_GITHUB_WINDOWS_REQUIRED');
  }
  if (!env.GITHUB_WORKSPACE || !env.RUNNER_TEMP || !/^\d+$/.test(env.GITHUB_RUN_ID || '') || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT || '')) {
    throw failure('NSIS_COMPAT_RUNNER_IDENTITY_REQUIRED');
  }
  const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const projectRoot = fs.realpathSync(path.resolve(__dirname, '..'));
  if (!samePath(fs.realpathSync(env.GITHUB_WORKSPACE), projectRoot)) throw failure('NSIS_COMPAT_WORKSPACE_MISMATCH');
  const packageRoot = path.join(projectRoot, 'node_modules', 'app-builder-lib');
  if (!samePath(fs.realpathSync(packageRoot), packageRoot)) throw failure('NSIS_COMPAT_PACKAGE_OUTSIDE_WORKSPACE');
  const manifest = JSON.parse(readRegularFile(path.join(packageRoot, 'package.json')).toString('utf8'));
  if (manifest.name !== 'app-builder-lib' || manifest.version !== VERSION) throw failure('NSIS_COMPAT_BUILDER_VERSION_MISMATCH');
  const templatePath = path.join(packageRoot, TEMPLATE);
  if (!samePath(fs.realpathSync(templatePath), templatePath)) throw failure('NSIS_COMPAT_TEMPLATE_OUTSIDE_PACKAGE');
  const original = readRegularFile(templatePath);
  const transformed = transformTemplate(original);

  // Keep the backup outside release: dist:win clears release before building.
  const owner = 'passwisely-nsis-compat-' + env.GITHUB_RUN_ID + '-' + env.GITHUB_RUN_ATTEMPT;
  const backupDirectory = path.join(fs.realpathSync(env.RUNNER_TEMP), owner);
  fs.mkdirSync(backupDirectory, { recursive: true });
  const backupStat = fs.lstatSync(backupDirectory);
  if (!backupStat.isDirectory() || backupStat.isSymbolicLink() || !samePath(fs.realpathSync(backupDirectory), backupDirectory)) throw failure('NSIS_COMPAT_BACKUP_DIRECTORY_MISMATCH');
  const backupPath = path.join(backupDirectory, 'multiUser.nsh.original');
  try {
    if (sha256(readRegularFile(backupPath)) !== ORIGINAL_SHA256) throw failure('NSIS_COMPAT_BACKUP_MISMATCH');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (transformed.status !== 'applied') throw failure('NSIS_COMPAT_ORIGINAL_BACKUP_REQUIRED');
    fs.writeFileSync(backupPath, original, { flag: 'wx' });
    if (sha256(readRegularFile(backupPath)) !== ORIGINAL_SHA256) throw failure('NSIS_COMPAT_BACKUP_MISMATCH');
  }
  if (transformed.status === 'applied') {
    const temporary = templatePath + '.passwisely-win8-compat.tmp';
    fs.writeFileSync(temporary, transformed.bytes, { flag: 'wx' });
    if (sha256(readRegularFile(temporary)) !== PATCHED_SHA256 || sha256(readRegularFile(templatePath)) !== ORIGINAL_SHA256) throw failure('NSIS_COMPAT_WRITE_CONFLICT');
    fs.renameSync(temporary, templatePath);
  }
  if (sha256(readRegularFile(templatePath)) !== PATCHED_SHA256) throw failure('NSIS_COMPAT_WRITE_MISMATCH');
  return {
    success: true, status: transformed.status, scope: 'Windows installer build template only; does not establish a previous crash cause.',
    upstream: UPSTREAM, builder: 'app-builder-lib', version: VERSION, template: TEMPLATE,
    beforeSha256: transformed.beforeSha256, originalSha256: ORIGINAL_SHA256, patchedSha256: PATCHED_SHA256,
    backup: { relativeTo: 'RUNNER_TEMP', path: owner + '/multiUser.nsh.original', sha256: ORIGINAL_SHA256 },
    buildSourceCommit: env.GITHUB_SHA || null, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
  };
}

module.exports = { run, transformTemplate, sha256, VERSION, ORIGINAL_SHA256, PATCHED_SHA256 };
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(run()) + '\n'); }
  catch (error) {
    const code = /^NSIS_COMPAT_[A-Z_]+$/.test(error.code || '') ? error.code : 'NSIS_COMPAT_APPLY_FAILED';
    process.stdout.write(JSON.stringify({ success: false, code, ...error.facts }) + '\n');
    process.exitCode = 1;
  }
}
