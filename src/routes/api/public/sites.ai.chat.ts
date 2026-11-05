import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { corsPreflight, jsonResponse } from "@/lib/site-backend.server";
import { cleanMessages, nextDayCount, siteChatDecision } from "@/lib/project-ai-policy";

// Public endpoint for built sites: a per-project token picks the project, the
// owner's switch must be on, and a daily cap protects the Cloudflare pool.
export const Route = createFileRoute("/api/public/sites/ai/chat")({
  server: {
    handlers: {
      OPTIONS: () => corsPreflight(),
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
        if (!/^chai_[0-9a-f]{48}$/.test(token)) return jsonResponse({ error: "Missing site AI token" }, 401);
        const body = z.object({ messages: z.array(z.any()).max(200), stream: z.boolean().optional() }).safeParse(await request.json().catch(() => null));
        if (!body.success) return jsonResponse({ error: "Send { messages: [{ role, content }] }" }, 400);
        const messages = cleanMessages(body.data.messages);
        if (!messages) return jsonResponse({ error: "Messages are empty or too long" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { hashSiteToken, runSiteChat } = await import("@/lib/project-ai.server");
        const { readPoolSettings } = await import("@/lib/cf-pool-settings.server");
        const { data: s } = await supabaseAdmin.from("project_ai_settings").select("*").eq("token_hash", await hashSiteToken(token)).maybeSingle();
        if (!s) return jsonResponse({ error: "Unknown site AI token" }, 401);
        const pool = await readPoolSettings();
        const today = new Date().toISOString().slice(0, 10);
        const d = siteChatDecision({ enabled: s.cloudflare_enabled, poolEnabled: pool.poolEnabled, dayRequests: s.usage_day === today ? s.day_requests : 0 });
        if (!d.ok) return jsonResponse({ error: d.error }, d.status);
        await supabaseAdmin.from("project_ai_settings").update({ usage_day: today, day_requests: nextDayCount(s.usage_day, s.day_requests, today) }).eq("project_id", s.project_id);

        const stream = body.data.stream !== false;
        const r = await runSiteChat({ projectId: s.project_id, userId: s.user_id, messages, stream, model: s.model });
        if (!r.ok) return jsonResponse({ error: r.error }, r.status);
        if ("reply" in r) return jsonResponse({ reply: r.reply });
        return new Response(r.body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "access-control-allow-origin": "*" } });
      },
    },
  },
});
