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
