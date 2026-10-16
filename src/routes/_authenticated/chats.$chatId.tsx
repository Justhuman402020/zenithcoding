import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, ArrowUp, Check, ChevronRight, FileText, FolderKanban, KeyRound, Loader2, MessageSquare, Download, Paperclip, Plus, Power, PowerOff, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { isEnvFile, redactEnv } from "@/lib/assistant-policy";
import { addOllamaKey, checkEdit, decideEdit, getChat, listChatProjects, listChats, listOllamaKeys, listOllamaModels, listProjectFiles, setKeyActive, sendChatMessage, setupChat } from "@/lib/assistant.functions";

export const Route = createFileRoute("/_authenticated/chats/$chatId")({
  head: () => ({ meta: [{ title: "Chat — Code Haven" }, { name: "description", content: "Chat with your Code Haven helper." }, { property: "og:title", content: "Chat — Code Haven" }, { property: "og:description", content: "Chat with your Code Haven helper." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: ChatPage,
});

type Data = Awaited<ReturnType<typeof getChat>>;
type Attach = { name: string; text: string };

function ChatPage() {
  const { chatId } = Route.useParams();
  const navigate = useNavigate();
  const load = useServerFn(getChat);
  const send = useServerFn(sendChatMessage);
  const setup = useServerFn(setupChat);
  const decide = useServerFn(decideEdit);
  const check = useServerFn(checkEdit);
  const [data, setData] = useState<Data | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<Attach[]>([]);
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const reload = useCallback(() => load({ data: { id: chatId } }).then(setData).catch((e) => toast.error(String(e?.message ?? e))), [chatId, load]);
  useEffect(() => { void reload(); inputRef.current?.focus(); }, [reload]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [data?.messages.length]);
  useEffect(() => { if (data && !data.chat.initialized) setSettingsOpen(true); }, [data?.chat.initialized]);

  // Watch running Cloudflare edits.
  const running = data?.edits.filter((e) => e.status === "running") ?? [];
  useEffect(() => {
    if (!running.length) return;
    const t = setInterval(async () => {
      for (const e of running) {
        const r = await check({ data: { id: e.id } }).catch(() => null);
        if (r?.progress) setProgress((p) => ({ ...p, [e.id]: r.progress! }));
        if (r && r.status !== "running") void reload();
      }
    }, 4000);
    return () => clearInterval(t);
  }, [running.map((e) => e.id).join(","), check, reload]);

  async function submit() {
    const msg = text.trim();
    if (!msg || busy) return;
    setBusy(true); setText("");
    setData((d) => d ? { ...d, messages: [...d.messages, { id: "tmp", role: "user", content: msg, parts: {}, created_at: new Date().toISOString() }] } : d);
    try { await send({ data: { id: chatId, text: msg, attachments } }); setAttachments([]); } catch (e: any) { toast.error(e?.message ?? "Send failed"); }
    await reload(); setBusy(false); inputRef.current?.focus();
  }

  async function approve(editId: string, prompt: string) {
    const r = await decide({ data: { id: editId, answer: "yes" } });
    await reload();
    if (r.status !== "approved" || !r.requestKey || !data?.chat.projectId) return;
    const { data: s } = await supabase.auth.getSession();
    // Hand the edit to the project's normal Cloudflare build. It keeps running on the server.
    void fetch("/api/public/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}`, "x-project-id": data.chat.projectId, "x-forge-mode": "build", "x-forge-auto": "on", "x-forge-request-key": r.requestKey },
      body: JSON.stringify({ messages: [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: `${prompt}\n\nAfter editing, run a typecheck and fix any errors.` }] }] }),
    }).then((res) => res.body?.cancel()).catch(() => {});
  }

  if (!data) return <div className="min-h-screen grid place-items-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const items = [
    ...data.messages.map((m) => ({ kind: "msg" as const, at: m.created_at, m })),
    ...data.edits.map((e) => ({ kind: "edit" as const, at: e.created_at, e })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/chats" })} aria-label="Back"><ArrowLeft className="h-5 w-5" /></Button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{data.chat.title}</div>
          <div className="truncate text-xs text-muted-foreground">{data.chat.projectName ?? "No project"} · {data.chat.model ?? "no model"}</div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}><KeyRound className="h-4 w-4 mr-1" />Model</Button>
      </header>
      <main className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-4">
          {items.length === 0 && <p className="text-center text-sm text-muted-foreground mt-10">Pick a project with + and your Ollama model, then ask anything.</p>}
          {items.map((it) => it.kind === "msg" ? (
            it.m.role === "user"
              ? <div key={it.m.id + it.at} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2 text-primary-foreground">{it.m.content}</div>
              : <div key={it.m.id} className="max-w-full">
                  <div className="prose prose-sm dark:prose-invert max-w-none"><ReactMarkdown>{it.m.content}</ReactMarkdown></div>
                  {Array.isArray(it.m.parts?.log) && it.m.parts.log.length > 0 && (
                    <details className="mt-2 rounded-lg border bg-muted/40 p-2 text-xs"><summary className="cursor-pointer">Work log ({it.m.parts.log.length})</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono">{it.m.parts.log.join("\n")}</pre></details>
                  )}
                </div>
          ) : (
            <div key={it.e.id} className="rounded-xl border bg-card p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Edit for Cloudflare</div>
              <div className="mt-1 whitespace-pre-wrap text-sm">{it.e.prompt}</div>
              {it.e.status === "pending" && <>
                <div className="mt-3 text-sm font-medium">This edit will use your Cloudflare balance. Proceed?</div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => approve(it.e.id, it.e.prompt)}><Check className="h-4 w-4 mr-1" />Yes</Button>
                  <Button size="sm" variant="outline" onClick={async () => { await decide({ data: { id: it.e.id, answer: "no" } }); void reload(); }}><X className="h-4 w-4 mr-1" />No</Button>
                </div>
              </>}
              {it.e.status === "running" && <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{progress[it.e.id] ?? "Editing files with Cloudflare…"}</div>}
              {it.e.status === "declined" && <div className="mt-2 text-sm text-muted-foreground">Not sent.</div>}
              {it.e.status === "done" && <div className="mt-2 text-sm text-primary">Finished — summary below.</div>}
              {it.e.status === "failed" && <div className="mt-2 text-sm text-destructive">Stopped — see summary below.</div>}
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Thinking…</div>}
          <div ref={bottomRef} />
        </div>
      </main>
      <footer className="border-t p-3">
        <div className="mx-auto max-w-2xl">
          {attachments.length > 0 && <div className="mb-2 flex flex-wrap gap-1">{attachments.map((a, i) => <span key={i} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">{a.name}<button aria-label="Remove" onClick={() => setAttachments((x) => x.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button></span>)}</div>}
          <div className="flex items-end gap-2 rounded-2xl border bg-card p-2">
            <PlusMenu chatId={chatId} projectId={data.chat.projectId} onProject={async (id) => { await setup({ data: { id: chatId, projectId: id, initialize: !!(data.chat.keyId && data.chat.model) } }).catch((e) => toast.error(e.message)); void reload(); }} onAttach={(a) => setAttachments((x) => [...x, a].slice(0, 5))} />
            <Textarea ref={inputRef} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }} placeholder="Ask about your project…" className="min-h-10 max-h-40 flex-1 resize-none border-0 bg-transparent focus-visible:ring-0" />
            <Button size="icon" className="rounded-full shrink-0" disabled={busy || !text.trim()} onClick={submit} aria-label="Send"><ArrowUp className="h-4 w-4" /></Button>
          </div>
        </div>
      </footer>
      <OllamaSheet open={settingsOpen} onOpenChange={setSettingsOpen} chat={data.chat} onDone={reload} />
    </div>
  );
}

function PlusMenu({ chatId, projectId, onProject, onAttach }: { chatId: string; projectId: string | null; onProject: (id: string) => void; onAttach: (a: Attach) => void }) {
  const projectsFn = useServerFn(listChatProjects);
  const chatsFn = useServerFn(listChats);
  const filesFn = useServerFn(listProjectFiles);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"root" | "projects" | "chats" | "files" | "projectFiles">("root");
  const [filesProject, setFilesProject] = useState<{ id: string; label: string } | null>(null);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Array<{ id: string; label: string; text?: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  async function go(v: typeof view) {
    setView(v); setQ(""); setRows([]);
    if (v === "projects") setRows((await projectsFn()).map((p) => ({ id: p.id, label: p.name })));
    if (v === "chats") setRows((await chatsFn()).filter((c) => c.id !== chatId).map((c) => ({ id: c.id, label: c.title })));
    if (v === "files") setRows((await projectsFn()).map((p) => ({ id: p.id, label: p.name })));
  }
  async function openProjectFiles(p: { id: string; label: string }) {
    setFilesProject(p); setView("projectFiles"); setQ(""); setRows([]);
    try { setRows((await filesFn({ data: { projectId: p.id } })).map((f) => ({ id: f.path, label: f.path, text: f.text }))); } catch (e: any) { toast.error(e.message); }
  }
  async function downloadZip() {
    if (!filesProject) return;
    const files = rows.length ? rows : (await filesFn({ data: { projectId: filesProject.id } })).map((f) => ({ id: f.path, label: f.path, text: f.text }));
    const { zipSync, strToU8 } = await import("fflate");
    const tree: Record<string, Uint8Array> = {};
    for (const f of files) tree[f.id.replace(/^\/+/, "")] = strToU8(f.text ?? "");
    const blob = new Blob([zipSync(tree)], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${filesProject.label.replace(/[^\w.-]+/g, "-") || "project"}.zip`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const root = [
    { k: "projects" as const, icon: FolderKanban, label: "Projects" },
    { k: "chats" as const, icon: MessageSquare, label: "Chats" },
    { k: "files" as const, icon: FileText, label: "Your files" },
  ];
  const shownRoot = root.filter((r) => !q || r.label.toLowerCase().includes(q.toLowerCase()));
  const shownRows = rows.filter((r) => !q || r.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setView("root"); }}>
      <PopoverTrigger asChild><Button size="icon" variant="outline" className="rounded-full shrink-0" aria-label="Add"><Plus className="h-4 w-4" /></Button></PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2"><Search className="h-4 w-4 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search..." className="h-8 border-0 p-0 focus-visible:ring-0" /></div>
        <div className="max-h-80 overflow-y-auto p-1">
          {view === "root" ? <>
            {shownRoot.map((r) => <button key={r.k} onClick={() => go(r.k)} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted"><r.icon className="h-5 w-5" /><span className="flex-1">{r.label}</span><ChevronRight className="h-4 w-4 text-muted-foreground" /></button>)}
            {(!q || "attach files".includes(q.toLowerCase())) && <button onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted"><Paperclip className="h-5 w-5" /><span>Attach files</span></button>}
          </> : <>
            <button onClick={() => setView(view === "projectFiles" ? "files" : "root")} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><ArrowLeft className="h-3 w-3" />Back</button>
            {view === "projectFiles" && <div className="flex items-center justify-between gap-2 px-3 pb-2"><span className="truncate text-xs text-muted-foreground">{filesProject?.label} · {rows.length} files</span><Button size="sm" variant="outline" onClick={() => void downloadZip()}><Download className="h-4 w-4 mr-1" />Download as zip</Button></div>}
            {shownRows.length === 0 && <div className="px-3 py-4 text-xs text-muted-foreground">Nothing here.</div>}
            {shownRows.map((r) => <button key={r.id} onClick={() => {
              if (view === "projects") { onProject(r.id); toast.success(`Reading ${r.label}…`); }
              if (view === "chats") navigate({ to: "/chats/$chatId", params: { chatId: r.id } });
              if (view === "files") { void openProjectFiles(r); return; }
              if (view === "projectFiles") onAttach({ name: r.label, text: isEnvFile(r.label) ? redactEnv(r.text ?? "") : (r.text ?? "").slice(0, 20000) });
              setOpen(false); setView("root");
            }} className={`flex w-full items-center gap-2 truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-muted ${r.id === projectId ? "text-primary" : ""}`}>{r.label}</button>)}
          </>}
        </div>
        <input ref={fileRef} type="file" multiple hidden onChange={async (e) => {
          for (const f of Array.from(e.target.files ?? []).slice(0, 5)) {
            const isText = f.type.startsWith("text") || /\.(tsx?|jsx?|css|html|json|md|txt)$/i.test(f.name);
            onAttach({ name: f.name, text: isText ? (await f.text()).slice(0, 20000) : `(${f.type || "file"}, ${Math.round(f.size / 1024)} KB — contents not readable as text)` });
          }
          e.target.value = ""; setOpen(false);
        }} />
      </PopoverContent>
    </Popover>
  );
}

function OllamaSheet({ open, onOpenChange, chat, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; chat: Data["chat"]; onDone: () => void }) {
  const keysFn = useServerFn(listOllamaKeys);
  const addFn = useServerFn(addOllamaKey);
  const activeFn = useServerFn(setKeyActive);
  const modelsFn = useServerFn(listOllamaModels);
  const setup = useServerFn(setupChat);
  const [keys, setKeys] = useState<Awaited<ReturnType<typeof keysFn>>>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [pick, setPick] = useState(chat.keyId && chat.model ? `${chat.keyId}|${chat.model}` : "");
  const [label, setLabel] = useState(""); const [baseUrl, setBaseUrl] = useState(""); const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const reloadKeys = () => keysFn().then(setKeys).catch(() => {});
  useEffect(() => { if (open) void reloadKeys(); }, [open]);
  async function loadModels(id: string) {
    setOpenKey(id); setModels([]); setModel(""); setLoading(true);
    const r = await modelsFn({ data: { keyId: id } }).catch((e) => ({ models: [] as string[], error: e.message as string }));
    setLoading(false); setModels(r.models); if (r.error) toast.error(r.error);
  }
  const active = keys.filter((k) => k.active && k.active_model);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto bg-popover">
        <SheetHeader><SheetTitle>Chat keys & model</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            {keys.length === 0 && <p className="text-sm text-muted-foreground">No keys yet. Add one below.</p>}
            {keys.map((k) => <div key={k.id} className="rounded-lg border p-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 text-sm">{k.label}<span className="block truncate text-xs text-muted-foreground">{k.base_url}{k.active ? ` · active: ${k.active_model}` : ""}</span></div>
                {k.cloudflare ? <span className="text-xs text-muted-foreground">Cloudflare can't be the chat model</span>
                  : k.active ? <Button size="sm" variant="outline" onClick={async () => { await activeFn({ data: { id: k.id, model: null } }); void reloadKeys(); }}><PowerOff className="h-4 w-4 mr-1" />Deactivate</Button>
                  : <Button size="sm" variant="outline" onClick={() => loadModels(k.id)}><Power className="h-4 w-4 mr-1" />Activate</Button>}
              </div>
              {openKey === k.id && <div className="mt-2 space-y-2">
                {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading models…</div>}
                {models.length > 0 && <div className="grid max-h-48 gap-1 overflow-y-auto">
                  {models.map((m) => <button key={m} onClick={() => setModel(m)} className={`rounded-md px-3 py-2 text-left text-sm ${model === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{m}</button>)}
                </div>}
                <Button size="sm" className="w-full" disabled={!model} onClick={async () => { try { await activeFn({ data: { id: k.id, model } }); setOpenKey(null); void reloadKeys(); toast.success(`${model} activated`); } catch (e: any) { toast.error(e.message); } }}>Activate {model}</Button>
              </div>}
            </div>)}
          </div>
          <div className="grid gap-2 rounded-lg border p-3">
            <div className="text-sm font-medium">Add a key</div>
            <Input placeholder="Name" value={label} onChange={(e) => setLabel(e.target.value)} />
            <Input placeholder="Base URL (optional, default Ollama)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            <Input placeholder="API token or access token" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <Button size="sm" disabled={!label || !apiKey} onClick={async () => { try { await addFn({ data: { label, apiKey, baseUrl: baseUrl.trim() } }); setLabel(""); setBaseUrl(""); setApiKey(""); void reloadKeys(); toast.success("Key saved"); } catch (e: any) { toast.error(e.message); } }}>Save key</Button>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">Chat model</div>
            {active.length === 0 && <p className="text-xs text-muted-foreground">Activate a model on a key first.</p>}
            {active.map((k) => { const v = `${k.id}|${k.active_model}`; return <button key={k.id} onClick={() => setPick(v)} className={`w-full rounded-md px-3 py-2 text-left text-sm ${pick === v ? "bg-primary text-primary-foreground" : "border hover:bg-muted"}`}>{k.active_model} <span className="opacity-70">· {k.label}</span></button>; })}
          </div>
          <Button className="w-full" disabled={!pick || loading} onClick={async () => {
            const [keyId, ...rest] = pick.split("|"); const m = rest.join("|");
            setLoading(true);
            try { await setup({ data: { id: chat.id, keyId: keyId!, model: m, initialize: true } }); toast.success("Ready — it read your site"); onOpenChange(false); onDone(); } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
          }}>Use this model</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
