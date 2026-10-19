import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

function fixture(t) {
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
  return { app, main, helper, sdk, library, framework }
}

test('discovers SDK code under Resources, signs real leaves before containers and verifies strictly', (t) => {
  const f = fixture(t)
  const calls = []
  const plan = afterPack.signAdHocApp(f.app, '/entitlements.plist', (command, args) => calls.push({ command, args }))
  assert.deepEqual(new Set(plan.leaves.map(x => x.path)), new Set([f.main, f.helper, f.sdk, f.library]))
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
  assert.ok(selected.has(f.sdk))
  assert.ok(selected.has(f.library))
  assert.ok(selected.has(f.framework))
})
