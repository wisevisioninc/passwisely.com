const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { spawnSync } = require("node:child_process")
const asar = require("@electron/asar")
const { collectCodePaths } = require("./after-pack-macos")
const lock = require("../package-lock.json")

const CANVAS_PACKAGE = "node_modules/@napi-rs/canvas-darwin-x64"
const CANVAS_NODE = CANVAS_PACKAGE + "/skia.darwin-x64.node"
const AUDIO_HELPER = "Contents/Resources/audio/PassWiselyAudioHelper"
const RECALL_PACKAGE = "node_modules/@recallai/desktop-sdk"
const EXCLUDED = [
  RECALL_PACKAGE + "/desktop_sdk_macos_exe",
  RECALL_PACKAGE + "/Frameworks",
  "node_modules/@napi-rs/canvas-darwin-arm64",
]

function exists(file) {
  try { fs.lstatSync(file); return true }
  catch (error) { if (error.code === "ENOENT") return false; throw error }
}

function verifyMacosIntel(appPath) {
  // Reuse the signing owner's classification, including nested Resources code.
  const plan = collectCodePaths(appPath)
  const helper = path.join(plan.root, AUDIO_HELPER)
  if (!exists(helper) || !fs.lstatSync(helper).isFile() ||
      (fs.lstatSync(helper).mode & 0o100) === 0 || fs.realpathSync(helper) !== helper ||
      !plan.leaves.some(leaf => leaf.path === helper && leaf.executable)) {
    throw new Error("Intel audio helper must be a real executable Mach-O in the signing owner's code plan.")
  }
  const archive = path.join(plan.root, "Contents/Resources/app.asar")
  const unpacked = archive + ".unpacked"
  const entries = asar.listPackage(archive).map(name => name.replace(/^\//, ""))
  for (const excluded of EXCLUDED) {
    if (entries.some(name => name === excluded || name.startsWith(excluded + "/")) ||
        exists(path.join(unpacked, excluded))) {
      throw new Error("Intel package contains excluded native resources: " + excluded)
    }
  }
  const canvas = asar.statFile(archive, CANVAS_NODE, false)
  const realCanvas = path.join(unpacked, CANVAS_NODE)
  if (canvas.unpacked !== true || !exists(realCanvas) ||
      !fs.lstatSync(realCanvas).isFile() || fs.realpathSync(realCanvas) !== realCanvas) {
    throw new Error("Intel Canvas native library must be a real unpacked file.")
  }
  const data = fs.readFileSync(realCanvas)
  if (canvas.size !== data.length || canvas.integrity?.algorithm !== "SHA256" ||
      canvas.integrity.hash !== crypto.createHash("sha256").update(data).digest("hex")) {
    throw new Error("Intel Canvas native library differs from its ASAR entry.")
  }
  const metadata = JSON.parse(asar.extractFile(archive, CANVAS_PACKAGE + "/package.json"))
  const expected = lock.packages[CANVAS_PACKAGE]
  if (metadata.name !== "@napi-rs/canvas-darwin-x64" ||
      metadata.version !== expected.version || metadata.main !== "skia.darwin-x64.node") {
    throw new Error("Intel Canvas package does not match the locked native dependency.")
  }
  if (!plan.leaves.some(leaf => leaf.path === realCanvas)) {
    throw new Error("Intel Canvas native library is missing from the signing owner's code plan.")
  }
  // No packed .node may escape architecture and signature checks.
  for (const name of entries.filter(name => name.endsWith(".node"))) {
    if (asar.statFile(archive, name, false).unpacked !== true) {
      throw new Error("Intel native library remains inside ASAR: " + name)
    }
  }
  for (const leaf of plan.leaves) {
    const result = spawnSync("/usr/bin/lipo", ["-archs", leaf.path], {
      encoding: "utf8", timeout: 10_000, maxBuffer: 4096,
      env: { PATH: "/usr/bin:/bin", LANG: "C",
        ...(process.env.DEVELOPER_DIR === undefined ? {} : { DEVELOPER_DIR: process.env.DEVELOPER_DIR }),
      },
    })
    if (result.error || result.status !== 0 ||
        !String(result.stdout).trim().split(/\s+/).includes("x86_64")) {
      throw new Error("Intel native code must include x86_64: " + path.relative(plan.root, leaf.path))
    }
  }
  return { nativeCodeFiles: plan.leaves.length, canvasVersion: metadata.version, liveAudio: "included" }
}

module.exports = { verifyMacosIntel }

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node scripts/verify-macos-intel.js /absolute/PassWisely.app")
    console.log(JSON.stringify({ success: true, ...verifyMacosIntel(process.argv[2]) }))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
