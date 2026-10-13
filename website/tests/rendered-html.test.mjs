import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("builds a bilingual PassWisely landing page", async () => {
  await access(new URL("../dist/server/index.js", import.meta.url));
  const source = [
    await readFile(
      new URL("../app/PassWiselySite.tsx", import.meta.url),
      "utf8",
    ),
    await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    await readFile(new URL("../app/LandingPage.tsx", import.meta.url), "utf8"),
  ].join("\n");
  assert.match(source, /PassWisely/);
  assert.match(source, /AI Interview Copilot/);
  assert.match(source, /Get for Mac/);
  assert.match(source, /下载 Windows/);
  assert.match(source, /购买积分/);
  assert.match(source, /Buy credits/);
  assert.doesNotMatch(source, /codex-preview|react-loading-skeleton/);
});
