/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const startedAt = Date.now();
    const response = await handler.fetch(request, env, ctx);
    recordRequest(url.pathname, response.status, Date.now() - startedAt, env, ctx);
    return response;
  },
};

interface PendingMetric {
  bucket: string;
  route: string;
  requests: number;
  errors: number;
  durationMsTotal: number;
  maxDurationMs: number;
}

const pendingMetrics = new Map<string, PendingMetric>();
let lastFlushAt = 0;
let flushPromise: Promise<void> | null = null;

function routeGroup(pathname: string): string {
  if (pathname === "/") return "page:home";
  if (pathname.startsWith("/admin")) return "page:admin";
  const api = pathname.match(/^\/api\/([^/]+)(?:\/([^/]+))?/);
  if (api) return `api:${api[1]}${api[2] ? `/${api[2]}` : ""}`.slice(0, 80);
  return "page:other";
}

function recordRequest(
  pathname: string,
  status: number,
  durationMs: number,
  env: Env,
  ctx: ExecutionContext,
) {
  const bucket = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const route = routeGroup(pathname);
  const key = `${bucket}:${route}`;
  const metric = pendingMetrics.get(key) || {
    bucket,
    route,
    requests: 0,
    errors: 0,
    durationMsTotal: 0,
    maxDurationMs: 0,
  };
  metric.requests += 1;
  metric.errors += status >= 500 ? 1 : 0;
  metric.durationMsTotal += Math.max(0, durationMs);
  metric.maxDurationMs = Math.max(metric.maxDurationMs, durationMs);
  pendingMetrics.set(key, metric);

  if (Date.now() - lastFlushAt >= 10_000 && !flushPromise) {
    lastFlushAt = Date.now();
    flushPromise = flushMetrics(env).finally(() => { flushPromise = null; });
    ctx.waitUntil(flushPromise);
  }
}

async function flushMetrics(env: Env) {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || pendingMetrics.size === 0) return;
  const rows = [...pendingMetrics.values()];
  pendingMetrics.clear();
  try {
    const response = await fetch(`${url}/rest/v1/rpc/record_service_metrics`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_rows: rows }),
    });
    if (!response.ok) throw new Error(`metrics flush failed: ${response.status}`);
  } catch {
    for (const row of rows) {
      const existing = pendingMetrics.get(`${row.bucket}:${row.route}`);
      if (!existing) pendingMetrics.set(`${row.bucket}:${row.route}`, row);
      else {
        existing.requests += row.requests;
        existing.errors += row.errors;
        existing.durationMsTotal += row.durationMsTotal;
        existing.maxDurationMs = Math.max(existing.maxDurationMs, row.maxDurationMs);
      }
    }
  }
}

export default worker;
