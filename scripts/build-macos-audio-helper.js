#!/usr/bin/env node
"use strict"
const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { spawnSync } = require("node:child_process")

function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    if (!["--arch", "--output"].includes(key) || !argv[i + 1] || options[key]) throw new Error("Expected --arch arm64|x86_64 --output /absolute/new/path")
    options[key] = argv[i + 1]
  }
  if (!["arm64", "x86_64"].includes(options["--arch"]) || !path.isAbsolute(options["--output"] || "")) throw new Error("Architecture and absolute output path are required")
  return { arch: options["--arch"], output: path.normalize(options["--output"]) }
}
function build({ arch, output }, source = path.join(__dirname, "../electron/native/PassWiselyAudioHelper.mm")) {
  if (process.platform !== "darwin") throw new Error("macOS Command Line Tools are required")
  if (!["arm64", "x86_64"].includes(arch) || !path.isAbsolute(output)) throw new Error("Invalid build options")
  const environment = { PATH: "/usr/bin:/bin", LANG: "C", DEVELOPER_DIR: "/Library/Developer/CommandLineTools", TMPDIR: path.dirname(output) }
  const run = (command, args) => {
    const result = spawnSync(command, args, { env: environment, encoding: "utf8", timeout: 120000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 })
    if (result.error || result.status !== 0) throw new Error(`Build tool failed: ${path.basename(command)}\n${result.stderr || result.error?.message || ""}`)
    return result.stdout.trim()
  }
  if (fs.existsSync(output) || fs.lstatSync(path.dirname(output)).isSymbolicLink()) throw new Error("Output must be a new file in an existing real directory")
  const parent = fs.realpathSync(path.dirname(output))
  if (parent !== path.dirname(output)) throw new Error("Output directory must be canonical")
  const temporary = path.join(parent, `.${path.basename(output)}.build-${crypto.randomUUID()}`)
  try {
    const sdk = run("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"])
    const compiler = run("/usr/bin/xcrun", ["--sdk", "macosx", "--find", "clang++"])
    run(compiler, ["-std=c++17", "-fobjc-arc", "-fblocks", "-O2", "-Wall", "-Wextra", "-Werror", "-arch", arch, "-mmacosx-version-min=13.0", "-isysroot", sdk, source, "-framework", "Foundation", "-framework", "AVFoundation", "-framework", "ScreenCaptureKit", "-framework", "CoreMedia", "-framework", "CoreGraphics", "-framework", "AudioToolbox", "-o", temporary])
    const actual = run("/usr/bin/lipo", ["-archs", temporary])
    if (actual !== arch) throw new Error("Compiled architecture does not match request")
    fs.chmodSync(temporary, 0o755)
    // A hard-link publishes without replacing a caller-owned existing output.
    fs.linkSync(temporary, output)
    const data = fs.readFileSync(output)
    return { arch, output, bytes: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex"), minimumMacOS: "13.0", bundleIdentifier: "com.passwisely.desktop.audio-helper", signedForDistribution: false }
  } finally { try { fs.unlinkSync(temporary) } catch (error) { if (error.code !== "ENOENT") throw error } }
}
module.exports = { parseArgs, build }
if (require.main === module) {
  try { console.log(JSON.stringify(build(parseArgs(process.argv.slice(2))))) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
