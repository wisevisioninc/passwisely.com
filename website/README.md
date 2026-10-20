# PassWisely Web

The bilingual public website, account service, credit ledger, direct Alipay /
WeChat Pay integration, and desktop release download service for PassWisely.

## Local checks

Requires Node.js 22+ and pnpm.

```bash
pnpm install
pnpm exec tsc --noEmit
pnpm test
```

## Runtime bindings

- `DB`: legacy Cloudflare D1 account migration store. Its migrations are in `drizzle/`; it does not register current accounts.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_ANON_KEY`, and `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY`: current server-side accounts, credit ledger, and purchases. Their PostgreSQL migrations are in `supabase/migrations/`.
- `DOWNLOADS`: Cloudflare R2 bucket for signed desktop installers.
- `ALIPAY_APP_ID`: production application ID from Alipay Open Platform.
- `ALIPAY_PRIVATE_KEY`: application RSA2 private key in PKCS#8 PEM format.
- `ALIPAY_PUBLIC_KEY`: Alipay public key in SubjectPublicKeyInfo PEM format.
- `WECHAT_PAY_APP_ID`: AppID bound to the WeChat Pay merchant.
- `WECHAT_PAY_MCH_ID`: WeChat Pay merchant number.
- `WECHAT_PAY_MCH_SERIAL_NO`: merchant API certificate serial number.
- `WECHAT_PAY_PRIVATE_KEY`: merchant API private key in PKCS#8 PEM format.
- `WECHAT_PAY_API_V3_KEY`: 32-byte API v3 key used to decrypt callbacks.
- `WECHAT_PAY_PUBLIC_KEY_ID`: WeChat Pay public-key ID beginning with
  `PUB_KEY_ID_`.
- `WECHAT_PAY_PUBLIC_KEY`: the matching downloaded WeChat Pay public key in PEM
  format (this is not the merchant certificate public key).

For local production builds, `.env.production` may instead set
`WECHAT_V3_CERT` to the directory containing `apiclient_cert.pem` and
`apiclient_key.pem`, or set `WECHAT_V3_CERT_PEM` and `WECHAT_V3_CERT_PE` to
their individual paths. It may set `WECHAT_PUB_KEY` to the downloaded WeChat
Pay public-key file path. The staging script loads the PEM files into protected
Worker runtime bindings and derives the merchant certificate serial number.
`WECHAT_APIV3_KEY` and `WECHAT_PUB_KEY_ID` remain supported aliases.
- `RELEASE_UPLOAD_KEY`: bearer-like key for the private installer upload route.

Payment secrets must only exist in the server's untracked `.env.production`.
When a PEM key is stored on one line, line breaks may be represented as `\n`.
PassWisely's RMB merchant and settlement entity is
`福建智感灵眸科技有限公司`.

The checkout API creates a local pending order before contacting the provider.
Alipay uses computer website payment and WeChat uses Native payment. Signed
asynchronous callbacks verify merchant/app IDs, order number, currency, and
amount before an idempotent credit entry is written. Callback URLs are:

- `https://passwisely.com/api/payments/alipay/notify`
- `https://passwisely.com/api/payments/wechat/notify`

The free new-user trial is **¥0 / 20 credits**, once on registration, without a payment order. Paid plans are **Pro: ¥99/month / 200 credits** (`pro_monthly_v2`) and **Unlimited: ¥299/month / 1,000 credits** (`unlimited_monthly_v2`). “Unlimited” is a plan name, not unlimited credits.

Paid packs use manual repurchase, without automatic renewal. Each pack expires 30 days after its credits first arrive; purchasing another pack does not extend an earlier one. New checkout requests reject retired `starter`, `pro`, and `max` IDs. Historical pending orders retain their original immutable price/credit entitlement and remain payable under that snapshot.

The desktop app uses `https://passwisely.com/api` by default. For local or
staging builds, override it with `PASSWISELY_API_URL`.

## Credit rules

- New account: 20 permanent welcome credits, once. Existing accounts are not topped up; their earlier 10-credit grants and permanent balances remain unchanged.
- Solve, debug, or follow-up: 1 credit.
- Resume review: 2 credits.
- Resume optimization or interview plan: 3 credits.

The fixed action costs above apply to `/api/credits/consume`. Model answers and resume Agents use their server-side model/token cost rules; the plan size does not promise a fixed number of answers.

The database balance owner combines permanent credits with currently valid paid grants. Consumption uses the earliest expiry first, then permanent credits. A grant is unavailable at its expiry instant. Refunds return to the original bucket without changing its expiry; refunding an expired grant does not create new usable or permanent credits.

Every usage request includes a unique request ID. Database transactions bind that ID to the original user, action and cost, so retries cannot charge twice. Duplicate operations return the current effective balance. Payment callbacks credit an order once and never restart its 30-day clock. Account APIs and the administration total read the same database balance owner.

## wise production deployment

The public domain points to `8.219.140.215`. The application listens only on
`127.0.0.1:3011`; Nginx is the public HTTP/HTTPS entry point. The production
service has its own systemd unit and does not modify the units or Nginx files
used by WiseVision, WiseDrama, or other sites on the same server.

Payment values belong in the untracked, mode `0600`
`/home/jerry/codebase/passwisely/website/.env.production` file. The existing runtime-configuration owner generates protected bindings at the production path; do not copy credentials or production data into a staging directory.

Before enabling the new monthly checkout, review and apply `supabase/migrations/0010_expiring_credit_grants.sql` through the existing Supabase database owner. Verify the target/schema/migration history and SQL digest, retain a restricted backup, and apply only the reviewed migration. D1's `drizzle/` migrations are separate legacy state; do not replay all historical Supabase migrations or use a database reset to deploy this change.

Use a source-pinned build and the reviewed release activation plan to update the web runtime and download routes. Initial-host provisioning scripts also manage units and certificates; they are not the release-update procedure.

Keep migration 0010 and all credited rights during recovery. Once a monthly grant exists, returning to the old web runtime that reads only `profiles.credits` can restore HTTP routes while under-reporting the user's monthly balance. Prefer temporary maintenance and a forward recovery to a runtime using `get_credit_balance`; never delete grants, expire old permanent balances, or restore the old consumption/refund functions to match an old UI.
