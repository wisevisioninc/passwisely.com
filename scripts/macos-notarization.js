const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { notarize } = require("@electron/notarize")
const { collectCodePaths } = require("./after-pack-macos")

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
  const isApp = path.extname(appPath).toLowerCase() === ".app"
  // A valid outer resource seal does not establish that Resources SDK libraries
  // satisfy hardened-runtime library validation. Verify their actual signatures.
  const plan = isApp ? collectCodePaths(appPath) : null
  const targets = plan ? [...new Set([...plan.leaves.map(leaf => leaf.path), ...plan.bundles])] : [appPath]
  for (const target of targets) {
    const details = run("/usr/bin/codesign", ["-dv", "--verbose=4", target], { capture: true })
    if (!/^Authority=Developer ID Application:/m.test(details)) {
      throw new Error(`${target} is not signed with a Developer ID Application certificate.`)
    }
    if (!details.split(/\r?\n/).includes(`TeamIdentifier=${EXPECTED_TEAM_ID}`)) {
      throw new Error(`${target} is not signed by the expected Apple team ${EXPECTED_TEAM_ID}.`)
    }
    if (!/^Timestamp=.+/m.test(details)) {
      throw new Error(`${target} is missing a trusted signing timestamp required for public release.`)
    }
    if (isApp && !/^CodeDirectory\s.*\bruntime\b/m.test(details)) {
      throw new Error(`${target} is missing the hardened runtime signature required for public release.`)
    }
    run("/usr/bin/codesign", ["--verify", "--strict", target])
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
