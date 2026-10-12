import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function waitForReady(process) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("gRPC server did not start.")),
      8_000,
    );
    process.stdout.on("data", (chunk) => {
      if (String(chunk).includes("desktop gRPC API listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    process.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`gRPC server exited early with code ${code}.`));
    });
  });
}

test("transports screenshot bytes and preserves relay metadata", async (t) => {
  const imageBytes = Buffer.alloc(900_000, 7);
  let relayRequest;
  const relay = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    relayRequest = {
      authorization: request.headers.authorization,
      provider: request.headers["x-wise-provider"],
      requestId: request.headers["x-wise-request-id"],
      transport: request.headers["x-wise-transport"],
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "chat-test",
        model: "gpt-4o-mini",
        choices: [
          {
            message: { role: "assistant", content: "binary transport ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      }),
    );
  });
  const relayPort = await listen(relay);
  t.after(() => relay.close());

  const portProbe = createServer();
  const grpcPort = await listen(portProbe);
  await new Promise((resolve) => portProbe.close(resolve));
  const child = spawn(process.execPath, ["desktop-api/server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PASSWISELY_GRPC_LISTEN: `127.0.0.1:${grpcPort}`,
      PASSWISELY_HEALTH_LISTEN: "127.0.0.1:0",
      PASSWISELY_RELAY_URL: `http://127.0.0.1:${relayPort}/api/ai/chat/completions`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));
  await waitForReady(child);

  const definition = protoLoader.loadSync(
    path.join(repoRoot, "proto/desktop_ai.proto"),
    { defaults: true, oneofs: true },
  );
  const loaded = grpc.loadPackageDefinition(definition);
  const Client = loaded.passwisely.desktop.v1.DesktopAI;
  const client = new Client(
    `127.0.0.1:${grpcPort}`,
    grpc.credentials.createInsecure(),
  );
  t.after(() => client.close());
  const metadata = new grpc.Metadata();
  metadata.set("authorization", "Bearer desktop-test-token");

  const result = await new Promise((resolve, reject) => {
    client.Chat(
      {
        requestId: "transport_test_1234567890",
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            parts: [
              { text: "read this screenshot" },
              {
                image: {
                  data: imageBytes,
                  mimeType: "image/jpeg",
                  detail: "high",
                },
              },
            ],
          },
        ],
        maxTokens: 200,
      },
      metadata,
      (error, response) => (error ? reject(error) : resolve(response)),
    );
  });

  assert.equal(result.content, "binary transport ok");
  assert.equal(relayRequest.authorization, "Bearer desktop-test-token");
  assert.equal(relayRequest.provider, "openai");
  assert.equal(relayRequest.requestId, "transport_test_1234567890");
  assert.equal(relayRequest.transport, "grpc");
  const dataUrl = relayRequest.body.messages[0].content[1].image_url.url;
  assert.equal(Buffer.from(dataUrl.split(",")[1], "base64").length, imageBytes.length);
});

test("gRPC streams before upstream EOF, propagates errors and cancellation", { timeout: 12000 }, async t => {
  let pending, cancelled, seen;
  const relay = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    seen = { body, headers: request.headers };
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('data: {"model":"actual","choices":[{"delta":{"content":"首段"}}]}\n\n');
    if (body.messages[0].content === "truncated") response.end();
    else {
      pending = response;
      response.once("close", () => cancelled?.());
    }
  });
  const relayPort = await listen(relay);
  t.after(() => { relay.closeAllConnections(); relay.close(); });
  const probe = createServer(); const port = await listen(probe); await new Promise(r => probe.close(r));
  const child = spawn(process.execPath, ["desktop-api/server.mjs"], { cwd: repoRoot,
    env: { ...process.env, PASSWISELY_GRPC_LISTEN: `127.0.0.1:${port}`, PASSWISELY_HEALTH_LISTEN: "127.0.0.1:0", PASSWISELY_RELAY_URL: `http://127.0.0.1:${relayPort}` }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill("SIGTERM")); await waitForReady(child);
  const definition = protoLoader.loadSync(path.join(repoRoot, "proto/desktop_ai.proto"), { defaults: true, oneofs: true });
  const Client = grpc.loadPackageDefinition(definition).passwisely.desktop.v1.DesktopAI;
  const client = new Client(`127.0.0.1:${port}`, grpc.credentials.createInsecure()); t.after(() => client.close());
  const metadata = new grpc.Metadata(); metadata.set("authorization", "Bearer fixture");
  const start = text => client.ChatStream({ requestId: "stream_fixture_123456", provider: "qwen", model: "qwen3.8-flash", providerApiKey: "fixture-personal-key", messages: [{ role: "user", parts: [{ text }] }] }, metadata, { deadline: Date.now() + 4000 });
  const call = start("complete");
  const all = []; call.on("data", chunk => all.push(chunk));
  const complete = new Promise((resolve, reject) => { call.on("end", resolve); call.on("error", reject); });
  await new Promise(resolve => call.once("data", resolve));
  assert.equal(all[0].delta, "首段");
  assert.equal(seen.body.stream, true);
  assert.equal(seen.headers["x-wise-provider-key"], "fixture-personal-key");
  assert.equal(seen.headers.authorization, "Bearer fixture");
  assert.equal(pending.writableEnded, false);
  pending.end('data: {"choices":[{"delta":{"content":"完成"},"finish_reason":"stop"}],"usage":{"total_tokens":9}}\n\ndata: [DONE]\n\n');
  await complete;
  assert.equal(all.at(-1).done, true);
  assert.equal(all.map(c => c.delta).join(""), "首段完成");
  const broken = start("truncated");
  const received = []; broken.on("data", c => received.push(c));
  const error = await new Promise(r => broken.once("error", r));
  assert.equal(error.code, grpc.status.UNAVAILABLE);
  assert.ok(!received.some(c => c.done));
  const abort = start("cancel"); abort.on("error", () => {});
  await new Promise(r => abort.once("data", r));
  const closed = new Promise(r => { cancelled = r; }); abort.cancel(); await closed;
});
