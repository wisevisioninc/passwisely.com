import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const asar = require("@electron/asar")
const { Arch } = require("builder-util")
const base = require("../../package.json").build
const canvasVersion = require("../../package-lock.json").packages["node_modules/@napi-rs/canvas-darwin-x64"].version
const canvasPackage = "node_modules/@napi-rs/canvas-darwin-x64"
const canvasNode = canvasPackage + "/skia.darwin-x64.node"

function load(relative, mocks = {}, globals = {}) {
  const filename = path.resolve(import.meta.dirname, relative)
  const nativeRequire = createRequire(filename), module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, require: name => Object.hasOwn(mocks, name) ? mocks[name] : nativeRequire(name), ...globals,
  }, { filename })
  return module.exports
}

function macho(type = 6) {
  const data = Buffer.alloc(32)
  data.writeUInt32LE(0xfeedfacf); data.writeUInt32LE(0x1000007, 4); data.writeUInt32LE(type, 12)
  return data
}

async function fixture(t, { unpack = true, extra = {} } = {}) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "passwisely-intel-")))
  t.after(() => { asar.uncacheAll(); fs.rmSync(temporary, { recursive: true, force: true }) })
  const app = path.join(temporary, "Test.app"), source = path.join(temporary, "source")
  const write = (root, name, value) => {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); return file
  }
  const main = write(app, "Contents/MacOS/Test", macho(2))
  const helper = write(app, "Contents/Resources/audio/PassWiselyAudioHelper", macho(2))
  fs.chmodSync(helper, 0o755)
  write(source, canvasNode, macho())
  write(source, canvasPackage + "/package.json", JSON.stringify({ name: "@napi-rs/canvas-darwin-x64", version: canvasVersion, main: "skia.darwin-x64.node" }))
  for (const [name, value] of Object.entries(extra)) write(source, name, value)
  const archive = path.join(app, "Contents/Resources/app.asar")
  fs.mkdirSync(path.dirname(archive), { recursive: true })
  await asar.createPackageWithOptions(source, archive, unpack ? { unpackDir: canvasPackage } : {})
  return { app, main, helper, archive, native: archive + ".unpacked/" + canvasNode, write }
}

function verifier({ badArchitecture, lipoFailure = false, developerDir } = {}) {
  const calls = []
  const api = load("../../scripts/verify-macos-intel.js", { "node:child_process": {
    spawnSync(command, args, options) {
      calls.push({ command, args, options })
      return { status: lipoFailure ? 1 : 0, stdout: args.at(-1) === badArchitecture ? "arm64" : "x86_64 arm64" }
    },
  } }, { process: { env: developerDir === undefined ? {} : { DEVELOPER_DIR: developerDir } } })
  return { ...api, calls }
}

test("Intel profile inherits release signing/notarization hooks and applies real dependency exclusions", () => {
  const profile = require("../../build/electron-builder.mac-x64.cjs")
  assert.equal(profile.afterSign, base.afterSign); assert.equal(profile.afterAllArtifactBuild, base.afterAllArtifactBuild)
  assert.equal(profile.npmRebuild, false); assert.equal(profile.mac.hardenedRuntime, true)
  assert.equal(profile.forceCodeSigning, true); assert.equal(profile.dmg.writeUpdateInfo, false)
  assert.deepEqual(profile.mac.target, [{ target: "dmg", arch: ["x64"] }])
  assert.ok(profile.asarUnpack.includes(canvasPackage + "/**/*"))
  const { getNodeModuleFileMatcher } = require("app-builder-lib/out/fileMatcher")
  const filter = getNodeModuleFileMatcher("/app", "/output", value => value, profile.mac, {
    config: profile, debugLogger: { isEnabled: false },
  }).createFilter()
  const file = { isDirectory: () => false }
  for (const name of ["node_modules/@recallai/desktop-sdk/desktop_sdk_macos_exe", "node_modules/@recallai/desktop-sdk/Frameworks/Native.dylib", "node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node"]) {
    assert.equal(filter("/app/" + name, file), false, name)
  }
  for (const name of [canvasNode, "node_modules/@recallai/desktop-sdk/index.js", "node_modules/uuid/dist/index.js"]) {
    assert.equal(filter("/app/" + name, file), true, name)
  }
})

test("valid unpacked Canvas and every code leaf are checked without invoking signing or target code", async t => {
  const f = await fixture(t), api = verifier()
  const result = api.verifyMacosIntel(f.app)
  assert.equal(result.nativeCodeFiles, 3); assert.equal(result.canvasVersion, canvasVersion)
  assert.equal(result.liveAudio, "included")
  assert.deepEqual(new Set(api.calls.map(call => call.args.at(-1))), new Set([f.main, f.native, f.helper]))
  assert.ok(api.calls.every(call => call.command === "/usr/bin/lipo" && call.args[0] === "-archs"))
  assert.ok(api.calls.every(call => Object.keys(call.options.env).sort().join(",") === "LANG,PATH"))
  const selected = verifier({ developerDir: "/Library/Developer/CommandLineTools" })
  selected.verifyMacosIntel(f.app)
  assert.ok(selected.calls.every(call => call.options.env.DEVELOPER_DIR === "/Library/Developer/CommandLineTools"))
  assert.ok(selected.calls.every(call => Object.keys(call.options.env).sort().join(",") === "DEVELOPER_DIR,LANG,PATH"))
})

