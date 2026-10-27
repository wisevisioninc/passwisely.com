const path = require("node:path")
const fs = require("node:fs")
const { spawnSync } = require("node:child_process")
const { Arch } = require("builder-util")
const { build: buildAudioHelper } = require("./build-macos-audio-helper")

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} failed: ${result.error?.message || result.signal || result.status}`)
  }
}

// Read only headers, including the first slice of a universal binary. CAFEBABE
// alone is also Java's class magic and must not make an arbitrary resource code.
function machOType(filePath, size) {
  if (size < 28) return null
  const fd = fs.openSync(filePath, "r")
  try {
    const header = Buffer.alloc(32)
    const readHeader = (offset, sliceSize) => {
      if (sliceSize < 28 || offset < 0 || offset + sliceSize > size) return null
      const count = fs.readSync(fd, header, 0, 32, offset)
      const magic = header.readUInt32BE(0)
      const little = magic === 0xcefaedfe || magic === 0xcffaedfe
      const wide = magic === 0xfeedfacf || magic === 0xcffaedfe
      if (!little && magic !== 0xfeedface && magic !== 0xfeedfacf) return null
      const length = wide ? 32 : 28
      if (count < length || sliceSize < length) return null
      const uint = (at) => little ? header.readUInt32LE(at) : header.readUInt32BE(at)
      const fileType = uint(12)
      const commandsSize = uint(20)
      return fileType > 0 && fileType <= 12 && commandsSize <= sliceSize - length ? fileType : null
    }
    const thin = readHeader(0, size)
    if (thin !== null) return thin
    const magic = header.readUInt32BE(0)
    const little = magic === 0xbebafeca || magic === 0xbfbafeca
    const wide = magic === 0xcafebabf || magic === 0xbfbafeca
    if (!little && magic !== 0xcafebabe && magic !== 0xcafebabf) return null
    const count = little ? header.readUInt32LE(4) : header.readUInt32BE(4)
    const entrySize = wide ? 32 : 20
    if (count < 1 || count > 64 || 8 + count * entrySize > size) return null
    const table = Buffer.alloc(count * entrySize)
    if (fs.readSync(fd, table, 0, table.length, 8) !== table.length) return null
    let fileType = null
    for (let index = 0; index < count; index++) {
      const at = index * entrySize + 8
      const uint = (offset) => little ? table.readUInt32LE(offset) : table.readUInt32BE(offset)
      const uint64 = (offset) => Number(little ? table.readBigUInt64LE(offset) : table.readBigUInt64BE(offset))
      const offset = wide ? uint64(at) : uint(at)
      const sliceSize = wide ? uint64(at + 8) : uint(at + 4)
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(sliceSize)) return null
      const sliceType = readHeader(offset, sliceSize)
      if (sliceType === null || (fileType !== null && fileType !== sliceType)) return null
      fileType = sliceType
    }
    return fileType
  } finally {
    fs.closeSync(fd)
  }
}

function collectCodePaths(appPath) {
  if (fs.lstatSync(appPath).isSymbolicLink()) throw new Error("App root must not be a symlink")
  const root = fs.realpathSync(appPath)
  const leaves = []
  const bundles = []
  function visit(current) {
    const stat = fs.lstatSync(current)
    // Framework aliases (Versions/Current, top-level executable) and outside
    // links must remain untouched. Walk only the actual files once.
    if (stat.isSymbolicLink()) return false
    if (stat.isFile()) {
      const type = machOType(current, stat.size)
      if (type !== null) leaves.push({ path: current, executable: type === 2 })
      return type !== null
    }
    if (!stat.isDirectory()) return false
    let hasCode = false
    for (const name of fs.readdirSync(current).sort()) hasCode = visit(path.join(current, name)) || hasCode
    if (hasCode && /\.(app|framework|xpc|appex|bundle|plugin)$/i.test(current)) bundles.push(current)
    return hasCode
  }
  visit(root)
  if (!bundles.includes(root)) throw new Error("App contains no Mach-O code")
  // Signing a framework's main binary by its file path can still make codesign
  // validate the framework's helpers. Fresh unsigned helpers must precede that
  // binary, not merely precede the later explicit framework-container pass.
  const insideOut = (left, right) => right.split(path.sep).length - left.split(path.sep).length || left.localeCompare(right)
  leaves.sort((left, right) => insideOut(left.path, right.path))
  bundles.sort(insideOut)
  return { root, leaves, bundles }
}

function signAdHocApp(appPath, entitlements, execute = run) {
  const plan = collectCodePaths(appPath)
  // Electron's Mach-O files contain linker signatures even when no Apple
  // identity is installed, while vendor SDKs can carry a different Team ID.
  // --deep signing does not replace every signed leaf (notably in Resources).
  // Normalize all actual code first, then seal code containers inside-out.
  for (const leaf of plan.leaves) {
    execute("/usr/bin/codesign", ["--force", "--sign", "-", "--options", "runtime",
      ...(leaf.executable ? ["--entitlements", entitlements] : []), leaf.path])
  }
  for (const bundle of plan.bundles) {
    execute("/usr/bin/codesign", ["--force", "--sign", "-", "--options", "runtime",
      ...(/\.(app|xpc|appex)$/i.test(bundle) ? ["--entitlements", entitlements] : []), bundle])
  }

  execute("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    plan.root,
  ])
  return plan
}

module.exports = async function afterPackMacOS(context, verify) {
  if (context.electronPlatformName !== "darwin") return
  const arch = context.arch === Arch.x64 ? "x86_64" : context.arch === Arch.arm64 ? "arm64" : null
  if (!arch) throw new Error("Native macOS audio requires an explicit x64 or arm64 package target.")
  if (verify !== undefined && typeof verify !== "function") throw new Error("Package verifier must be a function.")
  const appName = context.packager.appInfo.productFilename
  if (!path.isAbsolute(context.appOutDir) || !appName || path.basename(appName) !== appName) {
    throw new Error("Packaged app path must be absolute and canonical.")
  }
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  if (fs.realpathSync(appPath) !== appPath || !fs.lstatSync(appPath).isDirectory()) {
    throw new Error("Packaged app path must be absolute and canonical.")
  }
  const resources = path.join(appPath, "Contents/Resources")
  if (fs.realpathSync(resources) !== resources || !fs.lstatSync(resources).isDirectory()) {
    throw new Error("Packaged resources must be a real canonical directory.")
  }
  const audio = path.join(resources, "audio")
  try { fs.mkdirSync(audio, { mode: 0o755 }) }
  catch (error) { if (error.code !== "EEXIST") throw error }
  if (fs.realpathSync(audio) !== audio || !fs.lstatSync(audio).isDirectory()) {
    throw new Error("Audio helper output must be a real canonical directory.")
  }
  // The builder refuses any existing output and validates the exact target arch.
  // Compile before architecture verification and before any signing operation.
  const audioHelper = buildAudioHelper({ arch, output: path.join(audio, "PassWiselyAudioHelper") })
  if (verify) await verify(appPath)
  const entitlements = path.resolve(__dirname, "../build/entitlements.mac.plist")
  // Temporary ad-hoc signing only. electron-builder's normal signing phase and
  // afterSign's mandatory Developer ID/notarization checks remain authoritative.
  const signingPlan = signAdHocApp(appPath, entitlements)
  return { audioHelper, signingPlan }
}

module.exports.collectCodePaths = collectCodePaths
module.exports.signAdHocApp = signAdHocApp
