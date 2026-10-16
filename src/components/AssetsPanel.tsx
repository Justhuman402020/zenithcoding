import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Copy, Trash2, Upload } from "lucide-react";

type Asset = { id: string; handle: string; url: string; content_type: string | null };

const slug = (s: string) =>
  s.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "asset";

export function AssetsPanel({ projectId }: { projectId: string }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState(false);
  const [handle, setHandle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("project_assets")
      .select("id, handle, url, content_type")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    setAssets((data as Asset[]) ?? []);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const upload = useCallback(async (files: File[]) => {
    const media = files.filter((f) => /^(image|video)\//.test(f.type));
    if (!media.length) return toast.error("Only pictures and videos can be added.");
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error("Please sign in again.");
      const taken = new Set(assets.map((a) => a.handle));
      for (const [i, file] of media.entries()) {
        if (file.size > 50 * 1024 * 1024) { toast.error(`${file.name} is over 50MB.`); continue; }
        let base = slug(i === 0 && handle.trim() ? handle.replace(/^@/, "") : file.name || "pasted");
        let h = base, n = 2;
        while (taken.has(h)) h = `${base}_${n++}`;
        taken.add(h);
        const id = crypto.randomUUID();
        const ext = (file.name.split(".").pop() || file.type.split("/")[1] || "bin").toLowerCase();
        const path = `${userId}/${projectId}/${id}.${ext}`;
        const { error: upErr } = await supabase.storage.from("project-assets").upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;
        const url = `${window.location.origin}/api/public/asset/${id}.${ext}`;
        const { error } = await supabase.from("project_assets").insert({
          id, project_id: projectId, user_id: userId, handle: h, url, storage_path: path, content_type: file.type, size: file.size,
        });
        if (error) throw error;
      }
      setHandle("");
      toast.success("Added — mention it in chat with its @name.");
      await load();
    } catch (e) {
      toast.error((e as Error).message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }, [assets, handle, load, projectId]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) { e.preventDefault(); void upload(files); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [upload]);

  const rename = async (a: Asset, next: string) => {
    const h = slug(next.replace(/^@/, ""));
    if (h === a.handle) return;
    const { error } = await supabase.from("project_assets").update({ handle: h }).eq("id", a.id);
    if (error) toast.error(error.code === "23505" ? "That name is already used." : error.message);
    await load();
  };

  const remove = async (a: Asset) => {
    if (!confirm(`Delete @${a.handle}? Pages using it will show a broken picture.`)) return;
    const { data } = await supabase.from("project_assets").select("storage_path").eq("id", a.id).maybeSingle();
    if (data?.storage_path) await supabase.storage.from("project-assets").remove([data.storage_path]);
    await supabase.from("project_assets").delete().eq("id", a.id);
    await load();
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void upload([...e.dataTransfer.files]); }}
        onClick={() => inputRef.current?.click()}
        className="rounded-lg border-2 border-dashed border-border p-6 text-center cursor-pointer hover:border-primary transition-colors"
      >
        <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium">{busy ? "Uploading…" : "Tap, drop, or paste pictures and videos"}</p>
        <p className="text-xs text-muted-foreground mt-1">Each gets an @name. Say "use @logo for the left icon" in chat.</p>
        <input ref={inputRef} type="file" accept="image/*,video/*" multiple hidden
          onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </div>
      <Input placeholder="Optional name for the next upload, e.g. @logo" value={handle} onChange={(e) => setHandle(e.target.value)} />
      {assets.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center">No assets yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {assets.map((a) => (
            <div key={a.id} className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="aspect-video bg-muted flex items-center justify-center">
                {a.content_type?.startsWith("video/")
                  ? <video src={a.url} className="h-full w-full object-cover" muted />
                  : <img src={a.url} alt={a.handle} className="h-full w-full object-cover" />}
              </div>
              <div className="p-2 space-y-1">
                <Input defaultValue={`@${a.handle}`} className="h-7 text-xs" onBlur={(e) => void rename(a, e.target.value)} />
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 flex-1 text-xs"
                    onClick={() => { void navigator.clipboard.writeText(a.url); toast.success("Address copied"); }}>
                    <Copy className="h-3 w-3 mr-1" /> Copy
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => void remove(a)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
