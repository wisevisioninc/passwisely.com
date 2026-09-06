import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const apiBase = (
  process.env.PASSWISELY_TEST_API_URL || "https://passwisely.com/api"
).replace(/\/+$/, "");
const imagePath = process.env.PASSWISELY_TEST_IMAGE;
const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const email = `vision-e2e-${suffix}@example.com`;
const password = `Pw${crypto.randomUUID()}A1`;
let userId = "";
let client;

assert.ok(imagePath, "PASSWISELY_TEST_IMAGE is required.");

async function api(pathname, init = {}, token = "") {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${apiBase}${pathname}`, { ...init, headers });
  return { response, payload: await response.json().catch(() => ({})) };
}

async function adminProfile(method, body) {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(url && key, "Supabase admin credentials are required.");
  return fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function cleanup() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!userId || !url || !key) return false;
  const response = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  return response.ok;
}

try {
  const registration = await api("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, locale: "zh", client: "desktop" }),
  });
  assert.equal(registration.response.status, 200);
  const token = registration.payload.token;
  userId = registration.payload.user?.id || "";
  assert.ok(token && userId);
  assert.equal((await adminProfile("PATCH", { credits: 500 })).status, 204);

  const image = await readFile(imagePath);
  const protoPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../proto/desktop_ai.proto",
  );
  const definition = protoLoader.loadSync(protoPath, {
    defaults: true,
    oneofs: true,
  });
  const loaded = grpc.loadPackageDefinition(definition);
  const Client = loaded.passwisely.desktop.v1.DesktopAI;
  client = new Client("passwisely.com:443", grpc.credentials.createSsl());
  const metadata = new grpc.Metadata();
  metadata.set("authorization", `Bearer ${token}`);

  const prompt = `Read the screenshot as a programming task and solve it in python.
Extract ONLY the programming problem itself into problem_statement. Keep the title when visible, the complete task description, input/output rules, constraints, and all useful examples or test cases. Exclude browser menus, tabs, URLs, site navigation, difficulty/tag/company controls, submission statistics, online-user counts, PassWisely controls, existing editor code, prior solutions, test-result UI, ads, and unrelated surrounding text.
Return exactly one JSON object with problem_statement, code, thoughts, time_complexity, and space_complexity.`;
  const startedAt = Date.now();
  const result = await new Promise((resolve, reject) => {
    client.Chat(
      {
        requestId: `vision_e2e_${crypto.randomUUID().replaceAll("-", "")}`,
        provider: "kimi",
        model: "kimi-k3",
        messages: [
          {
            role: "system",
            parts: [{ text: "Return valid JSON only. Ignore all non-problem UI text." }],
          },
          {
            role: "user",
            parts: [
              { text: prompt },
              { image: { data: image, mimeType: "image/jpeg", detail: "high" } },
            ],
          },
        ],
        maxTokens: 2200,
        temperature: 0.15,
        jsonMode: true,
      },
      metadata,
      { deadline: Date.now() + 90_000 },
      (error, response) => (error ? reject(error) : resolve(response)),
    );
  });
  const elapsedMs = Date.now() - startedAt;
  const payload = JSON.parse(result.content);
  assert.match(payload.problem_statement, /(?:两数之和|nums|target)/i);
  assert.match(
    payload.problem_statement,
    /(?:示例|example|\[2\s*,\s*7\s*,\s*11\s*,\s*15\])/i,
  );
  assert.ok(payload.code?.trim());
  assert.ok(payload.time_complexity?.trim());
  assert.doesNotMatch(
    payload.problem_statement,
    /Chrome 文件|leetcode\.cn\/problems|PassWisely|人在线|智能模式/i,
  );

  const account = await api("/account", {}, token);
  assert.equal(account.response.status, 200);
  console.log(
    JSON.stringify({
      success: true,
      transport: "grpc+protobuf",
      cleanProblem: true,
      nonEmptySolution: true,
      elapsedMs,
      creditsAfterRequest: account.payload.user.credits,
    }),
  );
} finally {
  client?.close();
  const cleaned = await cleanup();
  if (userId) console.log(JSON.stringify({ testUserCleaned: cleaned }));
}
