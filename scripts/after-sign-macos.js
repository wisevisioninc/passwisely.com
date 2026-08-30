const path = require("node:path")
const {
  notarizeAndStaple,
  requireDeveloperIdSignature,
} = require("./macos-notarization")

module.exports = async function afterSignMacOS(context) {
  if (context.electronPlatformName !== "darwin") return

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)

  requireDeveloperIdSignature(appPath)
  await notarizeAndStaple(appPath)
}
