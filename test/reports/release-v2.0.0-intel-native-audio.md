# Intel v2.0.0 r4 native audio — 2026-10-27

Status: **signed/notarized, user-reported functionality accepted, and immutable installer published; Wise website/API and frontend active, with release health checks passed**. The r4 OSS object was created successfully and its complete public GET matched the verified installer size and SHA-256. The user completed the Wise activation step; the release owner independently verified both active transactions, pinned source/bundle identity and public-IP download/API health. The existing public-domain HTTPS connection refusal remains unresolved, and the desktop's default public HTTPS chain has not been independently verified with a real account.

## Artifact and source

- Desktop version: `2.0.0`, immutable revision `r4`.
- Desktop source: `66866f3a44f7cb787f49ec9efe9f4809b2826818`.
- Local installer: `release/v2.0.0/r4/PassWisely-macOS-x64.dmg` (ignored build output).
- Installer size: `119246394` bytes.
- SHA-256: `66c982d013b0814d8501123543f9300d7e31e9072a5db5107752021dcf914fa4`.
- Binary publication: `binaryPublished=true`; OSS receipt `created=true`, `119246394` bytes, with a full public GET matching the SHA-256 above. The credential owner retains `oss-r4-receipt.json` under the private `release-incoming/v2.0.0-intel-audio-r4-66866f3` release directory.
- Build source archive, dependencies and compiled output were isolated from the shared ARM development installation. Production dependencies came from the lockfile for darwin/x64, with scripts disabled; ws is pinned to 8.22.0.
- The completed build took 330.987 seconds for builder/signing/notarization, plus 8.288 seconds for dependency installation and asset compilation. These are elapsed observations for this run, not performance guarantees; CPU, memory and token costs were not measured.

The Intel path uses ScreenCaptureKit system audio and AVAudioEngine microphone capture on macOS 13+, converted separately to 16 kHz mono S16LE PCM. It connects directly to Deepgram Nova-3 with English/Chinese profiles. Recall remains the existing capture path for Apple Silicon and Windows. Permissions are prepared before issuing the 30-second connection token; preparation does not record. Pause stops input, drains admitted audio/converter tails and finalizes transcription; resume preserves language and separates transcript epochs. End/dispose retains ownership until actual child/socket closure. Source tests establish these contracts; user-reported acceptance is attributed separately below.

## Executed verification

| Check | Observed result | Scope |
| --- | --- | --- |
| Desktop regression | 356 / 356 passed, 22.051 s | Native helper, resampling/EOS/format switch, session integration, IPC/UI contracts, permission cancellation and cleanup |
| Canonical website regression | 251 / 251 passed, 2.389 s | New broker and existing payment/account tests; simulated upstream where applicable |
| Root and Electron TypeScript | Passed | No-emit source checks |
| Isolated release website | 231 / 231 tests, full website tsc, 15 / 15 deploy-owner tests passed | Excludes the intentionally unpublished WeChat branch; localhost checks required permitted loopback access |
| Final web candidate preparation | Linux owner 15 / 15 verification/preparation checks passed | Final source/bundle subsequently activated on Wise and the frontend |
| Wise runtime activation | Transaction active; source/tree matched final pins; public broker POST returned 401 / `UNAUTHORIZED` | Unauthenticated routing/guard check only; no real-account grant or provider call |
| Frontend runtime activation | Transaction active; 3 homepage and 24 static-asset health checks passed | Pinned bundle; unit unchanged; zero configuration/backend writes; `PUBLIC_SITE_URL`-only binding |
| Independent public-IP download/API checks | 10 / 10 passed, 1.310 s | Three catalog redirects and OSS sizes matched; Deepgram/Recall/AI rejected unauthenticated POSTs; checkout rejected GET; no provider calls or orders |
| Chinese download page in an actual browser | Intel v2.0.0, macOS 13 notice and r4 checksum visible; obsolete no-audio notice absent | Release-owner visual check; does not establish physical audio capture |
| Immutable installer OSS object | Created; full public GET matched 119246394 bytes and the pinned SHA-256 | Confirms binary publication, not website/API activation |
| App code | 17 pure x86_64 Mach-O leaves, 26 unique signature targets | Every leaf/bundle verified for Developer ID team, hardened runtime, timestamp and strict signature |
| App and DMG | Accepted | Team VFF94RK9TN; valid stapled notarization tickets, Gatekeeper acceptance and hdiutil image verification |
| DMG mount | 215 files/links identical to output App; App/ASAR version 2.0.0 | Mounted read-only; owned disk detached and mount directory removed |
| Signed native helper | `stop` + EOF, exit 0, only `state: ended`, 0.1267 s | Actual x86_64 binary under Rosetta; no prepare/start, TCC prompt or recording |
| Packaged Intel runtime | Passed under Rosetta | x64 Electron 29.4.6 / Node 20.9.0 imported ws, native adapter and normalizer; Canvas pixel/PNG and synthetic PDF extraction passed; no Recall initialization or network |

The helper's signing identifier is `com.passwisely.desktop.audio-helper`, with the audio-input entitlement. ASAR entry and native adapter/normalizer/selection modules matched pinned build-staging bytes. Runtime import checks prohibited child launches and network access. PDF extraction retained existing font/polyfill warnings; only the stated synthetic text case was verified.

Local package receipts remain alongside the ignored installer and in `/private/tmp/passwisely-intel-native-package-verification-txqo7l08`. Their original candidate-readiness status predates the later user feedback and web preparation; it is not a current public-activation receipt.

## User-reported acceptance

