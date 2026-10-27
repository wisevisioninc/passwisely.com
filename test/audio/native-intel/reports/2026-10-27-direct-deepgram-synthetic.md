# Direct Deepgram synthetic WSS smoke — 2026-10-27

Observed at **2026-10-27 02:53:22 UTC**. The two-route streaming protocol smoke passed in **24.579 seconds**. This is file replay to the real Deepgram service, not a physical Intel audio capture test or an accuracy acceptance result.

## Method and scope

The harness loaded the production `createDeepgramOptions` and `createDeepgramTranscriptNormalizer` through the existing production TypeScript loader. It used the repository-root `ws` **8.22.0**, `deepgram-zh`, Nova-3, Chinese, `interim_results=true`, `punctuate=true`, `endpointing=500`, and raw mono 16 kHz signed 16-bit little-endian PCM. Each synthetic route had a separate connection to `wss://api.deepgram.com/v1/listen`.

The existing Tingting synthetic WAVs were converted from 22,050 Hz to 16,000 Hz using `afconvert`, written only to a new private temporary directory, and never played. Each full clip was sent twice at media speed. Between the two passes, the harness sent `Finalize`, withheld PCM for 12 seconds while sending text `KeepAlive` every 3 seconds, began a new normalizer epoch, and resumed the same file. It then finalized and sent `CloseStream`.

A permanent API key stayed on its authorized credential-owning host. One successful fixed HTTPS grant request issued a 30-second temporary JWT; SSH stdout went directly to an owned `0700` Mac directory and `0600` file. The harness unlinked that validated file when read, and an exit trap provided cleanup. The token file was absent after completion. No key, token, real account, authorization header or server response body is included here or in the JSON result. There were no server file/configuration changes, deployments or billing-item creation.

## Observed protocol and timing

| Observation | synthetic-system-route | synthetic-microphone-route |
| --- | ---: | ---: |
| Input duration | 3.624 s | 4.529 s |
| Socket opened after run start | 1.165 s | 1.171 s |
| First nonempty interim after initial PCM | 1.387 s | 1.415 s |
| First nonempty final after initial PCM | 4.887 s | 4.969 s |
| Nonempty normalized interim results | 8 | 7 |
| Nonempty normalized final results | 2 | 2 |
| Provider word entries across final results | 21 | 18 |
| Pause duration | 12.005 s | 12.006 s |
| Audio bytes sent during pause | 0 | 0 |
| Connection remained open across pause | yes | yes |
| KeepAlive / Finalize / CloseStream sent | 4 / 2 / 1 | 4 / 2 / 1 |
| Observed `from_finalize=true` responses | 2 | 2 |
| Close code | 1000 | 1000 |

First-result timings are wall-clock observations from the initial PCM transmission, including streaming and finalization behavior for these files. Both routes are finalized after the longer first replay finishes. They are not end-to-end hardware capture measurements or service latency guarantees. Provider word-entry counts are not billing tokens, distinct-word counts or an error-rate measurement.

## Actual final text and recognition limits

| Synthetic route | Authored spoken script | First replay final | Resumed replay final |
| --- | --- | --- | --- |
| synthetic-system-route | 面试官问：数组可以包含负数吗？ | `面世观稳,数组可以包含负数吗?` | `是官稳数组可以包含负数吗` |
| synthetic-microphone-route | 可以。先处理空数组，再检查左右边界。 | `先处理空数组,再检查左右边界,` | `先处理空数组再检查左右边界` |

The system-labeled route misrecognized “面试官问”; both microphone-labeled outputs omitted the opening “可以。” Punctuation also differed. These observations do not pass an accuracy acceptance criterion. **No WER or other error-rate measurement was performed.**

The production normalizer assigned separate `system` and `microphone` identities to the explicitly supplied synthetic routes. The replayed final rows were `deepgram-system-1` / `deepgram-system-2` and `deepgram-microphone-1` / `deepgram-microphone-2`, in capture epochs 0 and 1. These labels establish file-routing behavior only; they do not prove which hardware source generated audio. Deepgram media timestamps continued from the preceding clip rather than including the 12-second pause.

## Provenance

Source HEAD observed immediately after the run: `66866f3a44f7cb787f49ec9efe9f4809b2826818`. The harness/report were local additions at execution time. File digests collected immediately after the run:

| Artifact | SHA-256 |
| --- | --- |
| Converted system WAV | `e686e4a3acf24ad31e93908e3a884b46327e2ec6637d6d9c9723fe3279ab07e1` |
| Converted microphone WAV | `a503c9c66514bead8de02694871c94957a25683c51ef4d15eaaf7d0a41c1f948` |
| `electron/live/transcription.ts` | `a39cf07d6034339e9e451cd86251360ca116786579b3008abc15f0d9b908eb78` |
| `electron/live/DeepgramTranscript.ts` | `8ae52297bd3805b9d26f026de56697bccb5b96becbdffeed39300acc14348c37` |
| `direct-deepgram-smoke.mjs` | `92f0b75af401fd4fe4267c3bc5b521e4d7d9db66dfb2a341df58a02563a6b24c` |
| `mint-wise-token.mjs` | `d71e4584d0c7d7e7fae4459677068fc7d8f2aab860f70dbc2aa48fe54d11f73c` |
| Private JSON result (no credentials) | `796c2af7bb9bbe07856335dd098674aa212ad286b4c769c104ea1c498af80359` |

The original inputs were `test/audio/recall-chinese/generated/03-simultaneous-system-and-microphone-system.wav` and `04-simultaneous-system-and-microphone-microphone.wav`. Converted audio and the private JSON result remain temporary artifacts and are not committed.

## Unverified coverage

This run did not exercise a microphone, macOS system audio, TCC permissions, the native helper, Electron, helper signing/notarization, a packaged Intel application, or any real conversation. It did not verify an English speech fixture or a connection lasting beyond JWT expiry. A clean transport result cannot establish those capabilities.

Deepgram documents that KeepAlive should use text frames during silence and that `from_finalize` may be absent when nothing substantial remains buffered. Both are treated as protocol observations here. See [KeepAlive](https://developers.deepgram.com/docs/audio-keep-alive), [Finalize](https://developers.deepgram.com/docs/finalize), and [temporary token authentication](https://developers.deepgram.com/reference/auth/tokens/grant).
