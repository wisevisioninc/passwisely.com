import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("admin console manages the default provider, model, and masked API key", async () => {
  const [dashboard, settingsRoute, adminData] = await Promise.all([
    read("../app/admin/AdminDashboard.tsx"),
    read("../app/api/admin/settings/route.ts"),
    read("../lib/admin-data.ts"),
  ]);
  for (const label of ["默认大模型配置", "默认模型渠道", "模型型号", "API Key"]) {
    assert.match(dashboard, new RegExp(label));
  }
  assert.match(dashboard, /type="password"/);
  assert.match(settingsRoute, /isAdminAuthenticated/);
  assert.match(adminData, /delete settings\.ai_default_api_key/);
  assert.match(adminData, /ai_api_key_/);
  assert.match(adminData, /encryptAdminSecret\(apiKey\.value\)/);
});

test("default model configuration is stored privately in Supabase", async () => {
  const [migration, secrets, config] = await Promise.all([
    read("../supabase/migrations/0008_admin_ai_configuration.sql"),
    read("../lib/admin-secrets.ts"),
    read("../lib/ai-config.ts"),
  ]);
  assert.match(migration, /'ai_default_provider', 'kimi'/);
  assert.match(migration, /'ai_default_model', 'kimi-k3'/);
  assert.doesNotMatch(migration, /sk-[a-zA-Z0-9]/);
  assert.match(secrets, /AES-GCM/);
  assert.match(secrets, /passwisely:admin-settings/);
  assert.match(config, /admin_settings\?key=like\.ai_/);
  assert.match(config, /Date\.now\(\) \+ 10_000/);
});

test("Qwen uses the DashScope OpenAI-compatible endpoint and thinking mode", async () => {
  const [catalog, chat, resume, dashboard, migration] = await Promise.all([
    read("../lib/ai-catalog.ts"),
    read("../app/api/ai/chat/completions/route.ts"),
    read("../app/api/resume/agents/route.ts"),
    read("../app/admin/AdminDashboard.tsx"),
    read("../supabase/migrations/0009_provider_scoped_ai_keys.sql"),
  ]);
  assert.match(catalog, /qwen:/);
  assert.match(catalog, /dashscope\.aliyuncs\.com\/compatible-mode\/v1\/chat\/completions/);
  assert.match(catalog, /DASHSCOPE_API_KEY/);
  assert.match(catalog, /qwen3\.8-flash/);
  assert.match(chat, /provider === "qwen"[\s\S]*enable_thinking: true[\s\S]*stream: false/);
  assert.match(resume, /config\.provider === "qwen"[\s\S]*enable_thinking: true[\s\S]*stream: false/);
  assert.match(dashboard, /ai_api_key_/);
  assert.match(dashboard, /每个模型渠道独立保存/);
  assert.match(migration, /'ai_api_key_kimi'/);
  assert.match(migration, /'ai_default_api_key'/);
});

test("shared desktop and resume requests use the admin default model", async () => {
  const [chat, resume] = await Promise.all([
    read("../app/api/ai/chat/completions/route.ts"),
    read("../app/api/resume/agents/route.ts"),
  ]);
  assert.match(chat, /await getDefaultAiConfig\(\)/);
  assert.match(chat, /effectiveBody: Json = \{ \.\.\.body, model \}/);
  assert.match(chat, /if \(suppliedKey\)/);
  assert.match(resume, /await getDefaultAiConfig\(\)/);
  assert.match(resume, /provider: generated\.provider/);
  assert.match(resume, /model: generated\.model/);
});
