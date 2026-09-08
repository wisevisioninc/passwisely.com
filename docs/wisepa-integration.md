# WisePA shared OpenAI integration

PassWisely's server-owned OpenAI channel can use `https://wisepa.cn/v1` with model `gpt-5.6-sol`. WisePA's New-API layer authenticates the API key, selects its group/channel and forwards to its existing Sub2API upstream. Do not use a Sub2API key directly at the WisePA endpoint.

## Configuration and isolation

- Admin settings: `ai_default_provider=openai`, `ai_default_model=gpt-5.6-sol`, `ai_base_url_openai=https://wisepa.cn/v1`, and an encrypted `ai_api_key_openai`.
- Website server environment fallback: `AI_DEFAULT_PROVIDER`, `AI_DEFAULT_MODEL`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`.
- The key in the repository-root `.env` is only the input to the explicit server configuration script. It is not automatically exposed to the web application.
- Only the server-owned default key uses the configured gateway. Personal OpenAI keys sent by clients continue using the official catalog endpoint.
- Base URLs are restricted to the exact official OpenAI and WisePA HTTPS endpoints; credentials in URLs, private hosts and lookalike domains are rejected.
- GPT-5 requests translate legacy `max_tokens` to `max_completion_tokens`, omit incompatible sampling controls, default to low reasoning effort and request JSON HTTP responses rather than SSE.
- Existing desktop shared/default requests already read the server's default provider/model, so this server-only integration does not require a new desktop installer. A client's personal-key ChatGPT mode remains separate.

After deploying the gateway-aware website build, run `node scripts/configure-wisepa.mjs` from `website` on wise. The script probes the gateway before activation, saves protected configuration backups under `~/.config/passwisely/backups`, writes the key through the authenticated admin API (AES-GCM encryption in Supabase), verifies the saved settings, and updates server fallback variables. Run `node scripts/stage-runtime-env.mjs` afterward for the existing Wrangler runtime. Never commit environment files or credential backups.

## Verified on 2026-09-09 (Asia/Shanghai)

- Initially the supplied key was routed to `vip`, which had no matching channel. `/v1/models` returned an empty list and chat returned `503 model_not_found`.
- The user changed this key to `default`, where the enabled `sub2api-chatgpt` channel lists `gpt-5.6-sol`.
- Direct WisePA chat: HTTP 200, model `gpt-5.6-sol`, answer `OK`, 2,672 ms in the first successful probe (not a latency guarantee).
- Local TypeScript check and production build passed. All 29 website tests passed locally and under wise's Node 22 runtime.
- Live public gRPC request with the existing shared/default client protocol returned `gpt-5.6-sol`; one request deducted one credit (10 → 9). Temporary account deleted.
- Synthetic Two Sum screenshot with browser/navigation noise: public gRPC extraction + solution returned valid JSON, problem/examples without unrelated UI text, non-empty Python code and complexity fields; 14,958 ms, finish reason `stop`, one credit deducted. Temporary account deleted. This checks extraction and response structure, not execution of the generated code.
- The website and admin routes remained available during deployment. Existing desktop installers and download URLs were unchanged.

For rollback, restore the protected prior `ai-settings.json` rows to Supabase and prior `website.env.production`, restage runtime variables, and restore the previous website runtime if needed. Backups contain sensitive values and must remain private.
