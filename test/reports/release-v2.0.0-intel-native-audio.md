# Intel v2.0.0 native-audio candidate — 2026-10-27

Status: **built and independently verified; not published or accepted for physical capture**. Public Intel downloads still use the r3 artifact and its `not_included` live-audio notice. No production deployment or public catalog change was performed for this candidate.

## Candidate and source

- Desktop version: `2.0.0`, immutable local revision `r4`.
- Desktop source: `66866f3a44f7cb787f49ec9efe9f4809b2826818`.
- Local installer: `release/v2.0.0/r4/PassWisely-macOS-x64.dmg` (ignored build output).
- Installer size: `119246394` bytes.
- SHA-256: `66c982d013b0814d8501123543f9300d7e31e9072a5db5107752021dcf914fa4`.
- Build source archive, dependencies and compiled output were isolated from the shared ARM development installation. Production dependencies came from the lockfile for darwin/x64, with scripts disabled; ws is pinned to 8.22.0.
- The completed build took 330.987 seconds for the builder/signing/notarization step, plus 8.288 seconds for dependency installation and asset compilation. These are elapsed observations for this run, not performance guarantees; CPU, memory and token costs were not measured.

The Intel path uses ScreenCaptureKit system audio and AVAudioEngine microphone capture on macOS 13+, converted separately to 16 kHz mono S16LE PCM. It connects directly to Deepgram Nova-3 with English/Chinese profiles. Recall capture remains the existing path for Apple Silicon and Windows. Native permissions are prepared before issuing the 30-second ASR connection token; preparation does not record. Pause stops input and drains admitted audio/converter tails, then finalizes transcription; resume preserves the selected language and separates transcript epochs. End/dispose retains resource ownership until actual child/socket closure. Source tests establish these contracts, not physical hardware behavior.

## Executed verification

| Check | Observed result | Scope |
| --- | --- | --- |
| Desktop regression | 356 / 356 passed, 22.051 s | Includes native helper, resampling/EOS/format switch, session integration, IPC/UI contracts, permission cancellation and cleanup |
| Canonical website regression | 251 / 251 passed, 2.389 s | Includes new broker and existing payment/account tests; simulated upstream where applicable |
| Root and Electron TypeScript | Passed | No-emit source checks |
| Isolated release website | 231 / 231 tests, full website tsc, 15 / 15 deploy-owner tests passed | Excludes the intentionally unpublished WeChat branch; first sandbox-only localhost failures passed with permitted loopback access |
| App code | 17 pure x86_64 Mach-O leaves, 26 unique signature targets | Every leaf/bundle verified for Developer ID team, hardened runtime, timestamp and strict signature |
| App and DMG | Accepted | Team VFF94RK9TN, valid stapled notarization tickets and Gatekeeper acceptance; hdiutil image verification passed |
| DMG mount | 215 files/links identical to the output App; App/ASAR version 2.0.0 | Mounted read-only; owned disk was detached and mount directory removed |
| Signed native helper | `stop` + EOF, exit 0, only `state: ended`, 0.1267 s | Actual x86_64 binary under Rosetta; no prepare/start, TCC prompt or recording |
| Packaged Intel runtime | Passed under Rosetta | Actual x64 Electron 29.4.6 / Node 20.9.0 imported ws, native adapter and normalizer; Canvas pixel/PNG and synthetic PDF text extraction passed; no Recall initialization or network |

The helper's real code-signing identifier is `com.passwisely.desktop.audio-helper`, with the audio-input entitlement. The ASAR entry and native adapter/normalizer/selection modules matched the pinned build staging bytes. Runtime import tests prohibited child launches and network access. PDF extraction retained existing font/polyfill warnings; only the stated synthetic text case was verified.

Detailed local receipts are retained alongside the ignored installer and in `/private/tmp/passwisely-intel-native-package-verification-txqo7l08`. The candidate readiness receipt explicitly records unverified physical capture and undeployed broker status.

## Real upstream synthetic ASR

The [Chinese synthetic replay report](../audio/native-intel/reports/2026-10-27-direct-deepgram-synthetic.md) records two actual official Deepgram WSS streams. Both returned interim/final text, stayed connected across a 12-second pause with zero PCM and KeepAlive, finalized twice, and closed normally. First interim observations were 1.387 / 1.415 seconds from initial PCM, and first final observations were 4.887 / 4.969 seconds. These are fixture-specific ASR timings, not microphone-to-UI latency.

The replay contained wrong words and omitted text. No WER or general accuracy claim is made. Routing labels were synthetic; neither native helper nor physical system/microphone source attribution was tested by this replay. The temporary JWT was deleted; the permanent key remained on its server.

An [English replay attempt](../audio/native-intel/reports/2026-10-27-direct-deepgram-english-synthetic.md) stopped at SSH connection timeout before token minting or any WSS connection. English runtime options are covered by source tests; real English ASR remains unverified in this run.

## Backend preparation and remaining acceptance

A separate release branch `codex/intel-native-audio-web` at `61be2bd510697f71588c798a5778b0de9516c759` contains only the new broker/profile contracts and the reviewed web deploy owner on top of the active download source. The approved d48 base remains an ancestor and pending WeChat commit 35a12a3 is not an ancestor. The live Wise main checkout was not changed.

Its public-only web bundle has 43 files / 5345122 bytes, manifest SHA-256 `5fccd471e822fdb855ae3c77d201afe51905fe83a53966c98af2d29511372315` and tree fingerprint `569cbadd0faf096b5a323723e479a68cc8b947d5e5293bde8df2f0963e5e5352`. Deployment must preserve the existing Wise runtime binding bytes; no long-lived Deepgram key goes to the Mac installer or separate frontend host.

An SSH upload attempt failed during connection establishment to Wise port 22, before writing the archive or starting an instance. A bounded read-only reconnect also timed out; the separate frontend at its existing IP remained HTTP 200. No production service, configuration, payment flow or download changed. The public domain HTTPS issue recorded by the earlier release is also unresolved; no DNS/TLS bypass was introduced.

Remaining work:

1. Restore authorized Wise SSH connectivity, stage the reviewed broker privately, and verify its real authenticated route.
2. Accept a bounded native system-audio/microphone test, including real partial/final UI output, pause/resume and resource release. The current Mac is Apple Silicon; Rosetta evidence must remain distinct from physical Intel hardware. Physical Intel availability is not yet confirmed.
3. Complete real English ASR acceptance after connectivity returns.
4. Upload the immutable signed installer, then update the shared catalog and deploy backend/frontend through the reviewed owners. Only accepted evidence may justify removing the public no-audio notice. Keep all platforms at the user-requested desktop version 2.0.0.

A native UI binding attempt timed out; process inspection found the earlier 1.3.0 test app still running. This does not establish that the new candidate GUI launched. It was not force-terminated and recording was not started.
