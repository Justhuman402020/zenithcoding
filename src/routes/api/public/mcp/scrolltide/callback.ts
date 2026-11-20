import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
export const Route = createFileRoute("/api/public/mcp/scrolltide/callback")({ server: { handlers: { GET: async ({ request }) => {
  const url = new URL(request.url);
  const parsed = z.object({ state: z.string().uuid(), code: z.string().min(1).max(4096), iss: z.string().url().optional() }).safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return new Response("Scrolltide approval was denied or expired. Return to Code Haven and connect again.", { status: 400 });
  try {
    const { finishScrolltide } = await import("@/lib/runtime-mcp/scrolltide.server");
    const origin = await finishScrolltide(parsed.data.state, parsed.data.code, parsed.data.iss);
    return new Response('<!doctype html><html><head><title>Scrolltide connected — Code Haven</title></head><body><h1>Scrolltide connected</h1><p>You can close this tab and return to Code Haven.</p><a href="' + origin + '/admin/integrations">Return to Code Haven</a></body></html>', { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch { return new Response("Could not complete Scrolltide approval. Return to Code Haven and connect again.", { status: 400, headers: { "Cache-Control": "no-store" } }); }
} } } });