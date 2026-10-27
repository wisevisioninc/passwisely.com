import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const afterPack = require('../../scripts/after-pack-macos.js')

function macho(type = 2) {
  const header = Buffer.alloc(32)
  header.writeUInt32LE(0xfeedfacf)
  header.writeUInt32LE(0x100000c, 4)
  header.writeUInt32LE(type, 12)
  return header
}

function fixture(t, { audio = true } = {}) {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'passwisely-signing-')))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const app = path.join(temp, 'Test.app')
  const write = (relative, data = macho()) => {
    const target = path.join(app, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, data)
    return target
  }
  const main = write('Contents/MacOS/Test')
  const audioHelper = audio ? write('Contents/Resources/audio/PassWiselyAudioHelper') : null
  if (audioHelper) fs.chmodSync(audioHelper, 0o755)
  const helper = write('Contents/Frameworks/Helper.app/Contents/MacOS/Helper')
  const sdk = write('Contents/Resources/app.asar.unpacked/node_modules/@recallai/desktop-sdk/desktop_sdk_macos_exe')
  const library = write('Contents/Resources/app.asar.unpacked/node_modules/@recallai/desktop-sdk/Frameworks/Native.framework/Versions/A/Native', macho(6))
  const framework = path.dirname(path.dirname(path.dirname(library)))
  fs.symlinkSync('A', path.join(framework, 'Versions/Current'))
  fs.symlinkSync('Versions/Current/Native', path.join(framework, 'Native'))
  const outside = path.join(temp, 'outside')
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(outside, 'binary'), macho())
  fs.symlinkSync(outside, path.join(app, 'Contents/Resources/external'))
  write('Contents/Resources/readme.txt', Buffer.from('not an executable'))
  write('Contents/Resources/Java.class', Buffer.from('cafebabe0000003400010000000000000000000000000000000000000000000000', 'hex'))
  return { app, main, helper, sdk, library, framework, audioHelper }
}

test('discovers SDK code under Resources, signs real leaves before containers and verifies strictly', (t) => {
  const f = fixture(t)
  const calls = []
  const plan = afterPack.signAdHocApp(f.app, '/entitlements.plist', (command, args) => calls.push({ command, args }))
  assert.deepEqual(new Set(plan.leaves.map(x => x.path)), new Set([f.main, f.helper, f.sdk, f.library, f.audioHelper]))
  assert.equal(plan.bundles.at(-1), fs.realpathSync(f.app))
  assert.ok(plan.bundles.includes(f.framework))
  assert.equal(calls.length, plan.leaves.length + plan.bundles.length + 1)
  for (let index = 0; index < plan.leaves.length; index++) {
    assert.equal(calls[index].args.at(-1), plan.leaves[index].path)
    assert.ok(!calls[index].args.includes('--deep'))
    assert.ok(!calls[index].args.includes('--preserve-metadata'))
  }
  const indexOf = target => calls.findIndex(call => call.args.at(-1) === target)
  assert.ok(indexOf(f.helper) < indexOf(path.dirname(path.dirname(path.dirname(f.helper)))))
  assert.ok(indexOf(f.library) < indexOf(f.framework))
  assert.deepEqual(calls.at(-1).args, ['--verify', '--deep', '--strict', '--verbose=2', plan.root])
  assert.ok(calls.slice(0, -1).every(call => call.args.includes('runtime')))
  assert.ok(fs.lstatSync(path.join(f.framework, 'Native')).isSymbolicLink())
})

