import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ArrowLeft,
  File as FileIcon,
  FilePlus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Loader2,
  MessageSquare,
  Eye,
  Code2,
  CheckCircle2,
  Pencil,
  FilePlus2,
  FileSearch,
  FileX2,
  ListTree,
  Paperclip,
  Camera,
  X,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";

export const Route = createFileRoute("/_authenticated/p/$projectId")({
  head: () => ({ meta: [{ title: "Forge — editor" }] }),
  component: ProjectEditor,
});

type ProjectFile = { id: string; path: string; content: string };

type TabKey = "chat" | "preview" | "code";

function toolLabel(toolName: string, input: any, state: string) {
  const verbing = state === "output-available" ? "done" : "active";
  const path = input?.path as string | undefined;
  switch (toolName) {
    case "write_file":
      return { icon: verbing === "done" ? CheckCircle2 : Pencil, label: verbing === "done" ? `Updated ${path ?? "file"}` : `Editing ${path ?? "file"}…` };
    case "read_file":
      return { icon: FileSearch, label: verbing === "done" ? `Read ${path ?? "file"}` : `Reading ${path ?? "file"}…` };
    case "delete_file":
      return { icon: FileX2, label: verbing === "done" ? `Deleted ${path ?? "file"}` : `Deleting ${path ?? "file"}…` };
    case "list_files":
      return { icon: ListTree, label: verbing === "done" ? "Listed files" : "Listing files…" };
    default:
      return { icon: Sparkles, label: toolName };
  }
}

function languageOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts": case "tsx": return "typescript";
    case "js": case "jsx": case "mjs": return "javascript";
    case "json": return "json";
    case "html": case "htm": return "html";
    case "css": return "css";
    case "md": return "markdown";
    case "py": return "python";
    default: return "plaintext";
  }
}

