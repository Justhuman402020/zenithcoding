import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Archive, Download, FileArchive, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getBrainZips, saveBrainZip } from "@/lib/brain-zip.functions";
import { BRAIN_ZIP_BUCKET, inspectBrainZip, type BrainZip } from "@/lib/brain-zip";

export function BrainZipReferences({ projectId }: { projectId: string }) {
  const load = useServerFn(getBrainZips);
  const save = useServerFn(saveBrainZip);
  const picker = useRef<HTMLInputElement>(null);
  const request = useRef<XMLHttpRequest | null>(null);
  const [rows, setRows] = useState<BrainZip[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setRows([]);
    void load({ data: { projectId } }).then(r => { if (active) setRows(r); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; request.current?.abort(); };
  }, [projectId, load]);

  async function upload(file: File) {
    setBusy(true); setError(""); setStatus("Checking ZIP…");
    let path: string | null = null;
    let saved = false;
    try {
      await inspectBrainZip(new Uint8Array(await file.arrayBuffer()), file.name);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sign in to save this ZIP.");
      path = `${session.user.id}/${projectId}/${crypto.randomUUID()}.zip`;
      const uploadPath = path;
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); request.current = xhr;
        xhr.open("POST", `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/${BRAIN_ZIP_BUCKET}/${uploadPath}`);
        xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
        xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
        xhr.setRequestHeader("Content-Type", "application/zip");
        xhr.timeout = 120000;
        xhr.upload.onprogress = e => { if (e.lengthComputable) setStatus(`Uploading ${file.name} · ${Math.round(e.loaded / e.total * 100)}%`); };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`ZIP upload failed (${xhr.status}). Try again.`));
        xhr.onerror = () => reject(new Error("Connection interrupted. Your site has not changed; try uploading again."));
        xhr.ontimeout = () => reject(new Error("Upload timed out. Try again on a stronger connection."));
        xhr.onabort = () => reject(new Error("Upload cancelled."));
        setStatus(`Uploading ${file.name} · 0%`);
        xhr.send(file);
      });
      request.current = null;
      setStatus("Saving reference…");
      await save({ data: { projectId, name: file.name, storagePath: uploadPath, byteSize: file.size } });
      saved = true;
      setRows(await load({ data: { projectId } }));
      setStatus("");
      toast.success("ZIP saved in this project's Brain");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save ZIP.");
      setStatus("");
      if (path && !saved) await supabase.storage.from(BRAIN_ZIP_BUCKET).remove([path]);
    } finally { setBusy(false); request.current = null; if (picker.current) picker.current.value = ""; }
  }

  return <section className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold flex items-center gap-2"><Archive className="h-4 w-4" /> Saved ZIP references</h2>
      <Button variant="outline" size="icon" disabled={busy} title="Upload ZIP to project Brain" aria-label="Upload ZIP to project Brain" onClick={() => picker.current?.click()}><Upload className="h-4 w-4" /></Button>
      <input ref={picker} type="file" accept=".zip,application/zip,application/x-zip-compressed" className="hidden" aria-label="Project Brain ZIP file" onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
    </div>
    {busy && <div className="flex items-center gap-2 text-xs" role="status"><Loader2 className="h-4 w-4 animate-spin shrink-0" /><span className="break-all flex-1">{status}</span>{request.current && <Button size="icon" variant="ghost" title="Cancel ZIP upload" aria-label="Cancel ZIP upload" onClick={() => request.current?.abort()}><X className="h-4 w-4" /></Button>}</div>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {!busy && !error && !rows.length && <p className="text-xs text-muted-foreground">No saved ZIPs</p>}
    {rows.map(row => <details key={row.id} className="border rounded-md bg-card px-3 py-2">
      <summary className="cursor-pointer flex items-center gap-2 text-sm"><FileArchive className="h-4 w-4 shrink-0" /><span className="min-w-0 break-all flex-1">{row.name}</span><span className="text-xs text-muted-foreground shrink-0">{row.manifest.length} files</span></summary>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground"><span>{(row.byte_size / 1024 / 1024).toFixed(1)} MB · {new Date(row.created_at).toLocaleDateString()}</span><Button variant="ghost" size="icon" title="Download saved ZIP" aria-label={`Download ${row.name}`} onClick={async () => {
        const { data: savedRow } = await supabase.from("project_brain_zips").select("storage_path").eq("id", row.id).eq("project_id", projectId).maybeSingle();
        if (!savedRow) return toast.error("Saved ZIP not found");
        const { data, error: downloadError } = await supabase.storage.from(BRAIN_ZIP_BUCKET).createSignedUrl(savedRow.storage_path, 60, { download: row.name });
        if (downloadError || !data) return toast.error("Could not download ZIP");
        const link = document.createElement("a"); link.href = data.signedUrl; link.download = row.name; link.click();
      }}><Download className="h-4 w-4" /></Button></div>
      <ul className="max-h-48 overflow-y-auto text-xs space-y-1 mt-2">{row.manifest.map(f => <li key={f.path} className="break-all text-muted-foreground">{f.path}</li>)}</ul>
    </details>)}
  </section>;
}