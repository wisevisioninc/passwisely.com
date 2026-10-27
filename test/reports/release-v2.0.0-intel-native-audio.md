# Intel v2.0.0 r4 native audio — 2026-10-27

Status: **signed/notarized, user-reported functionality accepted, and immutable installer published; website/API awaiting manual sudo; frontend staged, not activated**. The r4 OSS object was created successfully and its complete public GET matched the verified installer size and SHA-256. The final web candidate is prepared and staged; the required user-run sudo step has not been completed and no activation receipt is available. This status does not claim a completed public rollout or verification of the desktop's default public HTTPS chain.

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
| Final web candidate preparation | Linux owner 15 / 15 verification/preparation checks passed | Prepared candidate; activation pending final receipt |
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

## Published binary and pending website/API activation

The final web source is `f9ac989780d7349c8ef77126b3a76587447ea112`. Its public-only compiled bundle contains **43 files / 5344747 bytes**, with manifest SHA-256 `6b33eaa19b0b7fa7e0a3b349a9d593a23ca77e0763efb73fca273a8e662d84c4` and tree fingerprint `d60644b606979db199835decf670d7d34d7bd62347839af449309bb390024a56`. The final Linux deploy owner completed its 15 verification/preparation checks; this is preparation evidence, not activation.

Wise SSH connectivity has recovered. A disk-full preparation blocker was resolved by clearing 781921012 bytes of redownloadable npm cache; 578445312 bytes of free space were then observed. Existing runtime binding values must remain protected, and no long-lived Deepgram key is included in the Mac artifact or separate frontend host.

Earlier SSH/upload and native-UI binding attempts failed or timed out; they did not establish successful activation or capture.

| Release closure | Current evidence |
| --- | --- |
| Immutable r4 installer OSS publication | Complete; object created and full public GET size/SHA-256 verified |
| Broker / website API activation | Waiting for the user-run sudo step; not activated |
| Final frontend bundle | Prepared, verified and staged; not activated |
| Latest public POST to `/api/desktop/deepgram/token` | 404 before activation; a successful authenticated broker response is not established |
| Shared catalog/public download mapping | Final activation receipt pending |
| Post-activation service and route checks | Pending |

The installer identity is established above. Website/API activation awaits the user-run sudo step because noninteractive sudo is unavailable. That manual step is still outstanding, and the staged frontend has not been switched. The latest pre-activation public POST probe returned 404; post-activation service and authenticated-route checks remain pending. No completed rollout is asserted until the activation receipt establishes source/manifest/tree identity and post-activation checks. All public desktop platforms retain version 2.0.0; immutable revisions may differ.

## Existing public HTTPS limitation

The public-domain HTTPS port **443 still refuses connections**, while the IP homepage responds **HTTP 200**. This is an existing endpoint limitation, distinct from package verification, the user's functionality report and the synthetic direct-ASR results. It means the desktop default public HTTPS account/token chain has **not** been verified end to end through that endpoint. No DNS, TLS or application-code change was made or inferred as a remedy.