The user identified the tested package as the Intel v2.0.0 r4 audio candidate and reported **“功能正常”**. This records user acceptance of that package's functionality. It is **user-reported evidence, not an agent-run physical Intel test**. The user did not provide an OS version, hardware model or individual microphone/system-audio, language, pause/resume, permission or cleanup test results; none are inferred here.

## Real upstream synthetic ASR

The [Chinese synthetic replay](../audio/native-intel/reports/2026-10-27-direct-deepgram-synthetic.md) exercised two actual official WSS streams. Both returned interim/final text, stayed connected through a 12-second zero-PCM KeepAlive pause, finalized twice and closed normally. First interim observations were 1.387 / 1.415 seconds from initial PCM; first finals were 4.887 / 4.969 seconds. Recognition contained wrong words and omitted text.

The [English synthetic replay](../audio/native-intel/reports/2026-10-27-direct-deepgram-english-synthetic.md), recorded in commit `65a7809733718144ee13598cf683179d8f631a37`, passed in 21.240 seconds with `deepgram-en` / Nova-3 / `en`. Each route returned four nonempty interim and two final results; a 12-second pause sent zero PCM, KeepAlive retained the connections, both streams finalized twice and closed with code 1000. First interims were 1.358 / 1.364 seconds, and first finals 3.159 / 3.344 seconds. Both passes returned the expected words for the two authored sentences; the resumed system-labeled final omitted its final period.

These are fixture-specific file-replay observations, not microphone-to-UI latency or physical source attribution. Neither replay started the native helper or recorded system/microphone audio. No WER or general accuracy claim is made. Temporary JWTs were deleted and permanent keys stayed on the credential owner.

## Published binary and active website/API

The final web source is `f9ac989780d7349c8ef77126b3a76587447ea112`. Its public-only compiled bundle contains **43 files / 5344747 bytes**, with manifest SHA-256 `6b33eaa19b0b7fa7e0a3b349a9d593a23ca77e0763efb73fca273a8e662d84c4` and tree fingerprint `d60644b606979db199835decf670d7d34d7bd62347839af449309bb390024a56`. The final Linux deploy owner completed its 15 verification/preparation checks. The later Wise and frontend activations and independent verification matched the final source, manifest and tree pins.

Wise SSH connectivity has recovered. A disk-full preparation blocker was resolved by clearing 781921012 bytes of redownloadable npm cache; 578445312 bytes of free space were then observed. The activation preserved the protected 6742-byte runtime binding exactly. Nginx hash, the live Wise main checkout at `35a12a3`, and the desktop API were unchanged. No binding values are included here, and no long-lived Deepgram key is included in the Mac artifact or separate frontend host.

Earlier SSH/upload and native-UI binding attempts failed or timed out; they did not establish successful activation or capture.

| Release closure | Current evidence |
| --- | --- |
| Immutable r4 installer OSS publication | Complete; object created and full public GET size/SHA-256 verified |
| Broker / website API activation | Active; user-run sudo completed and transaction identity independently verified |
| Final frontend bundle | Active; transaction matched source/manifest/tree and 3 homepage + 24 asset health checks passed |
| Latest public POST to `/api/desktop/deepgram/token` | 401 / `UNAUTHORIZED`; route and unauthenticated guard verified |
| Shared catalog/public download mapping | All three HEAD routes returned 307, version 2.0.0 and catalog SHA-256; target OSS HEAD returned 200 with matching bytes |
| Post-activation checks | Wise/frontend identities, homepage/assets and 10 public-IP download/API checks passed; Chinese page visually checked |

The Wise repository-relative receipt is `website/.release-backups/v2.0.0-20261027T073925Z-a6c7804d/transaction.json`, SHA-256 `9b3d5ac9fb486268a88dc687c33f85cd2a9da306f0ad345051fe996d68d37524`. Its status is active and its source/tree match the pins above. The active frontend receipt is `/opt/passwisely/.frontend-release-backups/20261027T081132Z-16bc8f3344444c519ea0402d1c4fe728/transaction.json`; it matches the source/manifest/tree and records the unchanged unit SHA-256 `695d11eff3a960be95bc103b814b1b96fa93e53da2fb998d2e8719842617ab56`, zero configuration writes and zero backend writes. The frontend binding contains only `PUBLIC_SITE_URL`.

The independent post-activation report is `/private/tmp/passwisely-r4-public-readonly-verification-20261027-j2wcqdtv/public-verification.json`. It checked the public IP endpoint: three download HEAD responses matched catalog version, SHA-256 and immutable OSS location; three OSS HEAD responses matched the catalog size. Deepgram, Recall and AI unauthenticated POSTs returned 401, and checkout GET returned 405. It did not follow redirects, download artifacts, recompute OSS SHA-256 or create download-tracking events; the complete r4 public GET checksum was verified earlier by the upload owner. The Chinese browser check observed Intel v2.0.0, the macOS 13 notice and the expanded checksum beginning `66c982`, with no obsolete no-audio notice.

These activation checks did not record audio, use real-account credentials, create orders or call a provider. The 401 responses establish routing and the unauthenticated guards; they do not establish successful authenticated grants. All public desktop platforms retain version 2.0.0; immutable revisions may differ.

## Existing public HTTPS limitation

The public-domain HTTPS port **443 still refuses connections**, while the IP homepage responds **HTTP 200**. This is an existing endpoint limitation, distinct from package verification, the user's functionality report and the synthetic direct-ASR results. It means the desktop default public HTTPS account/token chain has **not** been verified end to end through that endpoint. No DNS, TLS or application-code change was made or inferred as a remedy.
