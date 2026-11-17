/** Kimi K3-family Chat Completions contract.
 * Official parameters: https://platform.kimi.com/docs/api/models-overview
 * K3.1 Pro and K3 always reason; use reasoning_effort instead of K2 thinking.
 */
// The highspeed variant is the default since 2026-11-17 by product decision.
// It had not been benchmarked for speed or accuracy when it was selected.
export const KIMI_DEFAULT_MODEL = "kimi-k3.1-pro-highspeed";
export const KIMI_STANDARD_MODEL = "kimi-k3.1-pro";
export const KIMI_MODEL_IDS = [KIMI_DEFAULT_MODEL, KIMI_STANDARD_MODEL, "kimi-k3"] as const;

/** Documented levels are low/high/max (provider default: max). "none" is an
 * undocumented level observed on 2026-11-17 to skip reasoning entirely; it
 * backs the opt-in fast answer mode and may be withdrawn by the provider.
 */
export const KIMI_REASONING_EFFORTS = ["none", "low", "high", "max"] as const;
export type KimiReasoningEffort = (typeof KIMI_REASONING_EFFORTS)[number];
/** Levels a client may request when the shared Wise key pays for the call. */
export const KIMI_SHARED_KEY_EFFORTS: readonly KimiReasoningEffort[] = ["none", "low"];
export const KIMI_FAST_EFFORT: KimiReasoningEffort = "none";

export function isKimiK3Model(model: unknown): boolean {
  return KIMI_MODEL_IDS.some(id => id === model);
}

export function prepareKimiChatBody<T extends { model?: unknown }>(
  body: T,
  allowedEfforts: readonly KimiReasoningEffort[] = KIMI_REASONING_EFFORTS,
): T {
  if (!isKimiK3Model(body.model)) return body;
  const request: Record<string, unknown> = { ...body };
  // These sampling controls are fixed by the provider. Old installed clients
  // still send different values; omit them at the owning request boundary.
  for (const name of ["thinking", "temperature", "top_p", "n", "presence_penalty", "frequency_penalty"]) {
    delete request[name];
  }
  // The provider silently treats an unknown level as its default (max), which
  // is several times slower; never forward a value outside the allowed set.
  if (!allowedEfforts.some(effort => effort === request.reasoning_effort)) request.reasoning_effort = "low";
  return request as T;
}