test('recognizes universal Mach-O slices without treating CAFEBABE alone as executable', (t) => {
  const f = fixture(t)
  const universal = Buffer.alloc(64)
  universal.writeUInt32BE(0xcafebabe)
  universal.writeUInt32BE(1, 4)
  universal.writeUInt32BE(0x100000c, 8)
  universal.writeUInt32BE(32, 16)
  universal.writeUInt32BE(32, 20)
  macho(8).copy(universal, 32)
  const native = path.join(f.app, 'Contents/Resources/native.node')
  fs.writeFileSync(native, universal)
  assert.ok(afterPack.collectCodePaths(f.app).leaves.some(item => item.path === native && !item.executable))
  universal.writeUInt32BE(0xffffffff, 16)
  fs.writeFileSync(native, universal)
  assert.ok(!afterPack.collectCodePaths(f.app).leaves.some(item => item.path === native))
})

test('signing failure aborts before sealing or reporting successful verification', (t) => {
  const f = fixture(t)
  const calls = []
  assert.throws(() => afterPack.signAdHocApp(f.app, '/entitlements.plist', (_command, args) => {
    calls.push(args)
    throw new Error('signing failed')
  }), /signing failed/)
  assert.equal(calls.length, 1)
  assert.ok(!calls[0].includes('--verify'))
})

test('fresh framework helpers are signed before codesign can validate them via its main binary', (t) => {
  const f = fixture(t)
  const nestedHelper = path.join(f.framework, 'Versions/A/Helpers/chrome_crashpad_handler')
  fs.mkdirSync(path.dirname(nestedHelper), { recursive: true })
  fs.writeFileSync(nestedHelper, macho())
  const signed = new Set()
  afterPack.signAdHocApp(f.app, '/entitlements.plist', (_command, args) => {
    if (args.includes('--verify')) return
    const target = args.at(-1)
    if (target === f.library || target === f.framework) {
      // codesign recognizes the main Mach-O as framework code and validates
      // nested helpers even when its argument is a regular file, not a bundle.
      assert.ok(signed.has(nestedHelper), 'framework helper is still unsigned')
    }
    signed.add(target)
  })
  assert.ok(signed.has(nestedHelper))
})

test('rejects a symlink app root and leaves non-Mac builds alone', async (t) => {
  const f = fixture(t)
  const alias = path.join(path.dirname(f.app), 'Alias.app')
  fs.symlinkSync(f.app, alias)
  assert.throws(() => afterPack.collectCodePaths(alias), /symlink/)
  await afterPack({ electronPlatformName: 'win32' })
})

test('installed electron-builder signing walker selects Resources native leaves for formal re-signing', async (t) => {
  const f = fixture(t)
  // Do not invoke codesign. Exercise the same installed osx-sign traversal and
  // binary classification that the normal Developer ID signing phase calls.
  const { walkAsync } = require('@electron/osx-sign/dist/cjs/util.js')
  const selected = new Set(await walkAsync(path.join(f.app, 'Contents')))
  for (const leaf of afterPack.collectCodePaths(f.app).leaves) assert.ok(selected.has(leaf.path), leaf.path)
  assert.ok(selected.has(f.audioHelper))
  assert.ok(selected.has(f.sdk))
  assert.ok(selected.has(f.library))
  assert.ok(selected.has(f.framework))
})

function loadHook(mocks) {
  const filename = path.resolve(import.meta.dirname, '../../scripts/after-pack-macos.js')
  const module = { exports: {} }, nativeRequire = createRequire(filename)
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, Buffer, __dirname: path.dirname(filename), require: name => Object.hasOwn(mocks, name) ? mocks[name] : nativeRequire(name),
  }, { filename })
  return module.exports
}

