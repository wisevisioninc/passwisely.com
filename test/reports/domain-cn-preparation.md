# CN domain deployment acceptance — 2026-10-28

`https://passwisely.cn` is deployed on Wise and passed **12/12 public service
checks** after activation. All three desktop downloads select **v2.0.0 r5**.
The frontend mirror is also active, with a working HTTP IP preview; public
`.com` requests are still blocked by Alibaba Cloud ICP filing enforcement.

## Deployment identity and evidence

- Deployed web source: `a087b332713df5ad4d5fa1b2def8cb472f641b88`.
- Compiled tree: `7e681be092a67c2de2879484ba988fa7adf7a959ee0e28754f3692db34307c92`
  (49 files, 5,352,047 bytes).
- Wise activation receipt reported `active`; transaction SHA256:
  `854dc31e909f330a9b1cee50cc11b0b174cd74204d181eece7da624df70646ff`.
- Frontend mirror activation transaction SHA256:
  `82aaa6c649cdd7ae31aad749f8649f7dde624eda8480e79b27949944690ca83f`.
  Its backend, binding and Nginx routing were preserved.
- Public verification began at `2026-10-27T20:08:30.328Z`
  (`2026-10-28 04:08` Asia/Shanghai). These are dated observations, not a
  guarantee of future availability.

Saved evidence:

- [Public service checks](releases/2.0.0/r5/public-service-verification.json)
- [Anonymous homepage performance](releases/2.0.0/r5/homepage-performance.json)
- [Frontend mirror verification](releases/2.0.0/r5/frontend-verification.json)

The JSON files preserve the original reports byte for byte, including source
provenance paths and public artifact digests. They contain no authentication
headers, session cookies, provider credentials, private keys or exported
production environment. Raw response bodies and application secrets were not
copied into this report directory.

## Defaults and ownership

- `website/lib/public-site.ts` owns the public HTTPS origin. An omitted
  `PUBLIC_SITE_URL` defaults to `https://passwisely.cn`. An explicitly configured
  valid origin remains authoritative, including `https://passwisely.com`.
  Request Host and forwarding headers do not select metadata, password-reset,
  payment-notification or payment-return origins.
- `electron/serviceEndpoints.ts` owns desktop account, AI and portal defaults:
  `https://passwisely.cn/api` and gRPC `passwisely.cn:443`. Explicit API and gRPC
  overrides remain independent and retain their existing semantics. No HTTP
  fallback or TLS-verification bypass was used for this acceptance.
- Server deployment does not rewrite an already-installed client's embedded
  defaults. The new defaults ship in r5; earlier installed builds need to be
  updated when they still select the old origin.
- Explicit `.com` configuration compatibility is a source contract, **not** a
  claim that the current public `.com` deployment works.

## Public HTTPS, routes and authentication guards

The homepage returned HTTP 200 with a trusted TLS 1.3 connection. The certificate
covers `passwisely.cn` and `www.passwisely.cn`; validity is
**2026-10-27 09:39:01 UTC through 2027-01-25 09:39:00 UTC**. The observed issuer
was `YR1`. The saved verifier includes the full public certificate fingerprint.

HTTP redirected to canonical HTTPS with the original API path and query
preserved. Unauthenticated account, Recall token, Deepgram token and AI requests
returned HTTP 401. gRPC health returned `SERVING`; unary and streaming chat
returned code 16 (`UNAUTHENTICATED`), with no streaming data. These checks verify
routing and authentication guards, not provider token issuance or model output.

Each platform's download route returned HTTP 307 to its immutable OSS r5 object:

| Platform | Version / revision | Published bytes | SHA256 |
| --- | --- | ---: | --- |
| macOS Apple silicon | 2.0.0 / r5 | 159,694,334 | `89e6f1132c151ef90860183ffbcec523db61a639cd2f16c6f8b21ffb412f1b26` |
| macOS Intel x64 | 2.0.0 / r5 | 119,247,160 | `938e2c785916b12ded9fc547ab9fff076ef4a7196335fe635a82e4ae3e6923ca` |
| Windows x64 | 2.0.0 / r5 | 123,221,074 | `6b60227935fe3559b5cedd4daf091b8a4fbee69e1858fe3371cc0d4f12f9c1a6` |

