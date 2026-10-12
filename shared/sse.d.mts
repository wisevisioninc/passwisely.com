export function readSSE(body: ReadableStream<Uint8Array> | null, signal?: AbortSignal): AsyncGenerator<{event: string; data: string}>;
export function encodeSSE(value: unknown, event?: string): Uint8Array;
