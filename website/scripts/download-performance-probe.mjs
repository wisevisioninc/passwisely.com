import { pathToFileURL } from "node:url";

const RELEASE_BASE =
  "https://passwisely-releases-prod.oss-cn-beijing.aliyuncs.com/releases/v1.2.1";
const ARTIFACTS = {
  "mac-arm64": "PassWisely-macOS-arm64.dmg",
  "mac-x64": "PassWisely-macOS-x64.dmg",
  "windows-x64": "PassWisely-Windows-x64.exe",
};
const SAMPLE_BYTES = 256 * 1024;

export function configFromEnvironment(environment = process.env) {
  const supabaseUrl = environment.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = environment.SUPABASE_SECRET_KEY?.trim() || environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !key) throw new Error("Supabase server credentials are not configured.");
  return { supabaseUrl, key, releaseBase: environment.PASSWISELY_RELEASE_BASE?.trim() || RELEASE_BASE };
}

function integerHeader(value) {
  const parsed = Number(value || 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function probeArtifact(platform, filename, config, fetchImplementation = globalThis.fetch) {
  const url = `${config.releaseBase}/${encodeURIComponent(filename)}`;
  let httpStatus = 0;
  try {
    const headStartedAt = Date.now();
    const head = await fetchImplementation(url, {
      method: "HEAD",
      cache: "no-store",
      headers: { "user-agent": "PassWisely-Download-Monitor/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    const headLatencyMs = Math.max(1, Date.now() - headStartedAt);
    httpStatus = head.status;
    if (!head.ok) throw new Error(`HEAD returned ${head.status}`);

    const transferStartedAt = Date.now();
    const sample = await fetchImplementation(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        range: `bytes=0-${SAMPLE_BYTES - 1}`,
        "user-agent": "PassWisely-Download-Monitor/1.0",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const ttfbMs = Math.max(1, Date.now() - transferStartedAt);
    httpStatus = sample.status;
    if (sample.status !== 206) {
      await sample.body?.cancel();
      throw new Error(`Range request returned ${sample.status}`);
    }
    const bytes = (await sample.arrayBuffer()).byteLength;
    const transferMs = Math.max(1, Date.now() - transferStartedAt);
    const throughputBps = Math.round(bytes / (transferMs / 1000));
    const rangeTotal = sample.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
    const objectBytes = integerHeader(rangeTotal || head.headers.get("content-length"));
    const estimatedSeconds = throughputBps > 0 && objectBytes > 0
      ? Math.round(objectBytes / throughputBps * 100) / 100
      : 0;
    return {
      platform,
      status: "healthy",
      object_bytes: objectBytes,
      head_latency_ms: headLatencyMs,
      ttfb_ms: ttfbMs,
      sample_bytes: bytes,
      transfer_ms: transferMs,
      throughput_bps: throughputBps,
      estimated_seconds: estimatedSeconds,
      http_status: httpStatus,
    };
  } catch (error) {
    return {
      platform,
      status: "down",
      object_bytes: 0,
      head_latency_ms: 0,
      ttfb_ms: 0,
      sample_bytes: 0,
      transfer_ms: 0,
      throughput_bps: 0,
      estimated_seconds: 0,
      http_status: httpStatus || null,
      error: error instanceof Error ? error.message.slice(0, 120) : "Probe failed",
    };
  }
}

export async function runProbes(config, fetchImplementation = globalThis.fetch) {
  const samples = await Promise.all(
    Object.entries(ARTIFACTS).map(([platform, filename]) =>
      probeArtifact(platform, filename, config, fetchImplementation)),
  );
  const persisted = samples.map(({ error: _error, ...sample }) => sample);
  const response = await fetchImplementation(`${config.supabaseUrl}/rest/v1/download_performance_samples`, {
    method: "POST",
    headers: {
      apikey: config.key,
      authorization: `Bearer ${config.key}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify(persisted),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Saving download samples failed (${response.status}).`);
  return samples;
}

async function main() {
  const samples = await runProbes(configFromEnvironment());
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    success: samples.every((sample) => sample.status === "healthy"),
    samples: samples.map((sample) => ({
      platform: sample.platform,
      status: sample.status,
      headLatencyMs: sample.head_latency_ms,
      throughputBps: sample.throughput_bps,
      estimatedSeconds: sample.estimated_seconds,
      ...(sample.error ? { error: sample.error } : {}),
    })),
  }));
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (entryPoint === import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), success: false, error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
