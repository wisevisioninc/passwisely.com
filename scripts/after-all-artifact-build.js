const path = require("node:path")
const {
  notarizeAndStaple,
  signDiskImage,
} = require("./macos-notarization")

module.exports = async function afterAllArtifactBuild(context) {
  const diskImages = context.artifactPaths.filter(
    artifactPath => path.extname(artifactPath).toLowerCase() === ".dmg",
  )

  for (const diskImage of diskImages) {
    signDiskImage(diskImage)
    await notarizeAndStaple(diskImage)
  }

  return []
}
