# Local fetch failure diagnosis — 2026-10-27

## Observed failure and cause

The running desktop process was the old `release/1.3.0-mac-window-privacy/PassWisely.app` (PID 36564), not the new CN-service r5 build. Its shipped ASAR reports version 1.3.0 and embeds `https://passwisely.com/api` and `passwisely.com:443` defaults. Its working directory was `/`; process environment overrides were not inspected.

A credential-free `/api/account` request reproduced `TypeError: fetch failed` with cause `ECONNREFUSED 47.95.66.86:443` for the old `.com` route. The same request to `.cn` returned HTTP 401, the expected unauthenticated rejection. This is transport failure before account/model processing, not evidence of depleted Kimi credit. Per-process use of the default is inferred from the old artifact; The old process transport was not instrumented; the subsequent r5 authenticated native acceptance is recorded below.

The same comparison was executed in the actual signed r5 Electron 29.4.6 / Node 20.9.0 binary without loading the GUI entrypoint: `.com` failed with the same refusal (281 ms), `.cn` returned 401 (384 ms), and TLS gRPC Health returned `SERVING grpc+protobuf` (366 ms). These single timings diagnose reachability; they are not representative performance measurements. Public facts: [local-fetch-routing-2026-10-27.json](local-fetch-routing-2026-10-27.json).

## Local remediation

Installed the already built, signed and notarized ARM64 v2.0.0 r5 bundle at `/Applications/PassWisely.app`. The previous installed bundle was retained at `/Applications/PassWisely.before-cn-r5-20261027.app`. Strict deep codesign verification and Gatekeeper assessment passed before installation; copied bundle signature verification passed. Installed ASAR SHA256: `9ce35048d53e1b9b6c23f1bf3ef053235bd81de8cbd36e533f063f066089863c`.

The r5 endpoints are owned by `electron/serviceEndpoints.ts`: HTTPS API `https://passwisely.cn/api`, model compatibility route `/api/ai`, TLS gRPC `passwisely.cn:443`. Explicit developer overrides remain authoritative. Account/settings files were not changed or decrypted. The old running process was separate from the replaced installed bundle and retained its single-instance lock. After desktop automation timed out reading it, the user manually quit it; `/Applications/PassWisely.app` was then started successfully. No forced process termination, `.com` DNS change or TLS bypass was performed.

## Historical-case regression

Fixed two observed runner contract drifts: obsolete `createUpload` became current `createSession`, and `LiveSessionService.ask` now receives explicit Python `codeLanguage`. Added optional `--context text`; omission preserves the existing alternating synthetic transcript contexts.

Executed `node --test test/leetcode/scripts/run-live.test.mjs`: **9/9 passed**, including all **20/20 historical fixtures** through production `LiveSessionService → ConversationContext → ProcessingHelper → OpenAI SDK → fetch` and an owned loopback HTTP SSE listener. Each case made one HTTP request and reconstructed the complete synthetic response. The separate three failure cases retained 401, length truncation and early EOF errors without silently retrying. Test transport is constrained to its listener; credentials and responses are synthetic, and temporary outputs/sockets are cleaned up.

Executed fixture verification: **20 problems / 169 authored cases / 3 boundary cases passed**. Both independent small-input oracle suites also passed. Earlier account/endpoint/runner focused regression passed 16/16 before adding the two loopback integration tests.

Replay responses explicitly state `TRANSPORT_REPLAY_ONLY`; these results do not establish model answer correctness, live model speed, authenticated service availability or native UI behavior. The existing historical real-model answers/reports were retained. Reusable commands are documented in [test/leetcode/README.md](../leetcode/README.md).

## Completed native and production acceptance — 2026-10-28

The user quit the old process and the installed r5 App was started from its verified `/Applications` path. The existing signed-in account submitted all 20 saved historical questions through the native pure-text UI; every request yielded a copied model response and none showed `fetch failed`. No account credentials were extracted. This establishes the tested r5 authenticated text path; it does not establish successful complete model termination for every answer.

Sandbox judging found **18 passed / 1 failed / 1 unverified** across the fixed cases (155/169 cases passed, 10 unexecuted). The graph-weight answer is algorithmically wrong, and the palindrome response is incomplete with no captured provider finish reason. Including three saved boundary cases adds a Python recursion failure. Raw UI `completed` labels do not prove provider success or complete code. See the [audited native report](../leetcode/reports/mac-r5-cn-20261028.md).

The user activated the reviewed Wise web candidate `a087b332713df5ad4d5fa1b2def8cb472f641b88`; strict public HTTPS/API/auth-guard/gRPC and three r5 download checks passed **12/12**. All three platforms retain version 2.0.0 and immutable r5 artifacts. Homepage initial JS gzip fell 12.29%; desktop connection timings are not physical-phone load measurements. See the [CN deployment report](domain-cn-preparation.md).

ASR, screenshot inference, real payment collection, password-reset delivery, physical-phone speed and Intel/Windows physical-device behavior were not re-tested in this run. The `.com` compatibility route and DNS were not silently changed to work around the observed refusal.
