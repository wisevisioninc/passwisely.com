import { encodeSSE, readSSE } from "../../shared/sse.mjs";

type Usage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };

// Normalize provider streams without buffering the complete answer. Errors are
// explicit events: a closed socket is never treated as successful completion.
export function chatStreamResponse(
  upstream: Response,
  provider: string,
  model: string,
  controller: AbortController,
  onUsage: (usage: Usage) => Promise<void>,
  onClose: () => void = () => {},
): Response {
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  async function* events() {
    let finished = false, done = false, id = "";
    try {
      for await (const event of readSSE(upstream.body, controller.signal)) {
        if (event.data === "[DONE]") { done = true; break; }
        const payload = JSON.parse(event.data);
        if (payload.error || event.event === "error") throw new Error(payload.error?.message || "模型数据流中断。");
        if (provider === "anthropic") {
          if (payload.type === "message_start") {
            id = payload.message?.id || "";
            usage.prompt_tokens = payload.message?.usage?.input_tokens || 0;
          }
          if (payload.usage?.output_tokens !== undefined) usage.completion_tokens = payload.usage.output_tokens;
          usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
          if (payload.type === "message_stop") { done = true; break; }
          const delta = payload.type === "content_block_delta" && payload.delta?.type === "text_delta" ? payload.delta.text : "";
          const stop = payload.type === "message_delta" ? payload.delta?.stop_reason : null;
          if (stop) finished = true;
          if (delta || stop) yield encodeSSE({ id, model, choices: [{ index: 0, delta: { content: delta }, finish_reason: stop ? (stop === "max_tokens" ? "length" : "stop") : null }] });
        } else {
          if (payload.usage) {
            usage.prompt_tokens = payload.usage.prompt_tokens ?? usage.prompt_tokens;
            usage.completion_tokens = payload.usage.completion_tokens ?? usage.completion_tokens;
            usage.total_tokens = payload.usage.total_tokens ?? usage.prompt_tokens + usage.completion_tokens;
          }
          if (payload.choices?.[0]?.finish_reason) finished = true;
          yield encodeSSE(payload);
        }
      }
      if (!done || !finished) throw new Error("模型数据流提前结束，当前内容未完成，请重试。");
      yield encodeSSE({ model, choices: [], usage });
      await onUsage(usage).catch(() => undefined);
      yield encodeSSE("[DONE]");
    } catch (error) {
      if (!controller.signal.aborted) yield encodeSSE({ error: { message: error instanceof Error ? error.message : "模型数据流中断。" } }, "error");
    } finally { onClose(); }
  }
  const iterator = events();
  return new Response(new ReadableStream<Uint8Array>({
    async pull(target) {
      try {
        const next = await iterator.next();
        if (next.done) target.close(); else target.enqueue(next.value);
      } catch (error) { controller.abort(); target.error(error); }
    },
    async cancel() { controller.abort(); await iterator.return(undefined); onClose(); },
  }), { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}
