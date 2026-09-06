import assert from "node:assert/strict";
import test from "node:test";

import { configFromEnvironment, probeArtifact } from "../scripts/download-performance-probe.mjs";

test("download probe uses HEAD plus a bounded range sample", async () => {
  const requests = [];
  const sampleBytes = new Uint8Array(1024);
  const result = await probeArtifact(
    "mac-arm64",
    "PassWisely.dmg",
    { releaseBase: "https://downloads.example.test" },
    async (url, init) => {
      requests.push({ url, init });
      if (init.method === "HEAD") return new Response(null, { status: 200, headers: { "content-length": "10485760" } });
      return new Response(sampleBytes, { status: 206, headers: { "content-range": "bytes 0-1023/10485760" } });
    },
  );
  assert.equal(result.status, "healthy");
  assert.equal(result.object_bytes, 10_485_760);
  assert.equal(result.sample_bytes, 1024);
  assert.equal(requests.length, 2);
  assert.match(requests[1].init.headers.range, /^bytes=0-/);
});

test("download probe requires Supabase server credentials", () => {
  assert.throws(() => configFromEnvironment({}), /not configured/);
});
