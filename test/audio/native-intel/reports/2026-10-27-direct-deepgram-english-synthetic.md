# English synthetic Deepgram WSS smoke — 2026-10-27

Observed at **2026-10-27 03:28:53 UTC**. The actual `deepgram-en` two-route streaming smoke passed in **21.240 seconds**. This is synthetic file replay to the official service, not physical Intel audio capture or a general recognition accuracy result.

An earlier authorized attempt timed out during SSH before minting or WSS; after connectivity was confirmed and authorization renewed, one successful provider run was executed.

## Method and input

The already installed **Samantha en_US** voice synthesized two files locally with `/usr/bin/say -v Samantha -r 150 -o ... -f ...`; `/usr/bin/afconvert` converted them to mono 16 kHz signed 16-bit little-endian WAV. No voice was downloaded, no audio was recorded or played, and no native helper or Electron process was started.

The unchanged reusable harness loaded the production `createDeepgramOptions` and `createDeepgramTranscriptNormalizer` through the existing production TypeScript loader and used repository-root `ws` **8.22.0**. The validated public session metadata was `deepgram-en`, `en`, `nova-3`. Each route used a separate connection to `wss://api.deepgram.com/v1/listen`, with `interim_results=true`, `punctuate=true`, `endpointing=500`, `encoding=linear16`, `sample_rate=16000` and `channels=1`.

| Assigned synthetic route | Authored sentence | Input duration |
| --- | --- | ---: |
| synthetic-system-route | The blue notebook costs twenty dollars. | 2.331 s |
| synthetic-microphone-route | Use binary search and check both boundaries. | 2.800 s |

Each complete clip was replayed at media speed, finalized, paused for 12 seconds while only text `KeepAlive` messages were sent every 3 seconds, and replayed again after beginning a new normalizer epoch. The harness then finalized and sent `CloseStream`. The run stayed within its 55-second deadline.

One fixed HTTPS grant request on the authorized credential owner issued a 30-second temporary JWT. The permanent key stayed there. SSH stdout went only to an owned `0700` local directory and `0600` token file, which the harness unlinked on reading; the exit trap also cleaned up. The token file was confirmed absent after the run. No credential value, real account, authorization header or raw grant response is included in the report. There were no server file/configuration changes, deployments or billing-item creation.

## Observed protocol and timing

| Observation | synthetic-system-route | synthetic-microphone-route |
| --- | ---: | ---: |
| Socket opened after run start | 1.215 s | 1.215 s |
| First nonempty interim after initial PCM | 1.358 s | 1.364 s |
| First nonempty final after initial PCM | 3.159 s | 3.344 s |
| Nonempty normalized interim results | 4 | 4 |
| Nonempty normalized final results | 2 | 2 |
| Provider word entries across final results | 12 | 14 |
| Pause duration | 12.006 s | 12.007 s |
| Audio bytes sent during pause | 0 | 0 |
| Connection remained open across pause | yes | yes |
| KeepAlive / Finalize / CloseStream sent | 4 / 2 / 1 | 4 / 2 / 1 |
| Observed `from_finalize=true` responses | 2 | 2 |
| Close code | 1000 | 1000 |

First-result timings begin at initial PCM transmission and include the streaming/finalization behavior for these files. Both routes are finalized after the longer replay finishes. These observations are not end-to-end hardware latency or service guarantees. Provider word-entry counts are not billing tokens or distinct-word counts.

## Actual final text and limits

| Synthetic route | First replay final | Resumed replay final |
| --- | --- | --- |
| synthetic-system-route | `The blue notebook costs twenty dollars.` | `The blue notebook costs twenty dollars` |
| synthetic-microphone-route | `Use binary search and check both boundaries.` | `Use binary search and check both boundaries.` |

The expected words were observed for these two synthesized sentences in both passes; the second system-labeled final omitted its period. This limited observation does not establish general English recognition quality. **No WER or other error-rate measurement was performed.** The separate [Chinese result](2026-10-27-direct-deepgram-synthetic.md) retains its observed recognition errors.

The production normalizer preserved separate assigned source identities, with final rows `deepgram-system-1` / `deepgram-system-2` and `deepgram-microphone-1` / `deepgram-microphone-2`, in epochs 0 and 1. The synthetic labels establish file-routing behavior only, not hardware attribution. Media timestamps continued from the preceding clip without including the wall-clock pause.

## Provenance and unverified coverage

Source HEAD before the successful run: `0933a20a44e2053404bf06f7c85e25dc9606d71d`. Digests collected immediately after the run:

| Artifact | SHA-256 |
| --- | --- |
| Converted system WAV | `565f65119f406ac14ef9210f6bd6e7aaaa02fc9e6a0cef0abc9a6afafa8c8619` |
| Converted microphone WAV | `389c12f36ee4ac130987518ec138b043572d8b3200691d4c441a66b705021d49` |
| `electron/live/transcription.ts` | `a39cf07d6034339e9e451cd86251360ca116786579b3008abc15f0d9b908eb78` |
| `electron/live/DeepgramTranscript.ts` | `8ae52297bd3805b9d26f026de56697bccb5b96becbdffeed39300acc14348c37` |
| `direct-deepgram-smoke.mjs` | `fbecf24e89ea66d54a69d483675412ab5c783a5db868b350ebf72b2ca14bb649` |
| `mint-wise-token.mjs` | `d71e4584d0c7d7e7fae4459677068fc7d8f2aab860f70dbc2aa48fe54d11f73c` |
| Private JSON result (no credentials) | `a9ef838b37aefd92343e100df82dc6dd6d94d9a7e6d66a5a8bd0696c98487df2` |

Generated audio and the private JSON result remain temporary artifacts, not Git content. This run did not exercise physical microphone/system capture, TCC permissions, the native helper, Electron, a signed/notarized Intel package, a real conversation or a connection beyond JWT expiry. A clean transport result cannot establish those capabilities.

Official protocol references: [streaming STT](https://developers.deepgram.com/reference/speech-to-text/listen-streaming), [KeepAlive](https://developers.deepgram.com/docs/audio-keep-alive), [Finalize](https://developers.deepgram.com/docs/finalize), [temporary token authentication](https://developers.deepgram.com/reference/auth/tokens/grant).
