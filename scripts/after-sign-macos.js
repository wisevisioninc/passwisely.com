const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { notarize } = require("@electron/notarize")

function notarizationCredentials() {
  if (
    process.env.APPLE_API_KEY &&
    process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER
  ) {
    return {
      appleApiKey: process.env.APPLE_API_KEY,
      appleApiKeyId: process.env.APPLE_API_KEY_ID,
      appleApiIssuer: process.env.APPLE_API_ISSUER,
    }
  }

  if (
    process.env.APPLE_ID &&
    process.env.APPLE_APP_SPECIFIC_PASSWORD &&
    process.env.APPLE_TEAM_ID
  ) {
    return {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    }
  }

  if (process.env.APPLE_KEYCHAIN_PROFILE) {
    return {
      keychainProfile: process.env.APPLE_KEYCHAIN_PROFILE,
      ...(process.env.APPLE_KEYCHAIN
        ? { keychain: process.env.APPLE_KEYCHAIN }
        : {}),
    }
  }

  return null
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} exited with status ${result.status}`)
  }
}

module.exports = async function afterSignMacOS(context) {
  if (context.electronPlatformName !== "darwin") return

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  const credentials = notarizationCredentials()

  if (!credentials) {
    const details = spawnSync(
      "/usr/bin/codesign",
      ["-dv", "--verbose=2", appPath],
      { encoding: "utf8" },
    )
    const signatureDetails = `${details.stdout || ""}\n${details.stderr || ""}`
    const hasDeveloperId = signatureDetails.includes(
      "Authority=Developer ID Application",
    )

    if (hasDeveloperId) {
      throw new Error(
        "A Developer ID signed macOS release must also be notarized. " +
          "Configure Apple ID, App Store Connect API key, or Keychain " +
          "profile credentials.",
      )
    }

    console.warn(
      "Skipping Apple notarization for this ad-hoc signed local build. " +
        "It is not suitable for public distribution.",
    )
    return
  }

  await notarize({
    tool: "notarytool",
    appPath,
    ...credentials,
  })

  run("/usr/bin/xcrun", ["stapler", "staple", appPath])
  run("/usr/bin/xcrun", ["stapler", "validate", appPath])
}
