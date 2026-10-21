# Signed-in Dashboard and Usage

Source: `e84551107eef690058d4b435affbacd0752c817e`. Website only; the previously published v2.0.0 desktop installers and pricing rules are unchanged.

## Behavior

Successful website login/registration now navigates to `/dashboard`; a signed-in homepage account/trial action opens the same workspace. Desktop authentication keeps its JSON/token protocol. The client loads user and usage through one authenticated API to avoid parallel session refresh. Anonymous usage returns private/no-store 401 and navigates to the existing sign-in flow; the public server-rendered shell embeds no private account data and is noindex/nofollow.

The Dashboard offers UTC 7/30 calendar-day request and token trends, ledger debits/refunds/net credits, effective permanent/expiring balance and nearest expiry, keyset-paginated usage events, existing checkout, downloads, account controls and Chinese/English. Periods are time windows, not cross-request database snapshots. Requests count recorded events; token counts cover reported usage only. Direct client BYOK activity can be absent. Audio/ASR minutes have no telemetry and are not presented as zero.

## Data and privacy

`0011_account_usage_statistics.sql` adds one read-only service-role-only RPC on existing usage and ledger owners. The API uses the authenticated identity, never a client user ID. Aggregate totals are computed in PostgreSQL independently from recent-event pagination, avoiding a 1,000-row REST truncation or event/ledger join multiplication. Linked refunds follow posting time, so a period can have negative net use. Welcome grants and purchases are not usage.

Production 0011 is committed. Exact function source/attributes/ACL/marker, verified TLS and absent-user 7/30-day PostgREST calls passed. No user rows were written or cloned; no billing owner, payment rule or existing balance was changed. The migration runner keeps only private DDL metadata and handles unknown COMMIT results through the live marker. Independent-connection concurrency and production high-load costs were not measured.

## Verification

- Node 24.19.0: **432/432** full desktop-api and website regressions passed in **21.771 s**, no failures/skips/cancellations. Website TypeScript and diff checks passed.
- Real PostgreSQL semantics through PGlite cover 1,025-row aggregates, 52 pages with microsecond ties, 7/30-day boundaries, refunds, cross-user isolation, service-only ACLs, strict calendar/microsecond cursors, safe failures and idempotent migration. The separate production runner has five tested transaction/permission/unknown-commit scenarios.
- Real source component integration covers login/registration navigation, single usage read, password-recovery priority, payment-return neutrality, refresh/expiry and late 200/401 after logout. A discovered logout navigation race was fixed at the session-transition owner.
- Browser QA used the actual `PassWiselySite`/Dashboard with visibly labeled synthetic transport data: 7/30-day switching, 20+3 records, locales, account modal, empty/error/unauthorized states, desktop and 390px mobile with no horizontal overflow. Synthetic tests do not prove authenticated real-account UI data on production.
- The final credential-free compiled candidate passed **45 Linux HTTP checks**: three unchanged production-owner health rounds, body limits/recovery, exact Dashboard title/noindex/private SSR boundary, and anonymous usage 401/private/no-store/Vary. The earlier candidate's duplicate brand title was observed in the real head DOM and corrected at the child metadata owner; the exact-title assertion was retained.
- The reference URL `https://www.interviewcoder.co/dashboard` redirected to sign-in. Its private Dashboard was not inspected; this implementation follows PassWisely's established brand and workspace structure.

Evidence: [local and browser QA](dashboard-usage/local-verification.json), [database migration](dashboard-usage/database-migration.json), [Linux runtime](dashboard-usage/linux-runtime.json), [credential-free build](dashboard-usage/web-build.json), [publication status](dashboard-usage/publication.json).

## Reusable synthetic samples

From the repository root, use the pinned Node runtime:

```sh
node website/tests/preview-dashboard.mjs
node --test website/tests/dashboard-fixtures.test.mjs website/tests/dashboard-navigation.test.mjs website/tests/account-usage.test.mjs
```

The preview prints a loopback-only URL and supports `?scenario=success`, `empty`, `error`, or `unauthorized`. It compiles the actual components with existing dependencies, serves fixed 30-day event/ledger sources, derives 7-day subsets, and terminates checkout/download locally. No production configuration, credentials or database is loaded. Ctrl-C removes the owned temporary bundle. Sample sources live in `website/tests/fixtures/dashboard-usage.mjs`; no synthetic records are embedded in the production Dashboard.

## Publication

The operator completed the pinned activation successfully. Production is active on the exact 43-file manifest. Both local/public owner health and the existing desktop gRPC health passed; Nginx was unchanged. Independent anonymous public checks verified the Dashboard head/loading privacy boundary and the usage API's private/no-store 401, while pricing and installer routes remained correct. Browser inspection confirmed `/dashboard` completes loading and redirects an anonymous visitor to `/?login=1` with the existing sign-in dialog. No authenticated real-account browser session was submitted. No installer rebuild or repeated database migration occurred. See [independent public verification](dashboard-usage/public-verification.json).
