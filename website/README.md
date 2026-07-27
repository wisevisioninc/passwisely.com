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

- `DB`: Cloudflare D1 database. Migrations are in `drizzle/`.
- `DOWNLOADS`: Cloudflare R2 bucket for signed desktop installers.
- `ALIPAY_APP_ID`: production application ID from Alipay Open Platform.
- `ALIPAY_PRIVATE_KEY`: application RSA2 private key in PKCS#8 PEM format.
- `ALIPAY_PUBLIC_KEY`: Alipay public key in SubjectPublicKeyInfo PEM format.
- `WECHAT_PAY_APP_ID`: AppID bound to the WeChat Pay merchant.
- `WECHAT_PAY_MCH_ID`: WeChat Pay merchant number.
- `WECHAT_PAY_MCH_SERIAL_NO`: merchant API certificate serial number.
- `WECHAT_PAY_PRIVATE_KEY`: merchant API private key in PKCS#8 PEM format.
- `WECHAT_PAY_API_V3_KEY`: 32-byte API v3 key used to decrypt callbacks.
- `WECHAT_PAY_PLATFORM_SERIAL_NO`: active WeChat Pay platform certificate/public
  key serial number.
- `WECHAT_PAY_PLATFORM_PUBLIC_KEY`: matching WeChat Pay platform public key in
  PEM format.
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

The three current RMB pack prices are provisional (`¥9`, `¥29`, `¥59`) and
must be confirmed before production merchant credentials are enabled.

The desktop app uses `https://passwisely.com/api` by default. For local or
staging builds, override it with `PASSWISELY_API_URL`.

## Credit rules

- New account: 10 welcome credits.
- Solve, debug, or follow-up: 1 credit.
- Resume review: 2 credits.
- Resume optimization or interview plan: 3 credits.

Every usage request includes a unique request ID. The API reserves that ID
before updating the balance, so retries cannot charge twice.

## wise production deployment

The public domain points to `8.219.140.215`. The application listens only on
`127.0.0.1:3011`; Nginx is the public HTTP/HTTPS entry point. The production
service has its own systemd unit and does not modify the units or Nginx files
used by WiseVision, WiseDrama, or other sites on the same server.

After a successful build and local D1 migration, a server administrator can
activate the service, Nginx virtual host, and Let's Encrypt certificate with:

```bash
sudo bash /home/jerry/codebase/passwisely/website/scripts/activate-wise-production.sh
```

Payment values belong in the untracked, mode `0600`
`/home/jerry/codebase/passwisely/website/.env.production` file. The production
Wrangler command loads that file with `--env-file`, which makes the values
available as Worker bindings. Apply every file in `drizzle/` in journal order
before restarting the service.
