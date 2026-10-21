import { env } from "cloudflare:workers";
import { AI_PROVIDER_CATALOG } from "@/lib/ai-catalog";
import { getDefaultAiConfig } from "@/lib/ai-config";
import { getPublicSiteOrigin } from "./public-site";

export type HealthState = "healthy" | "degraded" | "down";

export interface ServiceHealth {
  id: string;
  name: string;
  group: "runtime" | "storage" | "delivery" | "configuration";
  state: HealthState;
  detail: string;
  latencyMs?: number;
}

export interface HostHealth {
  uptimeSeconds: number;
  processUptimeSeconds: number;
  loadAverage1m: number;
  cpuCount: number;
  memoryUsedPercent: number;
  diskUsedPercent: number;
  processRssBytes: number;
}

type Environment = Record<string, string | undefined>;

function environment(): Environment {
  return env as unknown as Environment;
}

function configured(values: Environment, names: string[]): boolean {
  return names.every((name) => Boolean(values[name]?.trim()));
}

function configuredOneOf(values: Environment, names: string[]): boolean {
  return names.some((name) => Boolean(values[name]?.trim()));
}

async function timedFetch(
  id: string,
  name: string,
  group: ServiceHealth["group"],
  url: string,
  options: RequestInit = {},
): Promise<ServiceHealth> {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      redirect: "follow",
      ...options,
      signal: AbortSignal.timeout(8_000),
    });
    const latencyMs = Date.now() - startedAt;
    return {
      id,
      name,
      group,
      state: response.ok ? "healthy" : "down",
      detail: response.ok ? `HTTP ${response.status}` : `HTTP ${response.status}`,
      latencyMs,
    };
  } catch (error) {
    return {
      id,
      name,
      group,
      state: "down",
      detail: error instanceof Error ? error.message.slice(0, 90) : "连接失败",
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function hostHealth(): Promise<{ service: ServiceHealth; host: HostHealth | null }> {
  const startedAt = Date.now();
  try {
    const response = await fetch("http://127.0.0.1:3013/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const host = (await response.json()) as HostHealth;
    return {
      service: {
        id: "desktop-api",
        name: "桌面 gRPC 服务",
        group: "runtime",
        state: "healthy",
        detail: "SERVING · gRPC + Protobuf",
        latencyMs: Date.now() - startedAt,
      },
      host,
    };
  } catch (error) {
    return {
      service: {
        id: "desktop-api",
        name: "桌面 gRPC 服务",
        group: "runtime",
        state: "down",
        detail: error instanceof Error ? error.message.slice(0, 90) : "连接失败",
        latencyMs: Date.now() - startedAt,
      },
      host: null,
    };
  }
}

async function publicSiteHealth(): Promise<ServiceHealth[]> {
  const checks: Array<[string, string, ServiceHealth["group"], string]> = [
    ["website", "官方网站", "runtime", "/"],
    ["mac-arm64", "macOS Apple 芯片安装包", "delivery", "/api/download/mac-arm64"],
    ["mac-x64", "macOS Intel 安装包", "delivery", "/api/download/mac-x64"],
    ["windows-x64", "Windows x64 安装包", "delivery", "/api/download/windows-x64"],
  ];
  let origin: string;
  try {
    origin = getPublicSiteOrigin();
  } catch {
    return checks.map(([id, name, group]) => ({
      id, name, group, state: "degraded", detail: "PUBLIC_SITE_URL 配置无效",
    }));
  }
  return Promise.all(checks.map(([id, name, group, path]) =>
    timedFetch(id, name, group, `${origin}${path}`)));
}

export async function getAdminHealth(databaseLatencyMs: number): Promise<{
  services: ServiceHealth[];
  host: HostHealth | null;
}> {
  const values = environment();
  const [siteServices, runtime, defaultAi] = await Promise.all([
    publicSiteHealth(),
    hostHealth(),
    getDefaultAiConfig().catch(() => null),
  ]);

  const alipayReady = configured(values, ["ALIPAY_APP_ID", "ALIPAY_SELLER_ID", "ALIPAY_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY"]);
  const wechatReady =
    configuredOneOf(values, ["WECHAT_PAY_APP_ID", "WECHAT_APP_ID"]) &&
    configuredOneOf(values, ["WECHAT_PAY_MCH_ID", "WECHAT_MCH_ID"]) &&
    configuredOneOf(values, ["WECHAT_PAY_MCH_SERIAL_NO", "WECHAT_MCH_SERIAL_NO"]) &&
    configuredOneOf(values, ["WECHAT_PAY_PRIVATE_KEY", "WECHAT_MERCHANT_PRIVATE_KEY"]) &&
    configuredOneOf(values, ["WECHAT_PAY_API_V3_KEY", "WECHAT_APIV3_KEY"]) &&
    configuredOneOf(values, ["WECHAT_PAY_PUBLIC_KEY_ID", "WECHAT_PUB_KEY_ID"]) &&
    configuredOneOf(values, ["WECHAT_PAY_PUBLIC_KEY", "WECHAT_PUB_KEY"]);

  return {
    host: runtime.host,
    services: [
      {
        id: "supabase",
        name: "Supabase 数据库",
        group: "storage",
        state: "healthy",
        detail: "统计 RPC 正常",
        latencyMs: databaseLatencyMs,
      },
      siteServices[0],
      runtime.service,
      ...siteServices.slice(1),
      {
        id: "ai-relay",
        name: "AI 模型中继",
        group: "configuration",
        state: defaultAi?.apiKey ? "healthy" : "down",
        detail: defaultAi
          ? `${AI_PROVIDER_CATALOG[defaultAi.provider].label} · ${defaultAi.model} · ${defaultAi.source === "supabase" ? "Supabase 配置" : "环境回退"}`
          : "默认模型配置不可用",
      },
      {
        id: "alipay",
        name: "支付宝",
        group: "configuration",
        state: alipayReady ? "healthy" : "degraded",
        detail: alipayReady ? "生产配置完整" : "配置不完整",
      },
      {
        id: "wechat-pay",
        name: "微信支付",
        group: "configuration",
        state: wechatReady ? "healthy" : "degraded",
        detail: wechatReady ? "API v3 配置完整" : "配置不完整",
      },
    ],
  };
}
