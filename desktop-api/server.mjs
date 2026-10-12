import path from "node:path";
import { readSSE } from "../shared/sse.mjs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { startHostHealthServer } from "./host-health.mjs";

const require = createRequire(import.meta.url);
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const protoPath = path.resolve(currentDir, "../proto/desktop_ai.proto");
const relayUrl =
  process.env.PASSWISELY_RELAY_URL ||
  "http://127.0.0.1:3011/api/ai/chat/completions";
const listenAddress = process.env.PASSWISELY_GRPC_LISTEN || "127.0.0.1:3012";
const healthListenAddress =
  process.env.PASSWISELY_HEALTH_LISTEN || "127.0.0.1:3013";

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

function relayRequest(call) {
  const authorization = metadataString(call.metadata, "authorization");
  if (!authorization) {
    throw serviceError(401, "Authentication required.");
  }

  const request = call.request || {};
  if (!request.requestId || !request.provider || !request.model) {
    throw serviceError(400, "Missing request metadata.");
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

  return { body, headers };
}

async function chat(call, callback) {
  let body, headers;
  try { ({ body, headers } = relayRequest(call)); }
  catch (error) { callback(error); return; }
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
    id: payload.id || call.request.requestId,
    model: payload.model || call.request.model,
    content: choice.message?.content || "",
    finishReason: choice.finish_reason || "stop",
    promptTokens: Number(payload.usage?.prompt_tokens) || 0,
    completionTokens: Number(payload.usage?.completion_tokens) || 0,
    totalTokens: Number(payload.usage?.total_tokens) || 0,
  });
}

async function chatStream(call) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("模型请求超时。")), 90_000);
  const cancel = () => controller.abort(new Error("请求已取消。"));
  call.once("cancelled", cancel);
  const write = async (chunk) => {
    controller.signal.throwIfAborted();
    if (call.write(chunk)) return;
    await new Promise((resolve, reject) => {
      const clean = () => { call.off("drain", drain); controller.signal.removeEventListener("abort", stop); };
      const drain = () => { clean(); resolve(); };
      const stop = () => { clean(); reject(controller.signal.reason); };
      call.once("drain", drain); controller.signal.addEventListener("abort", stop, { once: true });
      if (controller.signal.aborted) stop();
    });
  };
  try {
    const { body, headers } = relayRequest(call);
    body.stream = true;
    const response = await fetch(relayUrl, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw serviceError(response.status, typeof payload.error === "string" ? payload.error : "模型请求失败。");
    }
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      throw serviceError(502, "服务器尚未启用流式响应。");
    }
    let finished = false, done = false;
    for await (const event of readSSE(response.body, controller.signal)) {
      if (event.data === "[DONE]") { done = true; break; }
      const payload = JSON.parse(event.data);
      if (payload.error || event.event === "error") throw serviceError(502, payload.error?.message || "模型数据流中断。");
      const choice = payload.choices?.[0];
      if (choice?.finish_reason) finished = true;
      await write({ id: payload.id || call.request.requestId, model: payload.model || call.request.model,
        delta: choice?.delta?.content || "", finishReason: choice?.finish_reason || "",
        promptTokens: payload.usage?.prompt_tokens || 0, completionTokens: payload.usage?.completion_tokens || 0, totalTokens: payload.usage?.total_tokens || 0 });
    }
    if (!done || !finished) throw serviceError(502, "模型数据流提前结束，请重试。未完成的代码不可直接使用。");
    await write({ done: true });
    call.end();
  } catch (error) {
    if (!call.cancelled) call.emit("error", error.code !== undefined ? error : serviceError(controller.signal.aborted ? 504 : 502, error.message));
  } finally {
    clearTimeout(timer); call.off("cancelled", cancel);
  }
}

function health(_call, callback) {
  callback(null, { status: "SERVING", transport: "grpc+protobuf" });
}

const server = new grpc.Server({
  "grpc.max_receive_message_length": 16 * 1024 * 1024,
  "grpc.max_send_message_length": 16 * 1024 * 1024,
});
server.addService(service, { Chat: chat, ChatStream: chatStream, Health: health });
let hostHealthServer;

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
    hostHealthServer = startHostHealthServer(healthListenAddress);
  },
);

function shutdown() {
  hostHealthServer?.close();
  server.tryShutdown(() => process.exit(0));
  setTimeout(() => server.forceShutdown(), 5_000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
