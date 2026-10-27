import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { KIMI_DEFAULT_MODEL, KIMI_MODEL_IDS } from "./helpers/kimi-model.mjs";
import { loadProduction } from "../../test/leetcode/scripts/production-loader.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("desktop and server choose Kimi K3.1 Pro while keeping the explicit legacy model", async () => {
  const { AI_PROVIDERS } = loadProduction(root);
  const desktop = AI_PROVIDERS.find(provider => provider.id === "kimi");
  assert.equal(KIMI_DEFAULT_MODEL, "kimi-k3.1-pro");
  assert.equal(desktop.defaultModel, KIMI_DEFAULT_MODEL);
  assert.equal(desktop.models[0].id, KIMI_DEFAULT_MODEL);
  for (const model of KIMI_MODEL_IDS) assert.ok(desktop.models.some(preset => preset.id === model));
  assert.equal(desktop.defaultKeyViaWise, true);

  const source = await readFile(new URL("../lib/ai-catalog.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(id => {
    assert.equal(id, "../../shared/kimi");
    return { KIMI_DEFAULT_MODEL, KIMI_MODEL_IDS };
  }, module, module.exports);
  const server = module.exports.AI_PROVIDER_CATALOG.kimi;
  assert.equal(server.defaultModel, KIMI_DEFAULT_MODEL);
  assert.ok(server.models.includes(KIMI_DEFAULT_MODEL));
  assert.ok(server.models.includes("kimi-k3"));
  assert.ok(server.models.includes("kimi-k2.5"));
});

test("deployment examples select a consistent Kimi provider, model and endpoint", async () => {
  const desktop = await readFile(new URL("../../.env.example", import.meta.url), "utf8");
  assert.match(desktop, /^AI_PROVIDER=kimi$/m);
  assert.ok(desktop.split(/\r?\n/).includes(`AI_MODEL=${KIMI_DEFAULT_MODEL}`));
  assert.match(desktop, /^AI_BASE_URL=https:\/\/api\.moonshot\.cn\/v1$/m);
  const server = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(server, /^AI_DEFAULT_PROVIDER=kimi$/m);
  assert.ok(server.split(/\r?\n/).includes(`AI_DEFAULT_MODEL=${KIMI_DEFAULT_MODEL}`));
});
