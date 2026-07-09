import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const hostnameRe = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/i;

async function dohLookup(name: string, type: "TXT" | "CNAME" | "A") {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
  const res = await fetch(url, { headers: { accept: "application/dns-json" } });
  if (!res.ok) throw new Error(`DNS lookup failed (${res.status})`);
  const json = (await res.json()) as { Answer?: Array<{ data: string; type: number }> };
  return (json.Answer ?? []).map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
}

const FORGE_IP = "185.158.133.1";

export const verifyDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ domainId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("project_domains")
      .select("id,hostname,verification_token")
      .eq("id", data.domainId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !row) throw new Error("Domain not found");
    if (!hostnameRe.test(row.hostname)) throw new Error("Invalid hostname");

    const checkedAt = new Date().toISOString();
    try {
      const [txt, aRoot, aWww] = await Promise.all([
        dohLookup(`_forge-verify.${row.hostname}`, "TXT"),
        dohLookup(row.hostname, "A"),
        dohLookup(`www.${row.hostname}`, "A"),
      ]);
      const txtOk = txt.some((t) => t.trim() === row.verification_token);
      const aRootOk = aRoot.includes(FORGE_IP);
      const aWwwOk = aWww.includes(FORGE_IP);

      if (!txtOk || !aRootOk) {
        const missing: string[] = [];
        if (!txtOk) missing.push(`TXT _forge-verify (found: ${txt.join(", ") || "none"})`);
        if (!aRootOk) missing.push(`A @ → ${FORGE_IP} (found: ${aRoot.join(", ") || "none"})`);
        if (!aWwwOk) missing.push(`A www → ${FORGE_IP} (found: ${aWww.join(", ") || "none"})`);
        await supabase
          .from("project_domains")
          .update({ last_check_at: checkedAt, last_check_error: `Waiting on: ${missing.join(" • ")}` })
          .eq("id", row.id);
        return { verified: false, message: "DNS not ready yet. Records can take a few minutes to update." };
      }
      await supabase
        .from("project_domains")
        .update({ verified: true, verified_at: checkedAt, last_check_at: checkedAt, last_check_error: aWwwOk ? null : "Root verified. Add the www A record too so www.yourdomain.com works." })
        .eq("id", row.id);
      return { verified: true, message: aWwwOk ? "Verified" : "Verified (add www A record so www works too)" };
    } catch (e: any) {
      await supabase
        .from("project_domains")
        .update({ last_check_at: checkedAt, last_check_error: e?.message ?? "Lookup failed" })
        .eq("id", row.id);
      throw e;
    }
  });