These are verified redirect targets and published catalog facts; this public
route check did not redownload every installer. Windows remains unsigned, with
Windows-device audio and overlay validation still outstanding. Intel native
audio requires macOS 13 or newer.

## Homepage payload and network observations

The public page now references four `.cn` icon links, resolving to two unique
resources. Both returned HTTP 200 with valid TLS. All eight measured initial
JS/CSS files matched the reviewed candidate's SHA256 digests.

Comparison follows the same initial static dependency closure: rendered HTML
JS/modulepreload references plus recursive static imports. Responses were
independently recompressed at gzip level 6 with a fixed timestamp. Dynamic
Dashboard/QR code is excluded from this initial closure.

| Initial resources | Before lazy loading, pinned 298fec24 | Deployed a087 |
| --- | ---: | ---: |
| JS decoded bytes, 6 files | 415,379 | 364,358 |
| JS normalized gzip bytes | 130,800 | 114,720 |
| CSS normalized gzip bytes, 2 files | 33,959 | 33,968 |

Initial JS fell by **16,080 gzip bytes (12.29%)**. CSS grew by 9 gzip bytes from
one unused generated `.static` utility; the Dashboard/landing stylesheet stayed
byte-identical and eager for SSR. Actual homepage transfer was 14,285 gzip
bytes, decoding to 66,236 bytes. Normalized gzip totals are a comparison metric,
not a substitute for the server's recorded wire sizes.

At `2026-10-27T20:11:15Z`, three fresh connections from the same Mac, using a
synthetic iPhone user agent, produced these independent median phase values:

| DNS | TCP | TLS | TTFB | Total |
| ---: | ---: | ---: | ---: | ---: |
| 2.467 ms | 88.467 ms | 89.329 ms | 309.709 ms | 421.943 ms |

Total elapsed times ranged from 397.475 to 595.034 ms. Earlier same-Mac n=3
observations had median TTFB 418.708 ms and total 509.892 ms; the measurements
occurred at different times and do not establish a causal latency improvement.
Independent median phases must not be summed as one request. Resource timings
from separate connections must not be added into a browser waterfall, which
can reuse HTTP/2 connections.

This is **not a real-phone, carrier, browser hydration or LCP measurement**.
Rendering CPU and memory were not measured. Payload reduction and repaired icon
URLs do not by themselves prove the cause of the previously reported mobile
slowness.

## Frontend mirror and `.com` limitation

The frontend mirror at `http://47.95.66.86` returned HTTP 200. Thirteen JS/CSS
resources matched the deployed manifest hashes, and all three IP-based r5
proxy download HEAD requests returned the expected HTTP 307 targets.

Public requests with Host `passwisely.com` returned **HTTP 403**, server `Beaver`,
with the error title **`Non-compliance ICP Filing`**. The internal frontend
proxy's three r5 HEAD checks passed, while preserved public HTTP routing
redirects downloads to `https://passwisely.com`. This internal success does
**not** establish public `.com` availability. No Nginx binding or routing was
changed to bypass the filing block.

## Verification boundaries

- Native application model-response and answer-quality testing is documented
  separately in [the Mac r5 report](../leetcode/reports/mac-r5-cn-20261028.md).
  This deployment report does not grade those answers.
- Live Recall/Deepgram ASR and audio capture were not exercised in these public
  service/performance checks. HTTP 401 from their protected routes is not an
  authenticated ASR acceptance result.
- No real payment, collection quota, order completion or payment callback was
  tested by this deployment acceptance.
- Supabase Site URL, password-reset/auth redirect allowlists and actual reset
  email delivery were not inspected or verified here. Those external settings
  remain separate follow-up checks; valid historical `.com` redirect entries
  should not be silently discarded.
