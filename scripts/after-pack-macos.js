const path = require("node:path")
const { spawnSync } = require("node:child_process")

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} exited with status ${result.status}`)
  }
}

module.exports = async function afterPackMacOS(context) {
  if (context.electronPlatformName !== "darwin") return

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  const entitlements = path.resolve(__dirname, "../build/entitlements.mac.plist")

  // Electron's Mach-O files contain linker signatures even when no Apple
  // distribution identity is installed. Signing the complete bundle ad-hoc
  // prevents an internally inconsistent app from being shipped. When a
  // Developer ID certificate is available, electron-builder replaces this
  // temporary signature with the real identity in its normal signing phase.
  run("/usr/bin/codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    "--options",
    "runtime",
    "--entitlements",
    entitlements,
    appPath,
  ])

  run("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appPath,
  ])
}
