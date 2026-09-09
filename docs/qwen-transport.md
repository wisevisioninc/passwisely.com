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

## Verification: 2026-09-10 (Asia/Shanghai)

- Local Node 24 and wise Node 22 each passed 16 desktop API tests and 32 website
  tests. Website TypeScript check and production build passed.
- The real TLS regression returned after 21 seconds using the production
  connection deadline, with one attempt, on both hosts.
- Production loopback Qwen probe: HTTP 200, `qwen3.8-flash`, response `OK`, no
  reasoning content, one attempt; 230 ms connection and 759 ms upstream total.
- Public gRPC default-provider probe: `gpt-5.6-sol` returned `OK` in 4.173 seconds.
  Database defaults remained OpenAI through `https://wisepa.cn/v1`.
- Real local Electron screenshot processing repeated three previously failed
  questions from the September 9 benchmark, with the same screenshots, Python
  signatures and prompts. Each completed in one model call, with a rendered
  solution and no processing errors. The combined timeout/thinking change and
  different sampling time mean this is not an isolated thinking-only experiment.

| LeetCode CN | Before (failed) | After (returned) | Generated Python tests |
| --- | ---: | ---: | ---: |
| 2786 | 60.915 s | 11.614 s | 124 / 124 |
| 1857 | 60.810 s | 11.305 s | 111 / 124 |
| 3519 | 60.866 s | 19.057 s | 149 / 149 |

The average successful end-to-end time in this three-question sample was 13.992 s.
These are individual runs, not a latency guarantee or the full 10-question retest.
Generated code was executed in a network-disabled, read-only, resource-limited
container, with the existing benchmark test vectors.

**Known model accuracy issue, separate from transport:** question 1857 adds the
destination node's color count repeatedly for different incoming edges. A sample
with colors `acacbcb` and edges `[[0,2],[1,2],[1,5],[2,4],[3,2],[3,5],[4,5],[4,6]]`
returned 4 instead of 2. No application workaround, prompt change or hidden
switch back to thinking was made. Overall generated-code cases passed 384/397;
only two of three questions passed every case.

The temporary test account was deleted successfully; its balance was 99 after
one default-provider call. The Qwen calls used the supplied provider key without
charging test credits. Website and admin routes returned HTTP 200. No production
user account, other service, installer, OSS object or download URL was changed.
