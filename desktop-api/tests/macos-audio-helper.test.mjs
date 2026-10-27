import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { parseArgs, build } = require(path.join(root, 'scripts/build-macos-audio-helper.js'))
const native = process.platform === 'darwin'
let temporary, helper, fixture, builds
before(() => {
  if (!native) return
  temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'passwisely-audio-test-'))
  builds = ['arm64', 'x86_64'].map(arch => build({ arch, output: path.join(temporary, arch) }))
  helper = builds.find(value => value.arch === (process.arch === 'arm64' ? 'arm64' : 'x86_64')).output
  fixture = build({ arch: process.arch === 'arm64' ? 'arm64' : 'x86_64', output: path.join(temporary, 'converter-fixture') }, path.join(root, 'desktop-api/fixtures/macos-audio-helper-fixture.mm')).output
})
after(() => { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }) })
function invoke(binary, input = '', args = []) {
  const result = spawnSync(binary, args, { input, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.equal(result.stderr, '')
  const lines = result.stdout.trimEnd() ? result.stdout.trimEnd().split('\n') : []
  for (const line of lines) assert.ok(Buffer.byteLength(line) + 1 <= 65536)
  return { ...result, records: lines.map(line => JSON.parse(line)) }
}
test('native builder requires explicit architecture and absolute new output', () => {
  assert.deepEqual(parseArgs(['--arch', 'x86_64', '--output', '/tmp/with space/helper']), { arch: 'x86_64', output: '/tmp/with space/helper' })
  for (const args of [[], ['--arch', 'x64', '--output', '/tmp/helper'], ['--arch', 'arm64', '--output', './helper'], ['--arch', 'arm64', '--arch', 'x86_64', '--output', '/tmp/helper'], ['--unknown', 'value']]) assert.throws(() => parseArgs(args))
})
test('both real Mach-O architectures compile with embedded privacy descriptions', { skip: !native }, () => {
  assert.deepEqual(builds.map(value => value.arch), ['arm64', 'x86_64'])
  for (const entry of builds) {
    assert.ok(entry.bytes > 10000)
    const data = fs.readFileSync(entry.output)
    for (const value of ['com.passwisely.desktop.audio-helper', 'NSMicrophoneUsageDescription', 'NSAudioCaptureUsageDescription', 'NSScreenCaptureUsageDescription']) assert.ok(data.includes(Buffer.from(value)))
  }
})
test('EOF and stop release idle helper; invalid protocol fails without opening devices', { skip: !native }, () => {
  for (const input of ['', '{"command":"stop"}\n']) {
    const result = invoke(helper, input)
    assert.equal(result.status, 0)
    assert.deepEqual(result.records, [{ event: 'state', state: 'ended' }])
  }
  for (const [input, code] of [
    ['{"command":"unknown"}\n', 'PROTOCOL_ERROR'],
    ['{"command":"stop","extra":true}\n', 'PROTOCOL_ERROR'],
    ['{"command":"stop"}', 'PROTOCOL_ERROR'],
    ['x'.repeat(4097), 'PROTOCOL_ERROR'],
    [Buffer.from([255, 10]), 'PROTOCOL_ERROR'],
    ['{"command":"start"}\n', 'INVALID_STATE'],
    ['{"command":"pause"}\n', 'INVALID_STATE'],
    ['{"command":"resume"}\n', 'INVALID_STATE'],
  ]) {
    const result = invoke(helper, input)
    assert.equal(result.status, 1)
    assert.deepEqual(result.records, [{ event: 'error', code }, { event: 'state', state: 'ended' }])
  }
  assert.equal(invoke(helper, '', ['unexpected-argument']).records[0].code, 'PROTOCOL_ERROR')
})
test('production converter emits separate 16k mono signed16LE sources from synthetic input', { skip: !native }, () => {
  const result = invoke(fixture)
  assert.equal(result.status, 0)
  assert.ok(result.records.every(value => value.event === 'audio'))
  const streams = Object.fromEntries(['system', 'microphone'].map(source => [source, result.records.filter(value => value.source === source).map(value => Buffer.from(value.audio, 'base64'))]))
  const system = Buffer.concat(streams.system)
  // Two seconds of 48k stereo become two seconds of mono16k, apart from the
  // finite startup filter delay. Packet boundaries belong to the converter.
  assert.ok(system.length >= (32000 - 512) * 2 && system.length <= 32000 * 2)
  assert.ok(streams.system.every(buffer => buffer.length <= 3200 && buffer.length % 2 === 0))
  for (let i = system.length / 2 - 1600; i < system.length / 2; i++) assert.ok(Math.abs(system.readInt16LE(i * 2) - 8192) <= 2)
  const microphone = Buffer.concat(streams.microphone)
  assert.equal(microphone.length, 3200)
  for (let i = 0; i < 1600; i++) assert.equal(microphone.readInt16LE(i * 2), i % 101 - 50)
})
test('production output owner bounds backlog and reports fixed overload without partial JSON', { skip: !native }, () => {
  const result = invoke(fixture, '', ['overload'])
  assert.equal(result.status, 1)
  assert.ok(Buffer.byteLength(result.stdout) < 512 * 1024)
  assert.deepEqual(result.records.filter(value => value.event === 'error'), [{ event: 'error', code: 'OUTPUT_BACKPRESSURE' }])
})
test('builder preserves caller-owned existing output', { skip: !native }, () => {
  const output = path.join(temporary, 'existing')
  fs.writeFileSync(output, 'caller-owned')
  assert.throws(() => build({ arch: 'arm64', output }), /new file/)
  assert.equal(fs.readFileSync(output, 'utf8'), 'caller-owned')
})

test('normal stop delivers both admitted PCM tails before ended even when work was queued', { skip: !native }, () => {
  const result = invoke(fixture, '', ['tail'])
  assert.equal(result.status, 0)
  assert.deepEqual(result.records[0], { event: 'state', state: 'recording' })
  assert.deepEqual(result.records.at(-1), { event: 'state', state: 'ended' })
  const audio = result.records.filter(value => value.event === 'audio')
  assert.deepEqual(new Set(audio.map(value => value.source)), new Set(['system', 'microphone']))
  const pcm = source => Buffer.concat(audio.filter(value => value.source === source).map(value => Buffer.from(value.audio, 'base64')))
  const microphone = pcm('microphone'), system = pcm('system')
  assert.equal(microphone.length, 3200)
  for (let i = 0; i < 1600; ++i) assert.equal(microphone.readInt16LE(i * 2), i % 101 - 50)
  assert.ok(system.length >= 3200 && system.length <= 3264, 'all input duration plus bounded resampler filter tail is emitted')
  let finalMarkerSamples = 0
  for (let i = system.length / 2 - 128; i < system.length / 2; ++i) if (system.readInt16LE(i * 2) > 19000) ++finalMarkerSamples
  assert.ok(finalMarkerSamples >= 20, 'resampler end-of-stream tail contains the final high-amplitude marker')
})

test('permission-only prepare emits a separate prepared event and never starts capture', { skip: !native }, () => {
  const prepared = invoke(fixture, '', ['prepare'])
  assert.equal(prepared.status, 0)
  assert.deepEqual(prepared.records, [{ event: 'prepared' }, { event: 'state', state: 'ended' }])
  for (const [mode, code] of [['prepare-microphone-denied', 'MICROPHONE_PERMISSION_DENIED'], ['prepare-screen-denied', 'SCREEN_PERMISSION_DENIED']]) {
    const denied = invoke(fixture, '', [mode])
    assert.equal(denied.status, 1)
    assert.deepEqual(denied.records, [{ event: 'error', code }, { event: 'state', state: 'ended' }])
  }
  const stopped = invoke(fixture, '', ['prepare-stop'])
  assert.equal(stopped.status, 0)
  assert.deepEqual(stopped.records, [{ event: 'state', state: 'ended' }])
})

test('input format replacement preserves the preceding resampler tail before new PCM', { skip: !native }, () => {
  const result = invoke(fixture, '', ['format-switch'])
  assert.equal(result.status, 0)
  assert.ok(result.records.every(value => value.event === 'audio' && value.source === 'system'))
  const pcm = Buffer.concat(result.records.map(value => Buffer.from(value.audio, 'base64')))
  const previousBytes = pcm.length - 3200
  assert.ok(previousBytes >= 3200 && previousBytes <= 3264)
  for (let i = 0; i < 1600; ++i) assert.equal(pcm.readInt16LE(previousBytes + i * 2), i % 101 - 50)
  let marker = 0
  for (let i = previousBytes / 2 - 128; i < previousBytes / 2; ++i) if (pcm.readInt16LE(i * 2) > 19000) ++marker
  assert.ok(marker >= 20)
})
