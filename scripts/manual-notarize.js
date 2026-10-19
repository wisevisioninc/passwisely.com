require("dotenv").config()
const path = require("path")
const { requireDeveloperIdSignature, notarizeAndStaple } = require("./macos-notarization")

async function notarizeApp(appPath) {
  const fullPath = path.resolve(
    __dirname,
    "..",
    appPath || "release/mac/PassWisely.app"
  )
  console.log("Starting notarization...")
  console.log("App Path:", fullPath)

  requireDeveloperIdSignature(fullPath)
  await notarizeAndStaple(fullPath)
  console.log("Notarization and staple validation complete!")
}

if (require.main === module) {
  notarizeApp(process.argv[2]).catch(error => {
    console.error("Error during notarization:", error.message)
    process.exitCode = 1
  })
}

module.exports = { notarizeApp }