test("wrong or uninspectable architecture, packed Canvas, missing and changed unpacked bytes fail closed", async t => {
  const f = await fixture(t)
  assert.throws(() => verifier({ badArchitecture: f.helper }).verifyMacosIntel(f.app), /include x86_64/)
  assert.throws(() => verifier({ badArchitecture: f.native }).verifyMacosIntel(f.app), /include x86_64/)
  assert.throws(() => verifier({ lipoFailure: true }).verifyMacosIntel(f.app), /include x86_64/)
  fs.writeFileSync(f.native, Buffer.from("changed"))
  assert.throws(() => verifier().verifyMacosIntel(f.app), /differs from its ASAR entry/)
  fs.rmSync(f.native)
  assert.throws(() => verifier().verifyMacosIntel(f.app), /real unpacked file/)
  const packed = await fixture(t, { unpack: false })
  assert.throws(() => verifier().verifyMacosIntel(packed.app), /real unpacked file/)
})

test("excluded Recall code and additional packed native libraries cannot bypass the boundary", async t => {
  const recall = await fixture(t, { extra: { "node_modules/@recallai/desktop-sdk/desktop_sdk_macos_exe": macho() } })
  assert.throws(() => verifier().verifyMacosIntel(recall.app), /excluded native resources/)
  const hidden = await fixture(t, { extra: { "node_modules/other/hidden.node": macho() } })
  assert.throws(() => verifier().verifyMacosIntel(hidden.app), /remains inside ASAR/)
  const dangling = await fixture(t)
  const recallRoot = path.join(dangling.archive + ".unpacked", "node_modules/@recallai/desktop-sdk")
  fs.mkdirSync(recallRoot, { recursive: true })
  fs.symlinkSync("/missing-frameworks", path.join(recallRoot, "Frameworks"), "dir")
  assert.throws(() => verifier().verifyMacosIntel(dangling.app), /excluded native resources/)
})

test("profile delegates compile/verify/sign ordering to the shared owner and rejects other targets", async () => {
  const calls = []
  const sharedOwner = async (context, verify) => {
    calls.push(["compile"])
    await verify(path.join(context.appOutDir, context.packager.appInfo.productFilename + ".app"))
    calls.push(["sign"])
  }
  const profile = load("../../build/electron-builder.mac-x64.cjs", {
    "../scripts/verify-macos-intel": { verifyMacosIntel: app => { calls.push(["verify", app]) } },
    "../scripts/after-pack-macos": sharedOwner,
  })
  const context = { electronPlatformName: "darwin", arch: Arch.x64, appOutDir: "/build/mac", packager: { appInfo: { productFilename: "PassWisely" } } }
  await profile.afterPack(context)
  assert.deepEqual(calls.map(value => value[0]), ["compile", "verify", "sign"])
  assert.equal(calls[1][1], "/build/mac/PassWisely.app")
  await assert.rejects(profile.afterPack({ ...context, arch: Arch.arm64 }), /darwin\/x64/)
  await assert.rejects(profile.afterPack({ ...context, electronPlatformName: "win32" }), /darwin\/x64/)
  assert.equal(calls.length, 3)
  calls.length = 0
  const refused = load("../../build/electron-builder.mac-x64.cjs", {
    "../scripts/verify-macos-intel": { verifyMacosIntel: () => { throw new Error("native refused") } },
    "../scripts/after-pack-macos": sharedOwner,
  })
  await assert.rejects(refused.afterPack(context), /native refused/)
  assert.deepEqual(calls.map(value => value[0]), ["compile"])
})

test("Intel audio helper is mandatory real executable code and cannot hide behind symlinks", async t => {
  for (const kind of ["missing", "text", "dylib", "no-execute", "symlink"]) {
    const f = await fixture(t)
    if (kind === "missing") fs.rmSync(f.helper)
    if (kind === "text") fs.writeFileSync(f.helper, "not code")
    if (kind === "dylib") fs.writeFileSync(f.helper, macho(6))
    if (kind === "no-execute") fs.chmodSync(f.helper, 0o644)
    if (kind === "symlink") { fs.rmSync(f.helper); fs.symlinkSync(f.main, f.helper) }
    assert.throws(() => verifier().verifyMacosIntel(f.app), /audio helper must be a real executable Mach-O/, kind)
  }
})
