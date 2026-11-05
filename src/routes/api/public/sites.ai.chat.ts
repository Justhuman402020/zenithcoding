import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { corsPreflight, jsonResponse } from "@/lib/site-backend.server";
import { cleanMessages } from "@/lib/project-ai-policy";

// Public endpoint for built sites: a per-project token picks the project, the
// owner's switch must be on, and a daily cap protects the Cloudflare pool.
export const Route = createFileRoute("/api/public/sites/ai/chat")({
  server: {
    handlers: {
      OPTIONS: () => corsPreflight(),
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
        if (!/^chai_[0-9a-f]{48}$/.test(token)) return jsonResponse({ error: "Missing site AI token" }, 401);
        const reader=request.body?.getReader();
        let size=0, raw="";
        const decoder=new TextDecoder();
        if(reader) { while(true) { const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>131072){await reader.cancel();return jsonResponse({error:"AI request is too large"},413);}raw+=decoder.decode(part.value,{stream:true}); }raw+=decoder.decode(); }
        let parsed:unknown;try{parsed=JSON.parse(raw);}catch{return jsonResponse({error:"Invalid JSON"},400);}
        const body = z.object({ messages: z.array(z.any()).max(200), stream: z.boolean().optional(), request_id:z.string().min(1).max(100).optional() }).safeParse(parsed);
        if (!body.success) return jsonResponse({ error: "Send { messages: [{ role, content }] }" }, 400);
        const messages = cleanMessages(body.data.messages);
        if (!messages) return jsonResponse({ error: "Messages are empty or too long" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { hashSiteToken, runSiteChat } = await import("@/lib/project-ai.server");
        const { data: s } = await supabaseAdmin.from("project_ai_settings").select("*").eq("token_hash", await hashSiteToken(token)).maybeSingle();
        if (!s) return jsonResponse({ error: "Unknown site AI token" }, 401);

        const stream = body.data.stream !== false;
        const r = await runSiteChat({ projectId: s.project_id, userId: s.user_id, messages, stream, model: s.model,requestKey:body.data.request_id??request.headers.get("idempotency-key")?.slice(0,100) });
        if (!r.ok) return jsonResponse({ error: r.error }, r.status);
        if ("reply" in r) return jsonResponse({ reply: r.reply });
        return new Response(r.body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "access-control-allow-origin": "*", "x-request-id":r.requestId,"access-control-expose-headers":"x-request-id" } });
      },
    },
  },
});
