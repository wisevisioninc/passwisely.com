# PassWisely Web

The bilingual public website, account service, credit ledger, Stripe Checkout
integration, and desktop release download service for PassWisely.

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
- `STRIPE_SECRET_KEY`: Stripe restricted or secret API key.
- `STRIPE_WEBHOOK_SECRET`: signing secret for `/api/stripe/webhook`.
- `RELEASE_UPLOAD_KEY`: bearer-like key for the private installer upload route.

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

Optional Stripe values belong in the untracked
`/home/jerry/codebase/passwisely/website/.env.production` file.
