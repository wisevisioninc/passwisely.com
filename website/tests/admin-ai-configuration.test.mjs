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
  for (const label of ["默认大模型配置", "默认模型渠道", "模型型号", "默认 API Key"]) {
    assert.match(dashboard, new RegExp(label));
  }
  assert.match(dashboard, /type="password"/);
  assert.match(settingsRoute, /isAdminAuthenticated/);
  assert.match(adminData, /delete settings\.ai_default_api_key/);
  assert.match(adminData, /ai_default_api_key_configured/);
  assert.match(adminData, /encryptAdminSecret\(apiKey\)/);
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
  assert.match(config, /admin_settings\?key=in\.\(ai_default_provider,ai_default_model,ai_default_api_key\)/);
  assert.match(config, /Date\.now\(\) \+ 10_000/);
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
