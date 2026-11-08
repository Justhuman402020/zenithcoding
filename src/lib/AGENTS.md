# src/lib notes

- Cloudflare pool rules live as pure functions in src/lib/cf-pool-policy.ts; chat.ts only calls them, so rules stay unit-testable.
- Retain ZIP media and upload it in size-capped, timed, retried upserts (src/lib/zip-upload.ts) so slow networks show progress, never hang; post-import ZIP errors auto-fix via OpenRouter build, max 3 rounds. Namespace builds under .code-haven-build/.
- Site AI chat can run on the owner's Cloudflare pool via a per-project token (src/lib/project-ai-policy.ts rules, /api/public/sites/ai/chat); pool keys never leave Code Haven and the switch stops access instantly.
- Finished React/Vite edits pass build-check.ts links then real tsc in E2B (agent-tools.server.ts), max 3 repairs.
- Ollama builds go through src/lib/ollama-native.ts (native /api/chat with num_ctx and sliced prompt warm-up); Ollama's /v1 cannot raise its 4k default context and tunnels drop silent waits after ~100s.
