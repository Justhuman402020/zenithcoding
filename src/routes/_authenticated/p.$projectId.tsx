import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableHandle,
} from "@/components/ui/resizable";
import { toast } from "sonner";
import {
  ArrowLeft,
  File as FileIcon,
  FilePlus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Play,
  Loader2,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";

export const Route = createFileRoute("/_authenticated/p/$projectId")({
  head: () => ({ meta: [{ title: "Forge — editor" }] }),
  component: ProjectEditor,
});

type ProjectFile = { id: string; path: string; content: string };

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

  // chat state
  const [input, setInput] = useState("");
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [chatReady, setChatReady] = useState(false);

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
        api: "/api/chat",
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
    },
  });

  const isStreaming = status === "submitted" || status === "streaming";

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isStreaming || !token) return;
    setInput("");
    await sendMessage({ text });
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
    <div className="h-screen w-screen flex flex-col bg-background">
      <header className="h-12 border-b border-border flex items-center px-3 gap-3 shrink-0">
        <Link to="/" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
            <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <span className="text-sm font-medium">{projectName}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setPreviewKey((k) => k + 1)}>
            <RefreshCw className="h-4 w-4 mr-1" /> Reload preview
          </Button>
        </div>
      </header>

      <ResizablePanelGroup orientation="horizontal" className="flex-1">
        {/* Files */}
        <ResizablePanel defaultSize={16} minSize={10} className="bg-sidebar">
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Files</span>
              <button onClick={createFile} className="p-1 rounded hover:bg-accent" aria-label="New file">
                <FilePlus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto py-1">
              {loadingFiles ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
              ) : files.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">No files yet</div>
              ) : (
                files.map((f) => (
                  <div
                    key={f.id}
                    className={`group flex items-center justify-between px-3 py-1.5 text-sm cursor-pointer hover:bg-accent/40 ${
                      activePath === f.path ? "bg-accent/60 text-foreground" : "text-muted-foreground"
                    }`}
                    onClick={() => setActivePath(f.path)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileIcon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{f.path}</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteFile(f.path); }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-destructive"
                      aria-label="delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle />

        {/* Chat + Editor */}
        <ResizablePanel defaultSize={50} minSize={30}>
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize={55} minSize={20}>
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
                <div className="h-full grid place-items-center text-sm text-muted-foreground">
                  Select a file to edit
                </div>
              )}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={45} minSize={20} className="flex flex-col bg-card">
              <div className="px-3 py-2 border-b border-border flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs uppercase tracking-wide text-muted-foreground">AI Chat</span>
              </div>
              <div className="flex-1 overflow-auto p-4 space-y-4">
                {chatReady && messages.length === 0 && (
                  <div className="text-sm text-muted-foreground">
                    Ask the AI to build something. It can create, read and edit files in this project.
                  </div>
                )}
                {messages.map((m) => {
                  const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
                  const tools = m.parts.filter((p): p is Extract<typeof p, { type: `tool-${string}` }> => p.type.startsWith("tool-"));
                  return (
                    <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                      <div
                        className={
                          m.role === "user"
                            ? "rounded-lg px-3 py-2 max-w-[85%] bg-primary text-primary-foreground text-sm"
                            : "max-w-full text-sm space-y-2"
                        }
                      >
                        {tools.length > 0 && (
                          <div className="space-y-1">
                            {tools.map((t, i) => (
                              <div key={i} className="text-xs rounded border border-border bg-background/40 px-2 py-1 text-muted-foreground">
                                <span className="text-primary">⚡</span> {t.type.replace("tool-", "")}
                              </div>
                            ))}
                          </div>
                        )}
                        {m.role === "assistant" ? (
                          <div className="prose prose-invert prose-sm max-w-none">
                            <ReactMarkdown>{text}</ReactMarkdown>
                          </div>
                        ) : (
                          <span>{text}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {isStreaming && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                  </div>
                )}
              </div>
              <form onSubmit={handleSend} className="p-3 border-t border-border flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask the AI to build, edit, or explain…"
                  disabled={!token || isStreaming}
                />
                <Button type="submit" size="icon" disabled={!input.trim() || !token || isStreaming}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle />

        {/* Preview */}
        <ResizablePanel defaultSize={34} minSize={20}>
          <div className="h-full flex flex-col bg-background">
            <div className="px-3 py-2 border-b border-border flex items-center gap-2">
              <Play className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Preview</span>
            </div>
            <iframe
              key={previewKey}
              title="preview"
              sandbox="allow-scripts allow-forms allow-modals"
              className="flex-1 bg-white"
              srcDoc={previewDoc}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}