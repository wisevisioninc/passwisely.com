const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { notarize } = require("@electron/notarize")

const EXPECTED_TEAM_ID = process.env.APPLE_TEAM_ID || "VFF94RK9TN"

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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? "pipe" : "inherit",
    encoding: options.capture ? "utf8" : undefined,
  })
  if (result.status !== 0) {
    const details = options.capture
      ? `\n${result.stdout || ""}${result.stderr || ""}`
      : ""
    throw new Error(
      `${path.basename(command)} exited with status ${result.status}${details}`,
    )
  }
  return `${result.stdout || ""}${result.stderr || ""}`
}

function requireDeveloperIdSignature(appPath) {
  const details = run(
    "/usr/bin/codesign",
    ["-dv", "--verbose=4", appPath],
    { capture: true },
  )

  if (!details.includes("Authority=Developer ID Application")) {
    throw new Error(
      `${appPath} is not signed with a Developer ID Application certificate.`,
    )
  }

  if (!details.includes(`TeamIdentifier=${EXPECTED_TEAM_ID}`)) {
    throw new Error(
      `${appPath} is not signed by the expected Apple team ${EXPECTED_TEAM_ID}.`,
    )
  }

  run("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appPath,
  ])
}

function developerIdIdentityHash() {
  if (process.env.MACOS_SIGNING_IDENTITY) {
    return process.env.MACOS_SIGNING_IDENTITY
  }

  const identities = run(
    "/usr/bin/security",
    ["find-identity", "-v", "-p", "codesigning"],
    { capture: true },
  )
  const identityLine = identities
    .split("\n")
    .find(
      line =>
        line.includes('\"Developer ID Application:') &&
        line.includes(`(${EXPECTED_TEAM_ID})`),
    )
  const match = identityLine && identityLine.match(/([0-9A-F]{40})/)

  if (!match) {
    throw new Error(
      `No Developer ID Application identity was found for Apple team ${EXPECTED_TEAM_ID}.`,
    )
  }
  return match[1]
}

function signDiskImage(diskImagePath) {
  run("/usr/bin/codesign", [
    "--force",
    "--timestamp",
    "--sign",
    developerIdIdentityHash(),
    diskImagePath,
  ])
  requireDeveloperIdSignature(diskImagePath)
}

async function notarizeAndStaple(artifactPath) {
  const credentials = notarizationCredentials()
  if (!credentials) {
    throw new Error(
      "Apple notarization credentials are required for a public macOS release. " +
        "Set APPLE_KEYCHAIN_PROFILE, Apple ID credentials, or an App Store " +
        "Connect API key.",
    )
  }

  await notarize({
    tool: "notarytool",
    appPath: artifactPath,
    ...credentials,
  })

  run("/usr/bin/xcrun", ["stapler", "staple", artifactPath])
  run("/usr/bin/xcrun", ["stapler", "validate", artifactPath])
}

module.exports = {
  signDiskImage,
  notarizeAndStaple,
  requireDeveloperIdSignature,
}
