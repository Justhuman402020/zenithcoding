import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hftest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { loadCustomProviders } = await import("@/lib/custom-providers.server");
        const providers = await loadCustomProviders();
        const hf = providers.find((p) => p.id === "custom-hugging-face");
        if (!hf) return Response.json({ error: "no hf provider" }, { status: 404 });
        const model = new URL(request.url).searchParams.get("model");
        if (!model) {
          const res = await fetch(`${hf.baseURL}/models`, { headers: { Authorization: `Bearer ${hf.apiKey}` } });
          const json = (await res.json()) as any;
          return Response.json({ count: json?.data?.length ?? 0, ids: (json?.data ?? []).map((m: any) => m.id).slice(0, 60) });
        }
        const res = await fetch(`${hf.baseURL}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${hf.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with the single word: alive" }], max_tokens: 20 }),
        });
        const text = await res.text();
        return Response.json({ status: res.status, body: text.slice(0, 600) });
      },
    },
  },
});
