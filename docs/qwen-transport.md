# Qwen connection and generation budgets

Qwen chat and resume calls use `enable_thinking: false` and `stream: false`.
The shared/default provider remains unchanged (OpenAI through WisePA).

## Timeout semantics

- Each connection attempt has at most **20 seconds** for socket assignment, DNS,
  TCP and TLS. Its timer stops on TLS `secureConnect`, or immediately when a
  previously established TLS socket is reused.
- One **90-second total deadline** covers all connection attempts, request upload,
  model generation and reading the entire upstream response body. Resume requests
  are also clamped to 90 seconds for Qwen; other providers retain their budgets.
- Up to three attempts are allowed for transient failures **before TLS connects**.
  Once connected, neither HTTP errors nor interrupted responses are retried: the
  upstream may already have processed or billed the request.
- Client disconnects cancel the active transport. Timeout errors carry HTTP 504.

The previous 20-second `AbortSignal.timeout` wrapped the entire `fetch`, including
model generation, and restarted on each retry. It was not a connection timeout.

## Runtime and deployment

The website runs under Workerd, whose Fetch API does not expose socket lifecycle
events. Qwen therefore uses Node HTTPS in the existing desktop API process, through
`POST http://127.0.0.1:3013/internal/qwen/chat/completions`. The existing `/health`
endpoint is unchanged. No public port or Nginx route is added.

The internal endpoint requires a provider bearer key, accepts Qwen requests only,
and has a fixed HTTPS DashScope destination (no arbitrary URLs or redirects).
It holds no stored credentials. Requests and responses are bounded to 12 MiB.
`Server-Timing` exposes connection and total duration without request content or
keys. Keys and prompts must not be logged.

Deploy the updated desktop API process **before** the website build. Verify
`/health` and that the internal endpoint returns 401 without authorization, then
publish the website build and stage the server's own runtime environment. Never
copy local environment files over production credentials. This is a server-only
change; desktop binaries and download links do not change.

For rollback, restore the previous website build first, then restore/restart the
previous desktop API code. Keep production environment files unchanged.

## Regression checks

Run `node --test desktop-api/tests/*.test.mjs` from the repository root and
`node --test tests/*.test.mjs` from `website`, followed by website type-check/build.
The TLS integration test deliberately waits **21 seconds after connecting**, with
the production 20-second connection limit. Other tests cover total-budget expiry,
stalled response bodies, connection reuse, cancellation, pre-connect-only retries,
input validation and forcing thinking off.

References: [Node TLS secureConnect](https://nodejs.org/docs/latest-v22.x/api/tls.html#event-secureconnect)
and [Workerd Fetch API](https://developers.cloudflare.com/workers/runtime-apis/fetch/).
