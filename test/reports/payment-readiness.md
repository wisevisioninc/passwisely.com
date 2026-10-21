# PassWisely payment readiness and debugging — 2026-10-21

## Scope and outcome

Inspected local source and the existing Wise production configuration read-only. No real purchase was created, no payment/refund was submitted, and no production config, database or runtime was changed. Credentials remained on Wise; audit output contained setting names and boolean diagnostics only.

Production source was freshly checked at e84551107eef690058d4b435affbacd0752c817e. The fixes below are local source changes, not deployed. Merchant product permissions and binding cannot be established from local credential presence.

## Observed configuration

| Configuration | Source owner / live runtime observation |
| --- | --- |
| Alipay App ID, application private key, Alipay public key | All absent in both source env and runtime bindings |
| Alipay receiving merchant PID / ALIPAY_SELLER_ID | Absent in source; this newly required setting validates callback seller_id |
| WeChat App ID | Absent in both source env and runtime bindings |
| WeChat merchant ID | Absent in source env; runtime had the old staging script's hardcoded fallback. Its merchant identity was not verified |
| WeChat merchant private key and serial | Loaded from the existing configured files; source-derived values match runtime. PKCS#8 RSA key imports, modulus >=2048, certificate serial and private key match; certificate is currently valid |
| WeChat API v3 key | Source/runtime match; UTF-8 length is exactly 32 bytes |
| WeChat Pay public key and key ID | Source/runtime match; SPKI RSA key imports, modulus >=2048; ID has PUB_KEY_ID_ prefix. Pair validity against WeChat itself remains unverified |

Public HTTPS GET requests to each notify URL returned 405. This confirms route reachability and method rejection only; it is not a signed provider callback test.

## Implemented local repairs

1. Alipay page-pay signing and asynchronous callback verification use their distinct field rules: requests retain sign_type and omit empty values; notifications omit sign/sign_type and retain empty fields. Form values are decoded once.
2. Alipay notifications require the configured receiving seller ID as well as app, order, amount and successful trade state. Admin configuration health includes this new requirement.
3. Exceptions after creating a payment order preserve pending status. A timeout or failed response verification cannot prove provider rejection. The client gets CHECKOUT_UNCONFIRMED and the order reference, with neutral bilingual guidance rather than an immediate-payment-retry instruction. Removed the superseded markPurchaseFailed helper. No database status rules were loosened.
4. Runtime staging no longer invents a merchant ID. An explicitly configured legacy WECHAT_MCH_ID is normalized when the canonical value is absent; unrelated builds still work with payments unconfigured, and runtime payment config rejects missing identity.
5. WeChat callback exceptions return a fixed failure rather than exposing internal provider/database messages.

## Validation actually executed

Pinned Node v24.19.0, focused suite: **86/86 passed**, no skipped/cancelled tests, runner duration **811.971167 ms**.

- website/tests/alipay-signature.test.mjs
- website/tests/alipay-notification.test.mjs
- website/tests/stage-runtime-env.test.mjs
- website/tests/pricing-checkout.test.mjs
- website/tests/monthly-credit-ledger.test.mjs
- website/tests/admin-observability.test.mjs
- website/tests/dashboard-navigation.test.mjs

Alipay tests use real production signing/verification/notification code, in-memory synthetic RSA keys and independent Node crypto signatures. Only Cloudflare bindings and database transport are substituted. The old signature implementation was also tested and rejects valid notifications in the new regression, establishing the original defect.

WeChat error/recovery route tests substitute the verification boundary. They establish routing and completion delegation, not actual WeChat RSA/AES callback interoperability. Separate real PGlite SQL tests establish idempotent credit delivery and 30-day grant semantics; repeated callback transport fixtures do not claim to prove SQL behavior by themselves.

TypeScript noEmit, scoped payment/backend/new-test ESLint and git diff --check passed. Broader lint of touched existing files still reports two pre-existing errors: react-hooks/immutability for refreshAccount declaration order in PassWiselySite.tsx and no-assign-module-variable in the pricing test loader. Both were independently reproduced from Git HEAD; neither was introduced by this repair. Existing image/dependency warnings remain. No new build or Linux production run was performed for these undeployed changes.

## Merchant-side preparation

Use the existing server-owned, untracked /home/jerry/codebase/passwisely/website/.env.production. Do not paste keys into chat or commit them.

Alipay: enable the computer website payment product, complete application review/publication, configure RSA2 ordinary public-key mode, and set ALIPAY_APP_ID, ALIPAY_SELLER_ID, ALIPAY_PRIVATE_KEY (application PKCS#8) and ALIPAY_PUBLIC_KEY (Alipay SPKI public key). Upload the matching application public key to Alipay; the application public key is not the Alipay verification key. Current code does not implement Alipay certificate mode.

WeChat: enable Native payment, explicitly set WECHAT_PAY_MCH_ID and WECHAT_PAY_APP_ID, and complete their binding in the merchant/account platform. Existing certificate, API v3 key and WeChat Pay public-key files can remain in their current server-owned locations if confirmed to belong to that merchant. Full canonical names and supported file configuration are in website/.env.example and website/README.md.

Callback endpoints:

- https://passwisely.com/api/payments/alipay/notify
- https://passwisely.com/api/payments/wechat/notify

After configuration, stage bindings through the existing production owner and deploy the reviewed payment fixes. Configuration presence alone is not real merchant acceptance.

## Remaining acceptance and functionality

- Actual product activation, app-to-merchant authorization and provider verification of configured keys have not been tested.
- Confirm actual outgoing notify/return origins are public HTTPS behind Wise's proxy during the first authorized checkout; this was not tested by creating a real order.
- Then validate each provider end to end with a human-operated, explicitly authorized purchase: provider receipt, signed callback, completed local order, exact credits, Dashboard/client balance and independent 30-day expiry. Current paid packs are RMB99/200 and RMB299/1000; do not bypass server prices for a test. The 20-credit free trial requires no payment.
- Repeat delivery must not duplicate credits or reset expiry. Test cancellation, callback delay, amount/merchant mismatch and page return separately; browser return is never payment proof.
- Active provider query, order closing, scheduled reconciliation/recovery and provider-money refunds are not implemented. Current frontend polls only the local order database. These need implementation/operating procedures before claiming reliable production collection. Existing credit-refund SQL handles AI consumption reversals, not Alipay/WeChat money refunds.
- Monthly packs are manually repurchased; no recurring debit/automatic-renewal product is requested by this implementation.

## Primary references consulted

- Alipay official SDK notification field rules: https://github.com/alipay/alipay-sdk-nodejs-all/blob/master/src/alipay.ts
- Alipay official trade notification documentation mirror (app, seller, order and amount verification): https://developer.alibaba.com/docs/doc.htm?articleId=105902&docType=1&source=search&treeId=193
- Alipay application onboarding: https://open.alipay.com/module/webApp
- WeChat Native onboarding and AppID binding: https://pay.wechatpay.cn/doc/v3/merchant/4015614538
- WeChat required development parameters: https://pay.wechatpay.cn/doc/v3/merchant/4013070756
- WeChat callback/query/reconciliation guidance: https://pay.wechatpay.cn/doc/v3/merchant/4012075249
