import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Public only with the existing short-lived, hashed, limited-use preview capability. */
export const loadVisualPreview = createServerFn({ method: "POST" }).inputValidator((input) => z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { hashToken } = await import("./browser-check.server");
    const { tokenUsable } = await import("./browser-check-policy");
    const hash = await hashToken(data.token);
    const { data: row } = await db.from("preview_tokens").select("html,uses,expires_at").eq("token_hash", hash).maybeSingle();
    if (!row || !tokenUsable(row)) throw new Error("This private preview address expired.");
    const { data: claimed, error } = await db.from("preview_tokens").update({ uses: row.uses + 1 }).eq("token_hash", hash).eq("uses", row.uses).select("token_hash");
    if (error || !claimed?.length) throw new Error("Preview is already loading. Try again.");
    const payload = JSON.parse(row.html) as { files?: Array<{ path: string; content: string }> };
    if (!Array.isArray(payload.files)) throw new Error("Preview files unavailable.");
    return { files: payload.files.filter((file) => !/(^|\/)(\.env(?:\..*)?|.*\.(pem|key|p12)|credentials(?:\..*)?)$/i.test(file.path)) };
  });