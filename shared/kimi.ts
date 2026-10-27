/** Kimi K3-family Chat Completions contract.
 * Official parameters: https://platform.kimi.com/docs/api/models-overview
 * K3.1 Pro and K3 always reason; use reasoning_effort instead of K2 thinking.
 */
export const KIMI_DEFAULT_MODEL = "kimi-k3.1-pro";
export const KIMI_MODEL_IDS = [KIMI_DEFAULT_MODEL, "kimi-k3"] as const;

export function isKimiK3Model(model: unknown): boolean {
  return KIMI_MODEL_IDS.some(id => id === model);
}

export function prepareKimiChatBody<T extends { model?: unknown }>(body: T): T {
  if (!isKimiK3Model(body.model)) return body;
  const request: Record<string, unknown> = { ...body };
  // These sampling controls are fixed by the provider. Old installed clients
  // still send different values; omit them at the owning request boundary.
  for (const name of ["thinking", "temperature", "top_p", "n", "presence_penalty", "frequency_penalty"]) {
    delete request[name];
  }
  if (request.reasoning_effort === undefined) request.reasoning_effort = "low";
  return request as T;
}
