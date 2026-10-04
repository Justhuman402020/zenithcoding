import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const BUILT_IN_RULES = [
  "Act first: start reading or writing files right away instead of long explanations.",
  "Keep replies short and direct — no filler or apologies.",
  "Never reset the project to a generic template; extend what is already there.",
  "Free public services (CoinGecko, DexScreener, Open-Meteo) need no key.",
  "For services that need a key: explain where to get it, and open the paste box only when you say “I have it now”.",
  "@names from the Assets tab must be placed with their exact web address — and Forge checks the files afterwards.",
  "Each Cloudflare key stops at 9,000 Neurons and hands the next step to the next key, keeping the same Forge voice.",
  "Fixes change only what is needed; a copy of your files is saved before every fix so you can undo it.",
  "Auto-switch off = only the model you picked is used.",
];

export function BrainPanel({ projectId }: { projectId: string }) {
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState("");
  const [presets, setPresets] = useState<{ label: string; value: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const [{ data: n }, { data: secrets }, { data: assets }] = await Promise.all([
        supabase.from("project_brain_notes").select("content").eq("project_id", projectId).maybeSingle(),
        supabase.from("project_secrets").select("key").eq("project_id", projectId),
        supabase.from("project_assets").select("handle").eq("project_id", projectId),
      ]);
      setNotes(n?.content ?? "");
      setSaved(n?.content ?? "");
      const auto = typeof window !== "undefined" ? localStorage.getItem("forge:auto-switch") : null;
      const mode = typeof window !== "undefined" ? localStorage.getItem("forge:chat-mode") : null;
      setPresets([
        { label: "Auto-switch", value: auto === "false" || auto === "off" ? "Off" : "On" },
        { label: "Chat mode", value: mode === "plan" ? "Plan" : "Build" },
        { label: "Saved keys", value: secrets?.length ? secrets.map((s) => s.key).join(", ") : "None" },
        { label: "Saved assets", value: assets?.length ? assets.map((a) => `@${a.handle}`).join(", ") : "None" },
      ]);
    })();
  }, [projectId]);

  async function save() {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return setSaving(false);
    const { error } = await supabase
      .from("project_brain_notes")
      .upsert({ project_id: projectId, user_id: u.user.id, content: notes, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) return toast.error(error.message);
    setSaved(notes);
    toast.success("Saved — Forge will follow these on every message");
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Your rules</h2>
        <p className="text-xs text-muted-foreground">Write anything Forge should always remember for this project, one per line.</p>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={6} placeholder="e.g. Always use gold and black colours. Never remove the login page." />
        <Button size="sm" onClick={save} disabled={saving || notes === saved}>{saving ? "Saving…" : "Save rules"}</Button>
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Saved presets</h2>
        <ul className="space-y-1 text-xs">
          {presets.map((p) => (
            <li key={p.label} className="flex gap-2"><span className="w-28 shrink-0 text-muted-foreground">{p.label}</span><span className="break-all text-foreground">{p.value}</span></li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Built-in rules Forge always follows</h2>
        <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
          {BUILT_IN_RULES.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </section>
    </div>
  );
}
