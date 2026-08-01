import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const protoPath = path.resolve(currentDir, "../proto/desktop_ai.proto");
const relayUrl =
  process.env.PASSWISELY_RELAY_URL ||
  "http://127.0.0.1:3011/api/ai/chat/completions";
const listenAddress = process.env.PASSWISELY_GRPC_LISTEN || "127.0.0.1:3012";

const definition = protoLoader.loadSync(protoPath, {
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const loaded = grpc.loadPackageDefinition(definition);
const service = loaded.passwisely.desktop.v1.DesktopAI.service;

function metadataString(metadata, key) {
  const value = metadata.get(key)[0];
  return typeof value === "string" ? value : "";
}

function grpcCode(httpStatus) {
  if (httpStatus === 400) return grpc.status.INVALID_ARGUMENT;
  if (httpStatus === 401 || httpStatus === 403) return grpc.status.UNAUTHENTICATED;
  if (httpStatus === 402 || httpStatus === 413 || httpStatus === 429) {
    return grpc.status.RESOURCE_EXHAUSTED;
  }
  if (httpStatus === 504) return grpc.status.DEADLINE_EXCEEDED;
  if (httpStatus >= 500) return grpc.status.UNAVAILABLE;
  return grpc.status.UNKNOWN;
}

function serviceError(httpStatus, message) {
  const metadata = new grpc.Metadata();
  metadata.set("x-http-status", String(httpStatus));
  const error = new Error(message || "Desktop AI request failed.");
  error.code = grpcCode(httpStatus);
  error.details = error.message;
  error.metadata = metadata;
  return error;
}

function toOpenAIMessage(message) {
  const parts = (message.parts || []).map((part) => {
    if (typeof part.text === "string" && part.value === "text") {
      return { type: "text", text: part.text };
    }
    if (part.image?.data?.length) {
      return {
        type: "image_url",
        image_url: {
          url: `data:${part.image.mimeType || "image/jpeg"};base64,${Buffer.from(
            part.image.data,
          ).toString("base64")}`,
          detail: part.image.detail || "auto",
        },
      };
    }
    return null;
  }).filter(Boolean);

  return {
    role: message.role,
    content:
      parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts,
  };
}

async function chat(call, callback) {
  const authorization = metadataString(call.metadata, "authorization");
  if (!authorization) {
    callback(serviceError(401, "Authentication required."));
    return;
  }

  const request = call.request || {};
  if (!request.requestId || !request.provider || !request.model) {
    callback(serviceError(400, "Missing request metadata."));
    return;
  }

  const body = {
    model: request.model,
    messages: (request.messages || []).map(toOpenAIMessage),
    max_tokens: Number(request.maxTokens) || 4096,
    temperature: Number(request.temperature) || 0,
    ...(request.jsonMode ? { response_format: { type: "json_object" } } : {}),
  };

  const headers = new Headers({
    authorization,
    "content-type": "application/json",
    "x-wise-provider": request.provider,
    "x-wise-request-id": request.requestId,
    "x-wise-transport": "grpc",
  });
  if (request.providerApiKey) {
    headers.set("x-wise-provider-key", request.providerApiKey);
  }

  const upstream = await fetch(relayUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  }).catch(() => null);
  if (!upstream) {
    callback(serviceError(502, "AI relay is unavailable."));
    return;
  }

  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    callback(
      serviceError(
        upstream.status,
        typeof payload.error === "string"
          ? payload.error
          : "Model provider request failed.",
      ),
    );
    return;
  }

  const choice = payload.choices?.[0] || {};
  callback(null, {
    id: payload.id || request.requestId,
    model: payload.model || request.model,
    content: choice.message?.content || "",
    finishReason: choice.finish_reason || "stop",
    promptTokens: Number(payload.usage?.prompt_tokens) || 0,
    completionTokens: Number(payload.usage?.completion_tokens) || 0,
    totalTokens: Number(payload.usage?.total_tokens) || 0,
  });
}

function health(_call, callback) {
  callback(null, { status: "SERVING", transport: "grpc+protobuf" });
}

const server = new grpc.Server({
  "grpc.max_receive_message_length": 16 * 1024 * 1024,
  "grpc.max_send_message_length": 16 * 1024 * 1024,
});
server.addService(service, { Chat: chat, Health: health });

server.bindAsync(
  listenAddress,
  grpc.ServerCredentials.createInsecure(),
  (error) => {
    if (error) {
      console.error("Failed to start PassWisely desktop API:", error.message);
      process.exitCode = 1;
      return;
    }
    console.log(`PassWisely desktop gRPC API listening on ${listenAddress}`);
  },
);

function shutdown() {
  server.tryShutdown(() => process.exit(0));
  setTimeout(() => server.forceShutdown(), 5_000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
