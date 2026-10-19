import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const scripts = new URL('../../scripts/', import.meta.url)
const valid = 'Authority=Developer ID Application: Example (VFF94RK9TN)\nTeamIdentifier=VFF94RK9TN\nTimestamp=Oct 19, 2026\nCodeDirectory v=20500 flags=0x10000(runtime)\n'

function loadNotarization({ details = {}, badVerify } = {}) {
  const calls = []
  const module = { exports: {} }
  const context = {
    module, process: { env: { APPLE_KEYCHAIN_PROFILE: 'test-notary' } },
    require(name) {
      if (name === 'node:path') return path
      if (name === './after-pack-macos') return { collectCodePaths: () => ({ leaves: [{ path: '/Test.app/Contents/Resources/vendor' }], bundles: ['/Test.app'] }) }
      if (name === '@electron/notarize') return { notarize: async options => calls.push({ notarize: options }) }
      if (name === 'node:child_process') return { spawnSync(command, args) {
        calls.push({ command, args })
        const target = args.at(-1)
        return { status: args.includes('--verify') && target === badVerify ? 1 : 0, stdout: '', stderr: args.includes('-dv') ? details[target] ?? valid : '' }
      } }
      throw new Error(`Unexpected dependency ${name}`)
    },
  }
  vm.runInNewContext(fs.readFileSync(new URL('macos-notarization.js', scripts), 'utf8'), context)
  return { api: module.exports, calls }
}

test('release check verifies actual Resources SDK leaves and complete bundle with trusted timestamps', () => {
  const { api, calls } = loadNotarization()
  api.requireDeveloperIdSignature('/Test.app')
  assert.deepEqual(calls.filter(call => call.args?.includes('-dv')).map(call => call.args.at(-1)), ['/Test.app/Contents/Resources/vendor', '/Test.app'])
  assert.ok(calls.some(call => call.args?.includes('--deep') && call.args.includes('--strict')))
})

test('release check rejects nested foreign/ad-hoc/non-runtime/untimestamped or invalid SDK code', () => {
  const target = '/Test.app/Contents/Resources/vendor'
  for (const [detail, expected] of [
    [valid.replace('TeamIdentifier=VFF94RK9TN', 'TeamIdentifier=OTHER'), /expected Apple team/],
    [valid.replace('Authority=Developer ID Application:', 'Signature=adhoc'), /Developer ID Application/],
    [valid.replace('Timestamp=Oct 19, 2026', 'Signed Time=Oct 19, 2026'), /trusted signing timestamp/],
    [valid.replace('(runtime)', '(adhoc)'), /hardened runtime/],
  ]) {
    assert.throws(() => loadNotarization({ details: { [target]: detail } }).api.requireDeveloperIdSignature('/Test.app'), expected)
  }
  assert.throws(() => loadNotarization({ badVerify: target }).api.requireDeveloperIdSignature('/Test.app'), /codesign exited/)
})

test('DMG release check requires Developer ID and timestamp without treating it as an executable bundle', () => {
  const { api } = loadNotarization({ details: { '/Test.dmg': valid.replace('CodeDirectory v=20500 flags=0x10000(runtime)\n', '') } })
  api.requireDeveloperIdSignature('/Test.dmg')
})

test('shared notarization supports configured keychain profile and validates the ticket', async () => {
  const { api, calls } = loadNotarization()
  await api.notarizeAndStaple('/Test.app')
  assert.equal(calls.find(call => call.notarize)?.notarize.keychainProfile, 'test-notary')
  assert.ok(calls.some(call => call.command === '/usr/bin/xcrun' && call.args.join(' ') === 'stapler validate /Test.app'))
})

test('manual notarization shares release verification/profile flow and propagates failures', async () => {
  const calls = []
  const module = { exports: {} }
  const context = {
    module, __dirname: '/repo/scripts', console: { log() {} },
    require(name) {
      if (name === 'dotenv') return { config() {} }
      if (name === 'path') return path
      if (name === './macos-notarization') return {
        requireDeveloperIdSignature: target => calls.push(['verify', target]),
        notarizeAndStaple: async target => { calls.push(['notarize', target]); throw new Error('Notary rejected') },
      }
      throw new Error(`Unexpected dependency ${name}`)
    },
  }
  vm.runInNewContext(fs.readFileSync(new URL('manual-notarize.js', scripts), 'utf8'), context)
  await assert.rejects(module.exports.notarizeApp('release/mac-arm64/Test.app'), /Notary rejected/)
  assert.deepEqual(calls, [['verify', '/repo/release/mac-arm64/Test.app'], ['notarize', '/repo/release/mac-arm64/Test.app']])
})
