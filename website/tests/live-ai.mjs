import assert from "node:assert/strict";
import { KIMI_DEFAULT_MODEL } from "./helpers/kimi-model.mjs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const apiBase = (
  process.env.PASSWISELY_TEST_API_URL || "https://passwisely.cn/api"
).replace(/\/+$/, "");
const requestedProvider = process.env.PASSWISELY_TEST_PROVIDER || "kimi";
const requestedModel = process.env.PASSWISELY_TEST_MODEL || KIMI_DEFAULT_MODEL;
const expectedProvider = process.env.PASSWISELY_TEST_EXPECT_PROVIDER || "kimi";
const expectedModel = new RegExp(
  process.env.PASSWISELY_TEST_EXPECT_MODEL || `^${requestedModel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
  "i",
);
const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const email = `ai-e2e-${suffix}@example.com`;
const password = `Pw${crypto.randomUUID()}A1`;
let userId = "";
let client;

async function api(pathname, init = {}, token = "") {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${apiBase}${pathname}`, { ...init, headers });
  return { response, payload: await response.json().catch(() => ({})) };
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
  assert.equal(
    registration.response.status,
    200,
    `registration failed: ${registration.payload.error || registration.response.status}`,
  );
  const token = registration.payload.token;
  userId = registration.payload.user?.id || "";
  assert.ok(token);
  assert.ok(userId);
  const initialCredits = registration.payload.user.credits;
  assert.ok(Number.isSafeInteger(initialCredits) && initialCredits >= 0);

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
  client = new Client("passwisely.cn:443", grpc.credentials.createSsl());
  const metadata = new grpc.Metadata();
  metadata.set("authorization", `Bearer ${token}`);

  const requestId = `ai_e2e_${crypto.randomUUID().replaceAll("-", "")}`;
  const result = await new Promise((resolve, reject) => {
    client.Chat(
      {
        requestId,
        provider: requestedProvider,
        model: requestedModel,
        messages: [
          {
            role: "user",
            parts: [{ text: "Reply with exactly OK." }],
          },
        ],
        maxTokens: 256,
        temperature: 0.2,
      },
      metadata,
      { deadline: Date.now() + 90_000 },
      (error, response) => (error ? reject(error) : resolve(response)),
    );
  });
  assert.ok(result.content?.trim(), "The default model returned an empty answer.");
  assert.match(result.model, expectedModel);

  const account = await api("/account", {}, token);
  assert.equal(account.response.status, 200);
  const debits = account.payload.transactions.filter(transaction =>
    transaction.reference === `ai:${userId}:${requestId}`,
  );
  assert.equal(debits.length, 1, "The model request must have exactly one matching debit.");
  const debit = debits[0];
  assert.equal(debit.type, `ai_${expectedProvider}`);
  assert.ok(Number.isSafeInteger(debit.amount) && debit.amount < 0);
  assert.equal(account.payload.user.credits, initialCredits + debit.amount);
  assert.equal(debit.balanceAfter, account.payload.user.credits);

  console.log(
    JSON.stringify({
      success: true,
      transport: "grpc+protobuf",
      requestedProvider,
      requestedModel,
      provider: expectedProvider,
      model: result.model,
      nonEmptyAnswer: true,
      initialCredits,
      creditsCharged: -debit.amount,
      creditsAfterRequest: account.payload.user.credits,
    }),
  );
} finally {
  client?.close();
  const cleaned = await cleanup();
  if (userId) console.log(JSON.stringify({ testUserCleaned: cleaned }));
}
