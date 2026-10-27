const { Arch } = require("builder-util")
const base = require("../package.json").build
const afterPackMacOS = require("../scripts/after-pack-macos")
const { verifyMacosIntel } = require("../scripts/verify-macos-intel")

// Build assets with host development tools, then point directories.app at an
// isolated npm production install for darwin/x64. Never rebuild shared ARM deps.
module.exports = {
  ...base,
  npmRebuild: false,
  forceCodeSigning: true,
  dmg: { ...base.dmg, writeUpdateInfo: false },
  mac: { ...base.mac, target: [{ target: "dmg", arch: ["x64"] }] },
  files: [
    ...base.files,
    "!node_modules/@recallai/desktop-sdk/desktop_sdk_macos_exe",
    "!node_modules/@recallai/desktop-sdk/Frameworks{,/**/*}",
    "!node_modules/@napi-rs/canvas-darwin-arm64{,/**/*}",
  ],
  asarUnpack: [
    ...base.asarUnpack,
    "node_modules/@napi-rs/canvas-darwin-x64/**/*",
  ],
  async afterPack(context) {
    if (context.electronPlatformName !== "darwin" || context.arch !== Arch.x64) {
      throw new Error("The mac-x64 profile requires a darwin/x64 target.")
    }
    await afterPackMacOS(context, verifyMacosIntel)
  },
}
