import { open, stat } from "node:fs/promises"
import path from "node:path"

const [platform, filePath, baseUrl = "https://passwisely.com"] =
  process.argv.slice(2)
const uploadKey = process.env.RELEASE_UPLOAD_KEY

if (!platform || !filePath || !uploadKey) {
  console.error(
    "Usage: RELEASE_UPLOAD_KEY=... node scripts/upload-release.mjs " +
      "<platform> <file> [base-url]",
  )
  process.exit(1)
}

const allowedPlatforms = new Set(["mac-arm64", "mac-x64", "windows-x64"])
if (!allowedPlatforms.has(platform)) {
  throw new Error(`Unsupported platform: ${platform}`)
}

const absolutePath = path.resolve(filePath)
const { size } = await stat(absolutePath)
const endpoint = new URL("/api/admin/upload", baseUrl)
endpoint.searchParams.set("platform", platform)
const headers = {
  "content-type": "application/json",
  "x-upload-key": uploadKey,
}

async function jsonResponse(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      `Upload request failed (${response.status}): ${JSON.stringify(payload)}`,
    )
  }
  return payload
}

const startResponse = await fetch(endpoint, {
  method: "POST",
  headers,
  body: JSON.stringify({ mode: "start" }),
})
const { uploadId } = await jsonResponse(startResponse)
if (typeof uploadId !== "string" || !uploadId) {
  throw new Error("Upload service did not return an upload ID.")
}

const partSize = 10 * 1024 * 1024
const parts = []
const file = await open(absolutePath, "r")

try {
  for (
    let offset = 0, partNumber = 1;
    offset < size;
    offset += partSize, partNumber += 1
  ) {
    const length = Math.min(partSize, size - offset)
    const buffer = Buffer.allocUnsafe(length)
    const { bytesRead } = await file.read(buffer, 0, length, offset)
    if (bytesRead !== length) {
      throw new Error(`Short read for part ${partNumber}.`)
    }

    const partUrl = new URL(endpoint)
    partUrl.searchParams.set("uploadId", uploadId)
    partUrl.searchParams.set("part", String(partNumber))
    const partResponse = await fetch(partUrl, {
      method: "PUT",
      headers: { "x-upload-key": uploadKey },
      body: buffer,
    })
    const part = await jsonResponse(partResponse)
    parts.push({ partNumber, etag: part.etag })
    console.log(`Uploaded part ${partNumber}/${Math.ceil(size / partSize)}`)
  }
} finally {
  await file.close()
}

const completeResponse = await fetch(endpoint, {
  method: "POST",
  headers,
  body: JSON.stringify({ mode: "complete", uploadId, parts }),
})
await jsonResponse(completeResponse)
console.log(`Uploaded ${platform}: ${absolutePath}`)