test('shared afterPack compiles exact target audio helper, verifies it, then signs the complete code plan', async t => {
  const { Arch } = require('builder-util')
  for (const [target, arch] of [[Arch.x64, 'x86_64'], [Arch.arm64, 'arm64']]) {
    const f = fixture(t, { audio: false }), calls = []
    const output = path.join(f.app, 'Contents/Resources/audio/PassWiselyAudioHelper')
    const owner = loadHook({
      './build-macos-audio-helper': { build(options) {
        assert.equal(options.arch, arch); assert.equal(options.output, output); assert.equal(fs.existsSync(output), false)
        fs.writeFileSync(output, macho()); fs.chmodSync(output, 0o755); calls.push('compile'); return { output, arch }
      } },
      'node:child_process': { spawnSync(command, args) { assert.equal(command, '/usr/bin/codesign'); calls.push(['sign', args]); return { status: 0 } } },
    })
    const context = { electronPlatformName: 'darwin', arch: target, appOutDir: path.dirname(f.app), packager: { appInfo: { productFilename: 'Test' } } }
    const result = await owner(context, app => { assert.equal(app, f.app); assert.ok(fs.lstatSync(output).isFile()); calls.push('verify') })
    assert.equal(calls[0], 'compile'); assert.equal(calls[1], 'verify')
    assert.ok(calls.slice(2).every(value => value[0] === 'sign'))
    assert.ok(result.signingPlan.leaves.some(value => value.path === output && value.executable))
    const signature = calls.find(value => Array.isArray(value) && value[1].at(-1) === output)
    assert.ok(signature[1].includes('runtime')); assert.ok(signature[1].includes('--entitlements'))
  }
})

test('compile errors, rejected verification, unsupported architecture and symlink output never sign', async t => {
  const { Arch } = require('builder-util')
  for (const failure of ['compile', 'verify', 'architecture', 'symlink']) {
    const f = fixture(t, { audio: false }), calls = []
    const audio = path.join(f.app, 'Contents/Resources/audio')
    if (failure === 'symlink') fs.symlinkSync(path.dirname(f.app), audio, 'dir')
    const owner = loadHook({
      './build-macos-audio-helper': { build({ output }) { calls.push('compile'); if (failure === 'compile') throw new Error('compile refused'); fs.writeFileSync(output, macho()); return { output } } },
      'node:child_process': { spawnSync() { calls.push('unexpected-sign'); return { status: 0 } } },
    })
    const context = { electronPlatformName: 'darwin', arch: failure === 'architecture' ? Arch.universal : Arch.x64, appOutDir: path.dirname(f.app), packager: { appInfo: { productFilename: 'Test' } } }
    await assert.rejects(owner(context, () => { calls.push('verify'); throw new Error('verify refused') }))
    assert.ok(!calls.includes('unexpected-sign'))
    if (failure === 'architecture' || failure === 'symlink') assert.deepEqual(calls, [])
    if (failure === 'compile') assert.deepEqual(calls, ['compile'])
    if (failure === 'verify') assert.deepEqual(calls, ['compile', 'verify'])
  }
})

test('Developer ID verifier requires the audio helper leaf to carry hardened runtime and timestamp', t => {
  const f = fixture(t), calls = [], filename = path.resolve(import.meta.dirname, '../../scripts/macos-notarization.js')
  const nativeRequire = createRequire(filename), module = { exports: {} }
  let helperRuntime = true
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, process: { env: { APPLE_TEAM_ID: 'FIXTURETEAM' } }, require: name => name === 'node:child_process' ? { spawnSync(command, args) {
      assert.equal(command, '/usr/bin/codesign'); calls.push(args)
      const runtime = args.at(-1) !== f.audioHelper || helperRuntime
      return { status: 0, stdout: 'Authority=Developer ID Application: Fixture\nTeamIdentifier=FIXTURETEAM\nTimestamp=fixture\nCodeDirectory v=20500 flags=' + (runtime ? 'runtime' : '0') + '\n', stderr: '' }
    } } : nativeRequire(name),
  }, { filename })
  module.exports.requireDeveloperIdSignature(f.app)
  assert.ok(calls.some(args => args[0] === '-dv' && args.at(-1) === f.audioHelper))
  assert.ok(calls.some(args => args[0] === '--verify' && args.includes('--strict') && args.at(-1) === f.audioHelper))
  helperRuntime = false
  assert.throws(() => module.exports.requireDeveloperIdSignature(f.app), /hardened runtime/)
})
