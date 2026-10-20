# PassWisely v2.0.0 revision 2 release verification

## Scope and pricing

Mac Apple silicon and Windows x64 share Recall V2 system/microphone capture, real-time transcription, interim/final source labels, pause/resume, transcript/screenshot/manual-question context, streaming answers, language catalogs and overlay UI. Windows shortcut labels use Ctrl/Alt. Intel Mac remains v1.2.6 without live audio because the shipped Recall native Mac binary is arm64-only.

- New-user trial: CNY 0 / 20 permanent welcome credits, once per new account.
- Pro: CNY 99 per manually renewed monthly pack / 200 credits.
- Unlimited: CNY 299 per manually renewed monthly pack / 1,000 credits. The name does not represent unlimited credits.
- Each paid pack expires independently 30 days after successful credit delivery. No automatic renewal. New purchases do not extend older grants; earlier expiry is consumed first.
- Existing permanent balances and pending orders retain their original rights. No retroactive welcome-credit adjustment.

## Source and ledger checks

- Desktop renderer/Electron assets compiled from `6f1779dc9bb74aebb79c13ca15e75f1f13d9e936`.
- Website/source candidate: `1303c5eed0949553321edd3642bddc94ad8ce884`.
- Node 24 source regression: 394/394 passed; renderer, Electron and website TypeScript checks passed.
- Real PostgreSQL PL/pgSQL ledger tests via isolated PGlite: 17/17 passed, including production-style default ACLs, legacy rights, independent expiry, payment replays, original-bucket refunds and permission boundaries. PGlite uses one connection; independent-connection lock contention was not measured.
- Production migration 0010 committed successfully. Exact function bodies/permissions, RLS, unchanged permanent balances and new PostgREST balance RPC were independently checked read-only. Only DDL metadata was backed up; no user rows or credentials were cloned.
- Pricing/checkout tests execute real production handlers with substituted payment transports; no real payment was submitted.

## Final installers

- Mac ARM64 DMG: 159709325 bytes; SHA-256 `e2492951c2c54941b3638b39a181e5b1738e1e171b1a8db85011b09b5e2f4973`.
- Developer ID team `VFF94RK9TN`, all 132 code targets trusted/timestamped/hardened; App and DMG notarized/stapled and accepted by Gatekeeper. The mounted App matches all 327 files/links of the independently checked App; 45 compiled assets match the build byte-for-byte. No localhost API override or root environment file is packaged.
- Windows x64 EXE: 123183203 bytes; SHA-256 `604cf3be66ed413da88f54cb1add56227a8ae390070453e96972cfdc56dbf2aa`.
- [Native Windows CI run 21](https://github.com/yejinchen-ai/passwisely/actions/runs/39417849334) succeeded: per-user NSIS install, installed Electron/Recall dependency import, uninstall and actual payload removal. App/installer Authenticode statuses are NotSigned.
- Archive digest matched GitHub's displayed digest; every listed artifact size and digest matched downloaded bytes.
- Revision 2 has an immutable `/releases/v2.0.0/r2/` object prefix. Earlier build evidence is retained under the parent evidence directory; it does not identify the final selected downloads.

Evidence: [Mac bundle](releases/2.0.0/r2/mac-bundle.json), [Mac DMG](releases/2.0.0/r2/mac-dmg.json), [Windows](releases/2.0.0/r2/windows-ci.json), [regression](releases/2.0.0/r2/local-regression.json), [production ledger](releases/2.0.0/r2/billing-migration.json).

## Publication status

Both final r2 installers are uploaded. Anonymous full-content GET SHA-256 verification passed for each, and the receipts reproduce the committed download catalog exactly. Website activation is awaiting the operator's Wise sudo authentication; the first invocation exited before any deployment transaction or service change. Current public download routes have not yet been switched. Only final installers were published; unused blockmaps/update feeds were not distributed.

Public-object evidence: [Mac receipt](releases/2.0.0/r2/oss-mac-r2-receipt.json), [Windows receipt](releases/2.0.0/r2/oss-windows-r2-receipt.json).

## Native verification limits

Mac audio, Chinese ASR, controls, language persistence and body click-through have prior recorded tests. In one user-operated Feishu whole-screen-share configuration both the previous PassWisely build and SystemContainer were absent at the receiving device while the underlying clock updated. This does not establish universal capture exclusion.

Windows device capture/ASR, actual mouse forwarding, ordinary toolbar foreground activation and meeting capture behavior require interactive Windows verification. Packaged Electron import checks do not prove those behaviors. The Windows installer is unsigned because no publisher certificate/service is available; this limitation is shown on the download page.
