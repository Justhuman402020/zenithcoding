import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const hostnameRe = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/i;

async function dohLookup(name: string, type: "TXT" | "CNAME") {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
  const res = await fetch(url, { headers: { accept: "application/dns-json" } });
  if (!res.ok) throw new Error(`DNS lookup failed (${res.status})`);
  const json = (await res.json()) as { Answer?: Array<{ data: string; type: number }> };
  return (json.Answer ?? []).map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
}

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
      const txt = await dohLookup(`_forge-verify.${row.hostname}`, "TXT");
      const matched = txt.some((t) => t.trim() === row.verification_token);
      if (!matched) {
        const cname = await dohLookup(row.hostname, "CNAME");
        await supabase
          .from("project_domains")
          .update({
            last_check_at: checkedAt,
            last_check_error: `Waiting for TXT _forge-verify.${row.hostname} = ${row.verification_token}. Found: ${txt.join(", ") || "nothing"}. CNAME: ${cname.join(", ") || "none"}`,
          })
          .eq("id", row.id);
        return { verified: false, message: "DNS records not found yet. They can take a few minutes to propagate." };
      }
      await supabase
        .from("project_domains")
        .update({ verified: true, verified_at: checkedAt, last_check_at: checkedAt, last_check_error: null })
        .eq("id", row.id);
      return { verified: true, message: "Verified" };
    } catch (e: any) {
      await supabase
        .from("project_domains")
        .update({ last_check_at: checkedAt, last_check_error: e?.message ?? "Lookup failed" })
        .eq("id", row.id);
      throw e;
    }
  });