import { createFileRoute } from "@tanstack/react-router";
import { tokenUsable } from "@/lib/browser-check-policy";

// Short-lived private address that shows one project's preview to the test browser.
// The token is random, stored only as a hash, expires in 15 minutes and allows a few loads.
export const Route = createFileRoute("/api/public/preview/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const token = String(params.token ?? "");
        if (!/^[a-f0-9]{64}$/.test(token)) return new Response("Not found", { status: 404 });
        const { hashToken } = await import("@/lib/browser-check.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const hash = await hashToken(token);
        const { data } = await supabaseAdmin.from("preview_tokens" as any).select("html, uses, expires_at").eq("token_hash", hash).maybeSingle();
        const row = data as any;
        if (!row || !tokenUsable(row)) return new Response("This test address has expired.", { status: 410 });
        await supabaseAdmin.from("preview_tokens" as any).update({ uses: row.uses + 1 } as any).eq("token_hash", hash);
        return new Response(row.html, {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" },
        });
      },
    },
  },
});
