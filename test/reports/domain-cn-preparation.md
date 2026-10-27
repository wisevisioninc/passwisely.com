# CN public-origin source preparation — 2026-10-27

Scope: source preparation for the requested `https://passwisely.cn` service on
Wise. This report does not assert DNS, certificate issuance, deployment or a
successful production authenticated/model request.

## Defaults and ownership

- Website `lib/public-site.ts` owns the public HTTPS origin. Its omitted-value
  default is now `https://passwisely.cn`; an explicit valid `PUBLIC_SITE_URL`
  remains authoritative, including the existing `.com` compatibility origin.
- Root metadata uses that same owner. Incoming Host and forwarding headers do
  not select metadata, reset, payment-notification or payment-return origins.
- Live account/AI scripts and the reusable LeetCode runner select `.cn` by
  default. Explicit test routing and transport safeguards remain in force.
- Admin hostname, support email, historical release evidence and pending
  WeChat changes were preserved. Offline adapter tests do not enable a channel.

## Executed source verification

- `node --test website/tests/public-site-origin.test.mjs test/leetcode/scripts/run-live.test.mjs`: **15/15 passed**.
- `website` TypeScript `tsc --noEmit --incremental false`: **passed**.
- Tests exercise real loopback HTTP into production checkout/reset routes with
  synthetic account/database/provider seams, hostile incoming hosts, `.cn`
  defaults and explicit `.com` compatibility configuration. Payment adapters
  generate and expose their real notification/return URL fields with synthetic
  signing/fetch boundaries. No real purchase, email, payment or AI call occurs.

## Deployment prerequisites and remaining verification

1. Inspect the actual running `PUBLIC_SITE_URL` binding. A retained `.com` value
   overrides the new code default; change this scalar with backup only after
   the new `.cn` HTTPS origin works. Do not copy provider secrets to a frontend.
2. Verify authoritative/public A/AAAA routing, ACME HTTP challenge accessibility,
   a trusted certificate for the selected hostnames and HTTP-to-HTTPS routing.
3. Verify the Wise HTTPS JSON API and HTTP/2 gRPC paths. No insecure TLS bypass
   or HTTP fallback should be introduced into a client for this migration.
4. Verify Supabase redirect allowlists for
   `https://passwisely.cn/?reset=password` and any configured auth callback.
   The Supabase project allowlist and Site URL were **not inspected or changed
   by this source-preparation task**. Existing valid `.com` redirects may be
   retained for installed clients and already-issued links.
5. Existing signed desktop installers retain their embedded endpoint defaults.
   Source defaults alone do not update an installed application. Check the
   intended installers separately and rebuild/publish an immutable revision
   where required.
6. Production reset delivery, real model responses, live ASR and payment
   acceptance remain distinct from the offline checks above. A working TLS
   endpoint does not establish merchant-product approval or collection quota.
