import assert from "node:assert/strict";
import test from "node:test";

import { hostSnapshot, startHostHealthServer } from "../host-health.mjs";

test("host health reports bounded resource measurements", async () => {
  const snapshot = await hostSnapshot();
  assert.ok(snapshot.uptimeSeconds >= 0);
  assert.ok(snapshot.cpuCount >= 1);
  assert.ok(snapshot.memoryUsedPercent >= 0 && snapshot.memoryUsedPercent <= 100);
  assert.ok(snapshot.diskUsedPercent >= 0 && snapshot.diskUsedPercent <= 100);
  assert.ok(snapshot.processRssBytes > 0);
});

test("host health endpoint is local JSON and rejects unknown routes", async () => {
  const server = startHostHealthServer("127.0.0.1:0");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("cache-control"), "no-store");
    assert.ok(Number.isFinite((await health.json()).loadAverage1m));
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/other`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
