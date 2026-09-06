import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("desktop defaults to the included Kimi channel when OpenAI has no key", async () => {
  const [settings, processing, ui] = await Promise.all([
    read("../../electron/settings.ts"),
    read("../../electron/ProcessingHelper.ts"),
    read("../../src/components/shared/AISettings.tsx"),
  ]);
  assert.match(settings, /return "kimi";/);
  assert.match(
    settings,
    /storedProvider === "openai" && !this\.getApiKey\("openai"\)/,
  );
  assert.match(
    processing,
    /ChatGPT requires a personal OpenAI API key with available credit/,
  );
  assert.match(ui, /activeProvider\.usesWiseDefaultKey/);
  assert.match(ui, /Wise 不提供共享 Key/);
});

test("Kimi K3 relay disables slow reasoning with the required temperature", async () => {
  const route = await read("../app/api/ai/chat/completions/route.ts");
  assert.match(route, /provider === "kimi" && model === "kimi-k3"/);
  assert.match(route, /temperature: 0\.6/);
  assert.match(route, /thinking: \{ type: "disabled" \}/);
  assert.match(route, /JSON\.stringify\([\s\S]*upstreamBody/);
});

test("Kimi screenshot billing ignores base64 transport bytes", async () => {
  const route = await read("../app/api/ai/chat/completions/route.ts");
  assert.match(route, /imageCount \+= 1/);
  assert.match(route, /textBytes \+ imageCount \* 4096/);
  assert.doesNotMatch(route, /JSON\.stringify\(body\.messages/);
});
