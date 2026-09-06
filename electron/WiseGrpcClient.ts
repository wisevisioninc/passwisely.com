import path from "node:path";
import { app } from "electron";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { OpenAI } from "openai";

type GrpcClient = grpc.Client & {
  Chat: (
    request: Record<string, unknown>,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: (error: grpc.ServiceError | null, response: any) => void,
  ) => grpc.ClientUnaryCall;
};

type DesktopPackage = {
  passwisely: {
    desktop: {
      v1: {
        DesktopAI: new (
          address: string,
          credentials: grpc.ChannelCredentials,
          options?: Record<string, unknown>,
        ) => GrpcClient;
      };
    };
  };
};

export class WiseGrpcError extends Error {
  public readonly code: grpc.status;
  public readonly httpStatus?: number;

  constructor(message: string, code: grpc.status, httpStatus?: number) {
    super(message);
    this.name = "WiseGrpcError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function contentParts(
  content: OpenAI.Chat.ChatCompletionMessageParam["content"],
): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) return [];
  const result: Array<Record<string, unknown>> = [];
  for (const part of content as any[]) {
    if (part?.type === "text" && typeof part.text === "string") {
      result.push({ text: part.text });
      continue;
    }
    const url = part?.type === "image_url" ? part.image_url?.url : undefined;
    const match =
      typeof url === "string" ? /^data:([^;]+);base64,(.+)$/s.exec(url) : null;
    if (!match) continue;
    result.push({
      image: {
        data: Buffer.from(match[2], "base64"),
        mimeType: match[1],
        detail: part.image_url?.detail || "auto",
      },
    });
  }
  return result;
}

export class WiseGrpcClient {
  private readonly client: GrpcClient;

  constructor() {
    const protoPath = path.join(app.getAppPath(), "proto", "desktop_ai.proto");
    const definition = protoLoader.loadSync(protoPath, {
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const loaded = grpc.loadPackageDefinition(
      definition,
    ) as unknown as DesktopPackage;
    const address =
      process.env.PASSWISELY_GRPC_URL?.trim() || "passwisely.com:443";
    const insecure = process.env.PASSWISELY_GRPC_INSECURE === "1";
    this.client = new loaded.passwisely.desktop.v1.DesktopAI(
      address,
      insecure ? grpc.credentials.createInsecure() : grpc.credentials.createSsl(),
      {
        "grpc.max_send_message_length": 16 * 1024 * 1024,
        "grpc.max_receive_message_length": 16 * 1024 * 1024,
        "grpc.keepalive_time_ms": 30_000,
        "grpc.keepalive_timeout_ms": 10_000,
        "grpc.keepalive_permit_without_calls": 1,
      },
    );
  }

  public close(): void {
    this.client.close();
  }

  public static isUnavailable(error: unknown): boolean {
    return (
      error instanceof WiseGrpcError &&
      !error.httpStatus &&
      [grpc.status.UNAVAILABLE, grpc.status.UNIMPLEMENTED].includes(error.code)
    );
  }

  public async chat(
    body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    options: {
      signal: AbortSignal;
      token: string;
      provider: string;
      providerApiKey?: string;
      requestId: string;
    },
  ): Promise<OpenAI.Chat.ChatCompletion> {
    const metadata = new grpc.Metadata();
    metadata.set("authorization", `Bearer ${options.token || "signed-out"}`);
    metadata.set("x-wise-client-version", app.getVersion());

    const request = {
      requestId: options.requestId,
      provider: options.provider,
      model: body.model,
      providerApiKey: options.providerApiKey || "",
      messages: body.messages.map((message) => ({
        role: message.role,
        parts: contentParts(message.content),
      })),
      maxTokens: body.max_tokens || 4096,
      temperature: body.temperature || 0,
      jsonMode: body.response_format?.type === "json_object",
    };

    return new Promise((resolve, reject) => {
      const call = this.client.Chat(
        request,
        metadata,
        { deadline: Date.now() + 90_000 },
        (error, response) => {
          options.signal.removeEventListener("abort", abort);
          if (error) {
            const statusValue = error.metadata?.get("x-http-status")?.[0];
            const httpStatus = Number(statusValue) || undefined;
            reject(new WiseGrpcError(error.details || error.message, error.code, httpStatus));
            return;
          }
          resolve({
            id: response.id || options.requestId,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: response.model || body.model,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: response.content || "",
                  refusal: null,
                },
                logprobs: null,
                finish_reason: response.finishReason || "stop",
              },
            ],
            usage: {
              prompt_tokens: Number(response.promptTokens) || 0,
              completion_tokens: Number(response.completionTokens) || 0,
              total_tokens: Number(response.totalTokens) || 0,
            },
          } as OpenAI.Chat.ChatCompletion);
        },
      );

      const abort = () => {
        call.cancel();
        const error = new Error("Processing was canceled by the user.");
        error.name = "AbortError";
        reject(error);
      };
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
    });
  }
}
