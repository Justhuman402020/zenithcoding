import { useEffect, useState } from "react";
import { Palette, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { THEMES, applyTheme, doodleUrl, readLocalTheme, writeLocalTheme } from "@/lib/themes";

/** Loads the saved theme on every page (local first, then the account copy). */
export function ThemeBoot() {
  useEffect(() => {
    applyTheme(readLocalTheme());
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await (supabase as any).from("user_settings").select("theme").eq("user_id", u.user.id).maybeSingle();
      if (data?.theme) { writeLocalTheme(data.theme); applyTheme(data.theme); }
    })();
  }, []);
  return null;
}

export function ThemePicker() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState("math");
  const [pick, setPick] = useState("math");
  useEffect(() => { if (open) { const s = readLocalTheme(); setSaved(s); setPick(s); } }, [open]);
  function preview(id: string) { setPick(id); applyTheme(id); }
  function close(o: boolean) { if (!o) applyTheme(saved); setOpen(o); }
  async function save() {
    writeLocalTheme(pick); setSaved(pick);
    const { data: u } = await supabase.auth.getUser();
    if (u.user) {
      const { error } = await (supabase as any).from("user_settings").upsert({ user_id: u.user.id, theme: pick, updated_at: new Date().toISOString() });
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Theme saved"); setOpen(false);
  }
  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground hover:text-primary" aria-label="Choose theme"><Palette className="h-5 w-5" /></Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto bg-popover">
        <SheetHeader><SheetTitle>Select theme</SheetTitle></SheetHeader>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {THEMES.map((t) => (
            <button key={t.id} onClick={() => preview(t.id)} className={`relative aspect-[3/4] overflow-hidden rounded-xl border-2 ${pick === t.id ? "border-primary" : "border-transparent"}`} style={{ backgroundColor: t.base, backgroundImage: doodleUrl(t) }}>
              <div className="absolute right-2 top-3 h-3 w-12 rounded-full" style={{ background: t.primary }} />
              <div className="absolute left-2 top-8 h-3 w-10 rounded-full" style={{ background: t.card }} />
              <div className="absolute inset-x-0 bottom-2 text-center text-2xl">{t.emoji}</div>
              {pick === t.id && <Check className="absolute left-2 top-2 h-4 w-4" style={{ color: t.primary }} />}
              <span className="sr-only">{t.name}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => close(false)}>Cancel</Button>
          <Button className="flex-1" onClick={save}>Save</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
