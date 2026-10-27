#!/usr/bin/env node
// Execute on the credential-owning Wise host; redirect stdout to a private file.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

try {
  const [envFile, profile = "deepgram-zh"] = process.argv.slice(2);
  if (!path.isAbsolute(envFile || "") || !["deepgram-en", "deepgram-zh"].includes(profile) || process.stdout.isTTY) throw Error();
  const require = createRequire(path.resolve(path.dirname(envFile), "../package.json"));
  const { parse } = require("dotenv");
  const key = parse(readFileSync(envFile)).DEEPGRAM_API_KEY?.trim();
  if (!key) throw Error();
  const started = Date.now();
  const response = await fetch("https://api.deepgram.com/v1/auth/grant", { method: "POST", redirect: "manual",
    headers: { authorization: `Token ${key}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ ttl_seconds: 30 }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    process.stderr.write(`DEEPGRAM_GRANT_HTTP_${response.status}\n`);
    process.exit(1);
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024) { await reader.cancel(); throw Error(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const value = JSON.parse(Buffer.concat(chunks));
  const token = value.access_token;
  if (typeof token !== "string" || token.length > 8192 || token === key ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw Error();
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  const ttl = value.expires_in ?? 30;
  if (!Number.isSafeInteger(claims.exp) || typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0 || ttl > 30 || claims.exp * 1000 > started + 60_000) throw Error();
  const expiresAt = Math.min(claims.exp * 1000, started + ttl * 1000);
  if (expiresAt <= Date.now() + 5000) throw Error();
  process.stdout.write(JSON.stringify({ kind: "native-deepgram", accessToken: token, expiresAt,
    transcriptionProfile: profile, language: profile === "deepgram-zh" ? "zh" : "en", model: "nova-3", wsUrl: "wss://api.deepgram.com/v1/listen" }) + "\n");
} catch {
  // Never print exception messages, response bodies, headers or long-lived keys.
  process.stderr.write("DEEPGRAM_GRANT_FAILED\n");
  process.exitCode = 1;
}
