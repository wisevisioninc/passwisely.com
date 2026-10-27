# Read-only public service route verification

Run from the repository root with Node.js 22 or later and its installed dependencies:

```sh
node test/network/verify-service-routes.mjs \
  --origin HTTPS_ORIGIN --grpc HOST:PORT --out NEW_REPORT.json
```

Choose the explicit origin and TLS gRPC authority from the application's verified
`serviceEndpoints` owner; this script has no domain default. `--dry-run` checks
arguments, the real `website/lib/downloads.ts` catalog owner and repository proto
without network. `--timeout-ms` controls each request (default 15000; 1000–60000).
The output must be a new file; reports contain public routes, catalog metadata,
public certificate facts, typed failure codes and timings, without response bodies.

Checks: trusted HTTPS homepage and hero, HTTP port 80 redirect preserving path and
query, unauthenticated account/Recall/Deepgram/AI HTTP rejection, three download
HEAD redirects matching the local catalog version/SHA/URL, and real TLS gRPC
Health plus unauthenticated Chat/ChatStream rejection. Download redirects use
`/api/download`, whose explicit HEAD handler is read only; `/api/track-download`
is deliberately excluded because it records database events. gRPC sends empty
requests with no authorization metadata; the current server's `relayRequest`
rejects missing authorization before request parsing or provider relay.

The script accepts no credentials and does not register users, create purchases,
start audio, request ASR tokens or call a model. Successful authentication guards
and public routing do not establish paid model/audio operation or payment
acceptance. It does not follow artifact redirects or download installers; run the
separate full artifact digest checks when publishing new files.
