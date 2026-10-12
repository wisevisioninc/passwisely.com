import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function unusedAddress() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = `127.0.0.1:${probe.address().port}`;
  await new Promise((resolve) => probe.close(resolve));
  return address;
}

function check(address, t) {
  const child = spawn(process.execPath, ["desktop-api/healthcheck.mjs"], {
    cwd: repoRoot,
    env: { ...process.env, PASSWISELY_GRPC_HEALTH_URL: address, PASSWISELY_GRPC_HEALTH_TLS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("startup health check waits for a delayed gRPC listener", { timeout: 10_000 }, async (t) => {
  const address = await unusedAddress();
  const result = check(address, t);
  await delay(1_000);
  const server = spawn(process.execPath, ["desktop-api/server.mjs"], {
    cwd: repoRoot,
    env: { ...process.env, PASSWISELY_GRPC_LISTEN: address, PASSWISELY_HEALTH_LISTEN: "127.0.0.1:0" },
    stdio: "ignore",
  });
  t.after(() => server.kill());
  const response = await result;
  assert.equal(response.code, 0, response.stderr);
  assert.match(response.stdout, /SERVING grpc\+protobuf/);
});

test("startup health check still fails within its deadline when no service starts", { timeout: 10_000 }, async (t) => {
  const address = await unusedAddress();
  const started = Date.now();
  const response = await check(address, t);
  assert.equal(response.code, 1);
  assert.match(response.stderr, /deadline/i);
  assert.ok(Date.now() - started < 8_000, "health check exceeded its bounded startup wait");
});