function ProjectEditor() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();

  const [projectName, setProjectName] = useState("");
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [previewKey, setPreviewKey] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("chat");

  // chat state
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<{ name: string; mediaType: string; url: string }[]>([]);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [chatReady, setChatReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // load project + files + history + token
  useEffect(() => {
    (async () => {
      const [{ data: proj }, { data: fileData }, { data: msgs }, { data: sess }] = await Promise.all([
        supabase.from("projects").select("name").eq("id", projectId).maybeSingle(),
        supabase.from("files").select("id,path,content").eq("project_id", projectId).order("path"),
        supabase.from("chat_messages").select("id,role,content,created_at").eq("project_id", projectId).order("created_at"),
        supabase.auth.getSession(),
      ]);
      if (!proj) {
        toast.error("Project not found");
        navigate({ to: "/" });
        return;
      }
      setProjectName(proj.name);
      const list = (fileData ?? []) as ProjectFile[];
      setFiles(list);
      setActivePath(list.find((f) => f.path === "index.html")?.path ?? list[0]?.path ?? null);
      setLoadingFiles(false);
      setToken(sess.session?.access_token ?? null);
      setInitialMessages(
        (msgs ?? []).map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          parts: [{ type: "text", text: m.content }],
        })) as UIMessage[],
      );
      setChatReady(true);
    })();
  }, [projectId, navigate]);

  const activeFile = useMemo(() => files.find((f) => f.path === activePath) ?? null, [files, activePath]);

  async function refreshFiles() {
    const { data } = await supabase
      .from("files")
      .select("id,path,content")
      .eq("project_id", projectId)
      .order("path");
    setFiles((data ?? []) as ProjectFile[]);
  }

  async function saveActive(content: string) {
    if (!activeFile) return;
    setFiles((fs) => fs.map((f) => (f.id === activeFile.id ? { ...f, content } : f)));
    await supabase.from("files").update({ content }).eq("id", activeFile.id);
  }

  async function createFile() {
    const path = prompt("New file path (e.g. style.css)");
    if (!path) return;
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) return;
    const { error } = await supabase.from("files").insert({
      project_id: projectId,
      user_id: userRes.user.id,
      path,
      content: "",
    });
    if (error) return toast.error(error.message);
    await refreshFiles();
    setActivePath(path);
  }

  async function deleteFile(path: string) {
    if (!confirm(`Delete ${path}?`)) return;
    await supabase.from("files").delete().eq("project_id", projectId).eq("path", path);
    await refreshFiles();
    if (activePath === path) setActivePath(null);
  }

  // build preview srcDoc
  const previewDoc = useMemo(() => {
    const indexHtml = files.find((f) => f.path === "index.html")?.content;
    if (!indexHtml) return "<html><body style='font-family:sans-serif;background:#1a1525;color:#bbb;padding:2rem'>No <code>index.html</code> yet. Ask the AI to create one.</body></html>";
    const fileMap = new Map(files.map((f) => [f.path, f.content]));
    // inline <link href="x.css"> and <script src="x.js">
    let html = indexHtml.replace(/<link\s+[^>]*href=["']([^"']+)["'][^>]*>/g, (m, href) => {
      const css = fileMap.get(href);
      if (css == null) return m;
      return `<style data-from="${href}">${css}</style>`;
    });
    html = html.replace(/<script\s+([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/g, (m, pre, src, post) => {
      const js = fileMap.get(src);
      if (js == null) return m;
      const typeAttr = /type=/.test(pre + post) ? "" : ' type="text/javascript"';
      return `<script${typeAttr} data-from="${src}">${js}\n//# sourceURL=${src}</script>`;
    });
    return html;
  }, [files]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/public/chat",
        headers: () => ({
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "x-project-id": projectId,
        }),
      }),
    [token, projectId],
  );

  const { messages, sendMessage, status } = useChat({
    id: projectId,
    messages: initialMessages,
    transport,
    onError: (err) => toast.error(err.message),
    onFinish: () => {
      // AI may have written files via tools
      refreshFiles();
      setPreviewKey((k) => k + 1);
      setTimeout(() => inputRef.current?.focus(), 50);
    },
  });

  const isStreaming = status === "submitted" || status === "streaming";

  // auto-scroll chat
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isStreaming]);

  // keep input focused
  useEffect(() => {
    if (chatReady) inputRef.current?.focus();
  }, [chatReady, tab]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if ((!text && attachments.length === 0) || isStreaming || !token) return;
    setInput("");
    const files = attachments.map((a) => ({ type: "file" as const, mediaType: a.mediaType, url: a.url, filename: a.name }));
    setAttachments([]);
    await sendMessage({ text: text || "(see attached image)", files });
    // persist user message
    const { data: userRes } = await supabase.auth.getUser();
    if (userRes.user) {
      await supabase.from("chat_messages").insert({
        project_id: projectId,
        user_id: userRes.user.id,
        role: "user",
        content: text,
      });
    }
  }

  async function onPickFiles(list: FileList | null) {
    if (!list) return;
    const arr = Array.from(list).slice(0, 4);
    const reads = await Promise.all(
      arr.map(
        (f) =>
          new Promise<{ name: string; mediaType: string; url: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ name: f.name, mediaType: f.type || "image/png", url: reader.result as string });
            reader.onerror = reject;
            reader.readAsDataURL(f);
          }),
      ),
    );
    setAttachments((cur) => [...cur, ...reads].slice(0, 4));
  }

  // persist assistant messages when they complete
  const lastPersistedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (isStreaming) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || lastPersistedRef.current.has(last.id)) return;
    const text = last.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
      .trim();
    if (!text) return;
    lastPersistedRef.current.add(last.id);
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) return;
      await supabase.from("chat_messages").insert({
        project_id: projectId,
        user_id: userRes.user.id,
        role: "assistant",
        content: text,
      });
    })();
  }, [messages, isStreaming, projectId]);

  return (
    <div className="h-[100dvh] w-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="h-14 border-b border-border flex items-center px-3 gap-2 shrink-0">
        <Link to="/" className="p-2 -ml-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="h-7 w-7 rounded-md flex items-center justify-center shrink-0" style={{ background: "var(--gradient-primary)" }}>
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="text-sm font-semibold truncate">{projectName}</span>
        </div>
        {tab === "preview" && (
          <Button size="sm" variant="ghost" onClick={() => setPreviewKey((k) => k + 1)} className="h-9">
            <RefreshCw className="h-4 w-4" />
          </Button>
        )}
      </header>

      {/* Tabs */}
      <nav className="flex border-b border-border shrink-0 bg-card/40">
        {([
          { k: "chat", label: "Chat", icon: MessageSquare },
          { k: "preview", label: "Preview", icon: Eye },
          { k: "code", label: "Code", icon: Code2 },
        ] as const).map(({ k, label, icon: Icon }) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors border-b-2 ${
              tab === k
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {tab === "chat" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {chatReady && messages.length === 0 && (
                <div className="text-center py-12 space-y-3">
                  <div className="h-12 w-12 mx-auto rounded-xl flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
                    <Sparkles className="h-6 w-6 text-primary-foreground" />
                  </div>
                  <h2 className="text-base font-semibold">What do you want to build?</h2>
                  <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                    Describe your idea and I'll create it. You'll see the changes live in the Preview tab.
                  </p>
                  <div className="grid gap-2 max-w-xs mx-auto pt-2">
                    {[
                      "Make a landing page for a coffee shop",
                      "Build a todo list app",
                      "Create a portfolio site",
                    ].map((s) => (
                      <button
                        key={s}
                        onClick={() => setInput(s)}
                        className="text-left text-sm px-3 py-2 rounded-lg border border-border hover:bg-accent/40 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m) => {
                const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
                const toolParts = m.parts.filter((p): p is any => typeof p.type === "string" && p.type.startsWith("tool-"));
                return (
                  <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                    <div
                      className={
                        m.role === "user"
                          ? "rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[85%] bg-primary text-primary-foreground text-sm whitespace-pre-wrap"
                          : "max-w-full text-sm space-y-2 w-full"
                      }
                    >
                      {toolParts.length > 0 && (
                        <div className="space-y-1.5">
                          {toolParts.map((t, i) => {
                            const name = t.type.replace("tool-", "");
                            const { icon: Icon, label } = toolLabel(name, t.input, t.state);
                            const active = t.state !== "output-available";
                            return (
                              <div
                                key={i}
                                className="flex items-center gap-2 text-xs rounded-lg border border-border bg-card/60 px-3 py-2"
                              >
                                {active ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                                ) : (
                                  <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                                )}
                                <span className="truncate">{label}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {m.role === "assistant"
                        ? text && (
                            <div className="prose prose-invert prose-sm max-w-none break-words">
                              <ReactMarkdown>{text}</ReactMarkdown>
                            </div>
                          )
                        : <span>{text}</span>}
                    </div>
                  </div>
                );
              })}
              {isStreaming && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span>Working…</span>
                </div>
              )}
            </div>
            <form onSubmit={handleSend} className="p-3 border-t border-border bg-card/40 space-y-2">
              {attachments.length > 0 && (
                <div className="flex gap-2 overflow-x-auto">
                  {attachments.map((a, i) => (
                    <div key={i} className="relative shrink-0">
                      <img src={a.url} alt={a.name} className="h-16 w-16 object-cover rounded-lg border border-border" />
                      <button
                        type="button"
                        onClick={() => setAttachments((cur) => cur.filter((_, j) => j !== i))}
                        className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 items-end">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => { onPickFiles(e.target.files); e.target.value = ""; }}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => { onPickFiles(e.target.files); e.target.value = ""; }}
                />
                <Button type="button" size="icon" variant="ghost" className="h-11 w-11 shrink-0" onClick={() => fileInputRef.current?.click()} title="Attach image">
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="h-11 w-11 shrink-0" onClick={() => cameraInputRef.current?.click()} title="Take photo">
                  <Camera className="h-4 w-4" />
                </Button>
                <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(e as any);
                  }
                }}
                placeholder="Ask Forge to build…"
                disabled={!token}
                rows={1}
                className="resize-none min-h-[44px] max-h-32 text-base"
                />
                <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={(!input.trim() && attachments.length === 0) || !token || isStreaming}>
                  {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </form>
          </div>
        )}

        {tab === "preview" && (
          <iframe
            key={previewKey}
            title="preview"
            sandbox="allow-scripts allow-forms allow-modals"
            className="flex-1 bg-white w-full"
            srcDoc={previewDoc}
          />
        )}

        {tab === "code" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-card/40 shrink-0">
              {loadingFiles ? (
                <span className="px-3 py-2 text-xs text-muted-foreground">Loading…</span>
              ) : files.length === 0 ? (
                <span className="px-3 py-2 text-xs text-muted-foreground">No files yet — ask Forge to create one</span>
              ) : (
                files.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setActivePath(f.path)}
                    className={`group flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap border-b-2 ${
                      activePath === f.path
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground"
                    }`}
                  >
                    <FileIcon className="h-3 w-3" />
                    {f.path}
                    <Trash2
                      onClick={(e) => { e.stopPropagation(); deleteFile(f.path); }}
                      className="h-3 w-3 ml-1 opacity-40 hover:opacity-100 hover:text-destructive"
                    />
                  </button>
                ))
              )}
              <button onClick={createFile} className="px-3 py-2 text-xs text-primary shrink-0">
                <FilePlus className="h-3.5 w-3.5" />
              </button>
            </div>
            {activeFile ? (
              <Editor
                height="100%"
                theme="vs-dark"
                path={activeFile.path}
                language={languageOf(activeFile.path)}
                value={activeFile.content}
                onChange={(v) => saveActive(v ?? "")}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                }}
              />
            ) : (
              <div className="h-full grid place-items-center text-sm text-muted-foreground p-6 text-center">
                Select a file above to view or edit its code
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}