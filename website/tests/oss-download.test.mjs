import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("desktop downloads redirect only to the three public OSS release objects", async () => {
  const [route, nginx] = await Promise.all([
    read("../app/api/download/[platform]/route.ts"),
    read("../nginx/passwisely.conf"),
  ]);
  for (const filename of [
    "PassWisely-macOS-arm64.dmg",
    "PassWisely-macOS-x64.dmg",
    "PassWisely-Windows-x64.exe",
  ]) {
    assert.match(route, new RegExp(filename.replaceAll(".", "\\.")));
    assert.match(nginx, new RegExp(filename.replaceAll(".", "\\.")));
  }
  assert.match(route, /passwisely-releases-prod\.oss-cn-beijing\.aliyuncs\.com/);
  assert.match(route, /releases\/v1\.2\.1/);
  assert.doesNotMatch(route, /AccessKey|R2Bucket/);
  assert.doesNotMatch(nginx, /alias \/home\/jerry\/codebase\/passwisely\/release/);
});
