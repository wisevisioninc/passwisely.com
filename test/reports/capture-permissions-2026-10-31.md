# Screenshot diagnosis and capture permission onboarding — 2026-10-31

Status: implementation and source regression prepared; package and physical-device acceptance are recorded separately when completed.

## Reported failure and confirmed defect

The user reports Intel macOS 11.7.10, ⌘H, no external display, with “Screenshot capture failed”. A simulated string rejection through the actual TypeScript capture/shortcut boundary reproduces that generic text: Electron 29 can reject `desktopCapturer.getSources` with a string, while the old shortcut path only retained `Error.message`. This establishes an error-reporting defect, **not the underlying reason the user's native screenshot failed**. The new boundary preserves native reason, capture stage and observed OS screen status, including a capture plus visibility-restoration failure. Only a confirmed denied/restricted screen state invokes the permission recovery guide; storage/unknown errors do not become inferred permission denial.

The actual r5 Intel package was read-only inspected: App 2.0.0, Electron 29.4.6, minimum macOS 10.15, three capture usage descriptions, SHA-256 `938e2c785916b12ded9fc547ab9fff076ef4a7196335fe635a82e4ae3e6923ca`. Electron/Chromium source supports the legacy screenshot path on Big Sur. The Intel real-time audio helper separately requires macOS 13+. No screenshot OS requirement was raised and no unsupported audio helper is launched by the Big Sur guide. Physical Big Sur capture still requires the new candidate's diagnostics and the user's OS authorization result.

## SystemContainer shipped-artifact analysis

Used the reverse-engineer-anything skill and REA CLI 6.4.0 on `/Applications/systemcontainer.app/Contents/Resources/app.asar`, version 3.0.1, 206100163 bytes, SHA-256 `528ea903d8dc6a1b42331ae7658689ab39e37fe63c09eef242475b2fa978fd78`. This is static evidence; no target app execution, OS permission reset, recording or injection occurred.

[Evidence index](systemcontainer-permissions-evidence-2026-10-31.json) retains source member ranges and digests plus limitations. Main Evidence `ev_f5c6b6b7728794d2dd1868927334d4f777680132f67f21c193abe6ad9dc03db3`; focused renderer Evidence `ev_e6633160cf72687bec86f15f766ed2c32d7fa6bfecc9803ca97904a09e4bc212`.

Source observations: separate screen/microphone grant rows; microphone asks only from not-determined; denied requests lead to OS privacy settings; first-run marker records completing onboarding. macOS screenshot failures reset onboarding. A quit/restart page exists, but the inspected action only quits and runtime reachability was not established. The screen probe treats promise completion as success and focus sets an attempt flag; neither is proof of actual authorization. Recall startup configuration and the separate Mac system-audio helper were identified; native internal behavior was not examined. Selected graph coverage is partial, not a complete program behavior claim.

## PassWisely behavior

- First-run guide before login, Settings re-entry and confirmed screenshot-permission failure recovery; continuing only records guide acknowledgement. OS consent remains the user's action after installation.
- Screen and microphone states freshly queried on return. SDK/helper observations retain status and time; absent evidence stays unknown. Opening settings, request acknowledgement and a nonempty probe never rewrite OS consent as granted.
- Explicit screen test requests screen-source 1×1 thumbnails, validates the selected display, discards them, writes no image and queues/uploads nothing. Normal screenshots still use the existing screenshot owner.
- Audio preflight shares the actual capture owner and its cleanup path. It makes no account/broker/token call and issues no recording or upload command. Recall initialization can start the SDK native process and meeting detection; closed native internals were not proven zero-network or zero-transient-sampling. Installed SDK JS/API contract is the inspected boundary.
- Mac ARM uses Recall; Mac Intel uses the existing native helper with macOS 13+ audio gate; Windows guides OS desktop-microphone and device settings without macOS-specific permission APIs. Permission preparation retains ownership on cleanup failure and blocks competing capture/restart.
- Auth/guide layout and live overlay geometry have explicit owners. Showing a hidden window no longer replays obsolete pre-guide bounds. Known compound visibility failures retain both operation and cleanup messages.

Japan Recall region was verified by reading only the deployment region identifier (`ap-northeast-1`) on Wise. No key/token was read or copied for onboarding. Recording still uses broker-returned region; the permission-only public region allowlist is independently configurable.

## Verification and limits

Final desktop source regression: **419/419 passed, 22.332 seconds**. Root and Electron no-emit TypeScript checks and `git diff --check` passed. Source tests use mocked permission/capture dependencies and isolated temporary state; no physical capture acceptance is inferred. One existing desktop-stream test loader initially failed to resolve the earlier `../shared/kimi` import; its relative import resolution was corrected and its actual streaming tests rerun. No product Kimi behavior changed.

[Reusable manual cases](../permissions/README.md) cover first launch, Big Sur ⌘H, denied/return, both Mac audio providers, Windows, cleanup and upgrades. Mocked source checks do not establish native TCC prompts, physical Intel capture, actual Windows privacy behavior or screen-share visibility. Browser visual verification was initially blocked by the locked Mac; no visual pass is inferred.

Primary compatibility references: [Electron 29 capture wrapper](https://raw.githubusercontent.com/electron/electron/v29.4.6/lib/browser/api/desktop-capturer.ts), [Electron native capturer](https://raw.githubusercontent.com/electron/electron/v29.4.6/shell/browser/api/electron_api_desktop_capturer.cc), [Chromium 122 Mac capturer](https://raw.githubusercontent.com/chromium/chromium/122.0.6261.156/chrome/browser/media/webrtc/thumbnail_capturer_mac.mm), [Recall macOS permissions](https://docs.recall.ai/docs/macos-permissions).
