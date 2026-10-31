export interface ServiceEndpointEnvironment {
  readonly [name: string]: string | undefined;
  PASSWISELY_API_URL?: string;
  PASSWISELY_GRPC_URL?: string;
  PASSWISELY_GRPC_INSECURE?: string;
}

export interface ServiceEndpoints {
  apiBase: string;
  aiBase: string;
  accountUrl: string;
  grpcAddress: string;
  grpcInsecure: boolean;
}

const DEFAULT_SERVICE_ORIGIN = "https://passwisely.cn";

/** Own desktop service routing once, before account and AI consumers use it.
 * API overrides are complete API bases, including any caller-selected prefix.
 * gRPC remains independently configurable; an HTTP override never changes its
 * address or transport security implicitly.
 */
export function getServiceEndpoints(
  environment: ServiceEndpointEnvironment = process.env,
): ServiceEndpoints {
  const apiBase = environment.PASSWISELY_API_URL?.replace(/\/+$/, "") ||
    `${DEFAULT_SERVICE_ORIGIN}/api`;
  return {
    apiBase,
    aiBase: `${apiBase}/ai`,
    accountUrl: apiBase.replace(/\/api$/, "/#account"),
    grpcAddress: environment.PASSWISELY_GRPC_URL?.trim() ||
      `${new URL(DEFAULT_SERVICE_ORIGIN).hostname}:443`,
    grpcInsecure: environment.PASSWISELY_GRPC_INSECURE === "1",
  };
}

/** Public region used only for permission preparation; recording always uses the
 * broker-returned region. This deployment uses the user's Japan Recall project. */
export function getRecallPermissionApiUrl(environment: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const selected = environment.PASSWISELY_RECALL_API_URL || "https://ap-northeast-1.recall.ai";
  return ["https://us-west-2.recall.ai", "https://us-east-1.recall.ai", "https://eu-central-1.recall.ai", "https://ap-northeast-1.recall.ai"].includes(selected) ? selected : undefined;
}
