// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    resolve: { alias: { "pkce-challenge": fileURLToPath(new URL("./node_modules/pkce-challenge/dist/index.browser.js", import.meta.url)) } },
    plugins: [mcpPlugin()],
    // Cold starts deadlocked: the server-fn compiler loads `zod` while transforming
    // *.functions.ts files with module-level schemas, and the optimized zod waited
    // for that same crawl. Serving zod unoptimized (it is native ESM) breaks the cycle.
    // holdUntilCrawlEnd: false — the optimizer must not wait for the browser crawl to
    // finish, because crawl requests for optimized deps wait on the optimizer (deadlock).
    // Keep React prebundled, but avoid the unbounded route/dependency discovery
    // crawl that leaves every browser module waiting on cold starts.
    optimizeDeps: { exclude: ["zod"], include: ["ai", "@ai-sdk/react", "@vercel/oidc"], holdUntilCrawlEnd: false, noDiscovery: true },
    server: {
      // Allow the preview proxy hostname (changes when the environment is recreated).
      allowedHosts: true,
    },
  },
});
