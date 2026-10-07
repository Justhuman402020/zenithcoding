// Global admin brain + credential vault (service-role only tables).
export type VaultEntry = { id: string; label: string; kind: string; base_url: string | null; account_id: string | null; notes: string | null };

export async function loadAdminBrain(): Promise<string> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("admin_brain").select("content").eq("id", "global").maybeSingle();
    return data?.content ?? "";
  } catch {
    return "";
  }
}

export async function listVault(): Promise<VaultEntry[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("admin_credentials")
      .select("id, label, kind, base_url, account_id, notes")
      .order("created_at", { ascending: true });
    return (data ?? []) as VaultEntry[];
  } catch {
    return [];
  }
}

export async function readVaultSecret(label: string): Promise<(VaultEntry & { key: string }) | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { decryptSecret } = await import("./secrets-crypto.server");
  const { data } = await supabaseAdmin
    .from("admin_credentials")
    .select("id, label, kind, base_url, account_id, notes, key_encrypted")
    .ilike("label", label.trim())
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const { key_encrypted, ...rest } = data as any;
  return { ...(rest as VaultEntry), key: await decryptSecret(key_encrypted) };
}

export type BrainNote = { id: string; category: string; purpose: string; body: string };

export async function loadBrainNotes(): Promise<BrainNote[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("admin_brain").select("content").eq("id", "notes").maybeSingle();
    const parsed = JSON.parse(data?.content || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Prompt section: names only, never values. */
export async function vaultPromptSection(): Promise<string> {
  const [brain, vault, notes] = await Promise.all([loadAdminBrain(), listVault(), loadBrainNotes()]);
  let out = "";
  if (brain.trim()) out += `\n\n## Global admin rules (always follow)\n${brain.trim().slice(0, 6000)}`;
  const usable = notes.filter((n) => n.body.trim());
  if (usable.length) {
    out += `\n\n## Admin brain notes\n${usable
      .map((n) => `### [${n.category || "General"}] ${n.purpose || "Note"}\n${n.body.trim()}`)
      .join("\n")
      .slice(0, 6000)}`;
  }
  if (vault.length) {
    out += `\n\n## Saved credentials in the admin vault\nUse the attach_credential tool to copy one into this project's secrets (values are never shown to you):\n${vault
      .map((v) => `- "${v.label}" (${v.kind}${v.base_url ? `, url ${v.base_url}` : ""}${v.account_id ? ", has ID" : ""})${v.notes ? ` — note: ${v.notes}` : ""}`)
      .join("\n")}`;
  }
  return out;
}
