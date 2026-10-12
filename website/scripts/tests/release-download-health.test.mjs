import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const script = fileURLToPath(new URL("../release-download-health.sh", import.meta.url));
const expected = "https://example.com/releases/v1.2.6/PassWisely-macOS-arm64.dmg";

async function endpoint(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}/download`;
}

function check(url, attempts) {
  return exec("bash", ["-euo", "pipefail", "-c", 'source "$1"; wait_for_redirect "$2" "$3" "$4"', "redirect-test", script, url, expected, String(attempts)], { timeout: 10_000 });
}

test("download readiness tolerates old workers during a reload", async t => {
  let requests = 0;
  const url = await endpoint(t, (_request, response) => {
    requests++;
    response.writeHead(302, { location: requests < 3 ? expected.replace("1.2.6", "1.2.5") : expected });
    response.end();
  });
  await check(url, 3);
  assert.equal(requests, 3);
});

test("download readiness rejects a permanently incorrect installer", async t => {
  const wrong = expected.replace("arm64", "x64");
  const url = await endpoint(t, (_request, response) => {
    response.writeHead(302, { location: wrong });
    response.end();
  });
  await assert.rejects(check(url, 1), error => {
    assert.equal(error.code, 1);
    assert.ok(error.stderr.includes(expected));
    assert.ok(error.stderr.includes(wrong));
    return true;
  });
});

test("download readiness retries a transient HTTP failure under errexit", async t => {
  let requests = 0;
  const url = await endpoint(t, (_request, response) => {
    requests++;
    response.writeHead(requests === 1 ? 503 : 302, requests === 1 ? {} : { location: expected });
    response.end();
  });
  await check(url, 2);
  assert.equal(requests, 2);
});
