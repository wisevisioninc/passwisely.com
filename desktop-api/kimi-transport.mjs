import { Agent, request as httpsRequest } from "node:https";
import { handleProviderTransport, requestQwen } from "./qwen-transport.mjs";

export const KIMI_TRANSPORT_PATH = "/internal/kimi/chat/completions";
export const KIMI_ORIGIN = "https://api.moonshot.cn/v1/chat/completions";
const KIMI_WARM_URL = "https://api.moonshot.cn/v1/models";
const WARM_INTERVAL_MS = 20_000;

// Workerd opens a new TLS connection to Moonshot for every request (measured
// from this host: 270-325 ms, occasionally over 1 s). This process keeps a
// small pool of idle connections instead. Idle sockets are dropped after 50 s
// so a connection the provider may already have closed is rarely reused.
export const kimiAgent = new Agent({ keepAlive: true, keepAliveMsecs: 15_000, maxSockets: 64, maxFreeSockets: 4, timeout: 50_000 });

export function requestKimi(body, authorization, options = {}) {
  return requestQwen(body, authorization, { origin: KIMI_ORIGIN, agent: kimiAgent, name: "Kimi", code: "KIMI", ...options });
}

const KIMI_PROFILE = {
  name: "Kimi", code: "KIMI", modelPattern: /^kimi[\w.-]+$/, budgetHeader: "x-wise-total-timeout-ms", timing: "kimi", attemptsHeader: "x-kimi-attempts",
  // The relay already applied the Kimi request contract; forward it unchanged.
  prepare: (body, streaming) => ({ ...body, stream: streaming }),
};

export function handleKimiTransport(request, response, transport = requestKimi) {
  return handleProviderTransport(request, response, transport, KIMI_PROFILE);
}

let lastWarmAt = 0;
function hasIdleSocket(agent) {
  return Object.values(agent.freeSockets || {}).some(sockets => sockets.length > 0);
}

/** Open one idle connection to Moonshot ahead of a model request. Called when
 * a desktop client connects or sends a request, so the TLS handshake overlaps
 * with session and credit checks instead of following them. The probe carries
 * no credentials or user data; its response is discarded.
 */
export function warmKimiConnection({ agent = kimiAgent, requestImpl = httpsRequest, now = Date.now() } = {}) {
  if (hasIdleSocket(agent) || now - lastWarmAt < WARM_INTERVAL_MS) return false;
  lastWarmAt = now;
  try {
    const probe = requestImpl(KIMI_WARM_URL, { method: "GET", agent, headers: { "accept-encoding": "identity" } }, response => { response.resume(); });
    probe.setTimeout(10_000, () => probe.destroy());
    probe.once("error", () => undefined);
    probe.end();
    return true;
  } catch { return false; }
}

export function resetKimiWarmStateForTests() { lastWarmAt = 0; }
