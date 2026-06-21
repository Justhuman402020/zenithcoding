import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
  Globe,
  Copy,
  ExternalLink,
  Undo2,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  History as HistoryIcon,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import { DomainsPanel } from "@/components/DomainsPanel";
import { PreviewFrame, injectConsoleBridge } from "@/components/PreviewFrame";
import { HistoryPanel } from "@/components/HistoryPanel";
import { ForgeMark } from "@/components/ForgeMark";

export const Route = createFileRoute("/_authenticated/p/$projectId")({
  head: () => ({ meta: [{ title: "Forge — editor" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    prompt: typeof search.prompt === "string" ? search.prompt : undefined,
  }),
  component: ProjectEditor,
});

type ProjectFile = { id: string; path: string; content: string };

type TabKey = "chat" | "preview" | "code" | "history";

type AttachmentFrame = { name: string; mediaType: string; url: string };
type Attachment = AttachmentFrame & { frames?: AttachmentFrame[] };

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function sampleVideoFrames(file: File, maxFrames = 4): Promise<AttachmentFrame[]> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Could not read video"));
      video.load();
    });

    const sourceWidth = video.videoWidth || 640;
    const sourceHeight = video.videoHeight || 360;
    const width = Math.min(sourceWidth, 960);
    const height = Math.max(1, Math.round(width * (sourceHeight / sourceWidth)));
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const count = Math.min(maxFrames, Math.max(1, Math.ceil(duration)));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return [];

    const frames: AttachmentFrame[] = [];
    for (let index = 0; index < count; index += 1) {
      const targetTime = Math.min(duration - 0.05, Math.max(0, ((index + 1) / (count + 1)) * duration));
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error("Could not sample video"));
        video.currentTime = Number.isFinite(targetTime) ? targetTime : 0;
      });
      context.drawImage(video, 0, 0, width, height);
      frames.push({
        name: `${file.name} frame ${index + 1}.jpg`,
        mediaType: "image/jpeg",
        url: canvas.toDataURL("image/jpeg", 0.78),
      });
    }
    return frames;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

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
      return { icon: FilePlus2, label: toolName };
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

function suggestSlug(name: string, projectId: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  if (base.length >= 3) return base;
  return `site-${projectId.slice(0, 6)}`;
}

function normalizeSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function normalizeAssetPath(path: string): string {
  return path.trim().replace(/^\.{0,2}\/+/, "").replace(/\/+/g, "/");
}

function isExternalNavigationTarget(path: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(path.trim());
}

function resolveProjectPath(path: string, fromPath = "index.html"): string {
  const raw = path.trim().split("#")[0].split("?")[0];
  if (!raw || raw === "/") return "index.html";
  if (raw.startsWith("/")) return normalizeAssetPath(raw);
  const baseDir = fromPath.includes("/") ? `${fromPath.split("/").slice(0, -1).join("/")}/` : "";
  const parts: string[] = [];
  for (const part of `${baseDir}${raw}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/") || "index.html";
}

function ProjectEditor() {
  const { projectId } = Route.useParams();
  const { prompt: initialPrompt } = Route.useSearch();
  const navigate = useNavigate();

  const [projectName, setProjectName] = useState("");
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewPath, setPreviewPath] = useState("index.html");
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("chat");

  // publish state
  const [published, setPublished] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugDraft, setSlugDraft] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // chat state
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [chatReady, setChatReady] = useState(false);
  const [openWorkLogs, setOpenWorkLogs] = useState<Record<string, boolean>>({});
  const [openToolDetails, setOpenToolDetails] = useState<Record<string, boolean>>({});
  const [openThinking, setOpenThinking] = useState<Record<string, boolean>>({});
  const [thinkingDurations, setThinkingDurations] = useState<Record<string, number>>({});
  const thinkingStartRef = useRef<Record<string, number>>({});
  const tokenRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const refreshedToolResultsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // load project + files + history + token
  useEffect(() => {
    (async () => {
      const [{ data: proj }, { data: fileData }, { data: msgs }, { data: sess }] = await Promise.all([
        supabase.from("projects").select("name,published,slug").eq("id", projectId).maybeSingle(),
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
      setPublished(!!(proj as any).published);
      const existingSlug = (proj as any).slug ?? "";
      setSlug(existingSlug);
      setSlugDraft(existingSlug || suggestSlug(proj.name, projectId));
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
    const fileMap = new Map(files.map((f) => [normalizeAssetPath(f.path), f.content]));
    const currentPath = fileMap.has(normalizeAssetPath(previewPath)) ? normalizeAssetPath(previewPath) : "index.html";
    const currentHtml = fileMap.get(currentPath);
    if (!currentHtml) return "<html><body style='font-family:sans-serif;background:#1a1525;color:#bbb;padding:2rem'>No <code>index.html</code> yet. Ask the AI to create one.</body></html>";
    // inline <link href="x.css"> and <script src="x.js">
    let html = currentHtml.replace(/<link\s+[^>]*href=["']([^"']+)["'][^>]*>/g, (m, href) => {
      if (/^(https?:)?\/\//i.test(href) || href.startsWith("data:") || href.startsWith("#")) return m;
      const css = fileMap.get(resolveProjectPath(href, currentPath));
      if (css == null) return m;
      return `<style data-from="${href}">${css}</style>`;
    });
    html = html.replace(/<script\s+([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/g, (m, pre, src, post) => {
      if (/^(https?:)?\/\//i.test(src) || src.startsWith("data:") || src.startsWith("#")) return m;
      const js = fileMap.get(resolveProjectPath(src, currentPath));
      if (js == null) return m;
      const attrs = `${pre}${post}`.trim();
      return `<script${attrs ? ` ${attrs}` : ""} data-from="${src}">${js}\n//# sourceURL=${src}</script>`;
    });
    const navigationBridge = `<script>\n(() => {\n  document.addEventListener('click', (event) => {\n    const link = event.target.closest && event.target.closest('a[href]');\n    if (!link) return;\n    const href = link.getAttribute('href') || '';\n    if (!href || /^(?:[a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(href)) return;\n    event.preventDefault();\n    parent.postMessage({ type: 'forge-preview-navigate', path: href }, '*');\n  });\n})();\n<\/script>`;
    const withNav = html.includes("</body>") ? html.replace(/<\/body>/i, `${navigationBridge}</body>`) : `${html}${navigationBridge}`;
    return injectConsoleBridge(withNav);
  }, [files, previewPath]);

  useEffect(() => {
    const available = new Set(files.map((file) => normalizeAssetPath(file.path)));
    if (files.length > 0 && !available.has(normalizeAssetPath(previewPath)) && available.has("index.html")) {
      setPreviewPath("index.html");
    }
  }, [files, previewPath]);

  useEffect(() => {
    function onPreviewMessage(event: MessageEvent) {
      const data = event.data as { type?: string; path?: string } | undefined;
      if (data?.type !== "forge-preview-navigate" || !data.path || isExternalNavigationTarget(data.path)) return;
      const targetPath = resolveProjectPath(data.path, previewPath);
      const available = new Set(files.map((file) => normalizeAssetPath(file.path)));
      const finalPath = available.has(targetPath) ? targetPath : available.has(`${targetPath}.html`) ? `${targetPath}.html` : null;
      if (!finalPath) {
        toast.error(`${targetPath} was not created yet`);
        return;
      }
      setPreviewPath(finalPath);
      setPreviewKey((key) => key + 1);
    }
    window.addEventListener("message", onPreviewMessage);
    return () => window.removeEventListener("message", onPreviewMessage);
  }, [files, previewPath]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/public/chat",
        headers: async () => {
          const { data } = await supabase.auth.getSession();
          const accessToken = data.session?.access_token ?? tokenRef.current;
          return {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            "x-project-id": projectId,
          };
        },
      }),
    [projectId],
  );

  const { messages, sendMessage, status } = useChat({
    id: token ? projectId : `${projectId}:pending`,
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

  // Track how long the AI spent "thinking" per assistant message, so we can
  // show "Thought for Xs" once it finishes.
  useEffect(() => {
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      const hasReasoning = m.parts.some((p) => p.type === "reasoning");
      if (!hasReasoning) continue;
      if (!thinkingStartRef.current[m.id]) {
        thinkingStartRef.current[m.id] = Date.now();
      }
      const isLast = m.id === messages[messages.length - 1]?.id;
      const done =
        !isStreaming ||
        !isLast ||
        m.parts.some((p) => p.type === "text" && (p as any).text?.trim());
      if (done && thinkingDurations[m.id] === undefined) {
        const seconds = Math.max(
          1,
          Math.round((Date.now() - thinkingStartRef.current[m.id]) / 1000),
        );
        setThinkingDurations((cur) => ({ ...cur, [m.id]: seconds }));
      }
    }
  }, [messages, isStreaming, thinkingDurations]);

  // Auto-send a prompt passed in via ?prompt= (from the home composer)
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (autoSentRef.current || !initialPrompt || !chatReady || !token || isStreaming) return;
    if (initialMessages.length > 0) { autoSentRef.current = true; return; }
    autoSentRef.current = true;
    (async () => {
      await sendMessage({ text: initialPrompt });
      const { data: userRes } = await supabase.auth.getUser();
      if (userRes.user) {
        await supabase.from("chat_messages").insert({
          project_id: projectId,
          user_id: userRes.user.id,
          role: "user",
          content: initialPrompt,
        });
      }
      navigate({ to: "/p/$projectId", params: { projectId }, search: {}, replace: true });
    })();
  }, [initialPrompt, chatReady, token, isStreaming, initialMessages.length, sendMessage, projectId, navigate]);

  useEffect(() => {
    let shouldRefresh = false;
    let nextPreviewPath: string | null = null;
    for (const message of messages) {
      for (const part of message.parts) {
        if (typeof part.type !== "string" || !part.type.startsWith("tool-")) continue;
        const toolPart = part as any;
        const toolName = toolPart.type.replace("tool-", "");
        const key = `${message.id}:${toolName}:${toolPart.toolCallId ?? toolPart.input?.path ?? "tool"}`;
        if (toolPart.state !== "output-available" || refreshedToolResultsRef.current.has(key)) continue;
        refreshedToolResultsRef.current.add(key);
        if (toolName === "write_file" || toolName === "delete_file") shouldRefresh = true;
        const writtenPath = normalizeAssetPath(String(toolPart.input?.path ?? toolPart.output?.path ?? ""));
        if (toolName === "write_file" && /\.html?$/i.test(writtenPath)) {
          if (/(auth|sign|signup|login|register)/i.test(writtenPath)) nextPreviewPath = writtenPath;
          else nextPreviewPath ??= writtenPath;
        }
      }
    }
    if (!shouldRefresh) return;
    refreshFiles();
    if (nextPreviewPath) setPreviewPath(nextPreviewPath);
    setTab("preview");
    setPreviewKey((k) => k + 1);
  }, [messages]);

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
    // Snapshot current files BEFORE the AI changes them, so users can roll back
    // any AI turn from the History panel.
    const filesAtSend = files.map((f) => ({ path: f.path, content: f.content }));
    if (filesAtSend.length > 0) {
      (async () => {
        try {
          const { data: userRes } = await supabase.auth.getUser();
          if (!userRes.user) return;
          const label = text ? text.slice(0, 80) : "Before image edit";
          await supabase.from("project_snapshots").insert({
            project_id: projectId,
            user_id: userRes.user.id,
            label,
            files: filesAtSend as any,
          });
        } catch {}
      })();
    }
    const videoNotes = attachments
      .filter((a) => a.mediaType.startsWith("video/"))
      .map((a) => `Attached video: ${a.name}. I extracted ${a.frames?.length ?? 0} visual frames for you to inspect.`);
    const messageText = [text, ...videoNotes].filter(Boolean).join("\n\n");
    const attachmentFiles = attachments.flatMap((a) => {
      const visualParts = a.mediaType.startsWith("video/") ? (a.frames ?? []) : [a];
      return visualParts.map((part) => ({ type: "file" as const, mediaType: part.mediaType, url: part.url, filename: part.name }));
    });
    setAttachments([]);
    await sendMessage({ text: messageText || "(see attached image)", files: attachmentFiles });
    // persist user message
    const { data: userRes } = await supabase.auth.getUser();
    if (userRes.user) {
      await supabase.from("chat_messages").insert({
        project_id: projectId,
        user_id: userRes.user.id,
        role: "user",
        content: messageText,
      });
    }
  }

  async function onPickFiles(list: FileList | null) {
    if (!list) return;
    const arr = Array.from(list).slice(0, 4);
    const reads = await Promise.all(
      arr.map(async (f) => {
        const mediaType = f.type || (f.name.toLowerCase().endsWith(".mp4") ? "video/mp4" : "image/png");
        const url = await readFileAsDataUrl(f);
        if (mediaType.startsWith("video/")) {
          const frames = await sampleVideoFrames(f).catch(() => []);
          return { name: f.name, mediaType, url, frames };
        }
        return { name: f.name, mediaType, url };
      }),
    );
    setAttachments((cur) => [...cur, ...reads].slice(0, 4));
  }

  const publicUrl = useMemo(() => {
    if (typeof window === "undefined" || !slug) return "";
    return `${window.location.origin}/s/${slug}`;
  }, [slug]);

  async function handlePublish() {
    const cleanSlug = normalizeSlug(slugDraft);
    if (cleanSlug.length < 3) {
      toast.error("URL name must be at least 3 characters (letters, numbers, dashes)");
      return;
    }
    setPublishing(true);
    // Check slug availability (only if it changed)
    if (cleanSlug !== slug) {
      const { data: clash } = await supabase
        .from("projects")
        .select("id")
        .eq("slug", cleanSlug)
        .neq("id", projectId)
        .maybeSingle();
      if (clash) {
        setPublishing(false);
        toast.error("That URL name is taken. Try another one.");
        return;
      }
    }
    const { error } = await supabase
      .from("projects")
      .update({ slug: cleanSlug, published: true })
      .eq("id", projectId);
    setPublishing(false);
    if (error) return toast.error(error.message);
    setSlug(cleanSlug);
    setPublished(true);
    toast.success("Site published");
  }

  async function handleUnpublish() {
    setPublishing(true);
    const { error } = await supabase
      .from("projects")
      .update({ published: false })
      .eq("id", projectId);
    setPublishing(false);
    if (error) return toast.error(error.message);
    setPublished(false);
    toast.success("Site unpublished");
  }

  async function copyPublicUrl() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  const [reverting, setReverting] = useState(false);
  async function revertToLastStable() {
    if (reverting) return;
    if (!confirm("Revert this project to the version saved before your most recent build? This cannot be undone.")) return;
    setReverting(true);
    try {
      const { data: snap, error: snapErr } = await supabase
        .from("project_snapshots")
        .select("id,files,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (snapErr) throw snapErr;
      if (!snap) {
        toast.error("No previous version saved yet");
        return;
      }
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) {
        toast.error("Please sign in again");
        return;
      }
      const snapFiles = (snap.files as Array<{ path: string; content: string }>) ?? [];
      const { error: delErr } = await supabase.from("files").delete().eq("project_id", projectId);
      if (delErr) throw delErr;
      if (snapFiles.length > 0) {
        const rows = snapFiles.map((f) => ({
          project_id: projectId,
          user_id: userRes.user!.id,
          path: f.path,
          content: f.content,
        }));
        const { error: insErr } = await supabase.from("files").insert(rows);
        if (insErr) throw insErr;
      }
      // consume the snapshot so repeated clicks don't keep restoring the same one
      await supabase.from("project_snapshots").delete().eq("id", snap.id);
      await refreshFiles();
      setPreviewKey((k) => k + 1);
      toast.success("Reverted to last stable version");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not revert");
    } finally {
      setReverting(false);
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
    <div className="h-[100dvh] w-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="h-14 hairline-bottom-gold flex items-center px-3 gap-2 shrink-0 bg-card/30 backdrop-blur-sm">
        <Link to="/" className="p-2 -ml-2 text-muted-foreground hover:text-primary transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <ForgeMark className="h-7 w-7 shrink-0" />
          <span className="font-display text-lg truncate text-foreground/95">{projectName}</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            await refreshFiles();
            setPreviewKey((k) => k + 1);
            if (tab !== "preview") setTab("preview");
            toast.success("Rebuilt preview from latest files");
          }}
          className="h-9 gap-1.5 text-muted-foreground hover:text-primary"
          title="Rebuild and revert preview to the latest saved files"
        >
          <RefreshCw className="h-4 w-4" />
          <span className="hidden xs:inline text-xs">Rebuild</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={revertToLastStable}
          disabled={reverting}
          className="h-9 gap-1.5 text-muted-foreground hover:text-primary"
          title="Undo the most recent build and restore the previous version"
        >
          {reverting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
          <span className="hidden xs:inline text-xs">Revert</span>
        </Button>
        <Button
          size="sm"
          variant={published ? "outline" : "default"}
          onClick={() => setPublishOpen(true)}
          className={
            published
              ? "h-9 gap-1.5 hairline-gold text-primary hover:bg-primary/10"
              : "h-9 gap-1.5 bg-gold-gradient text-primary-foreground hover:opacity-95 shadow-gold-glow"
          }
          title={published ? "Manage published site" : "Publish this site"}
        >
          <Globe className="h-4 w-4" />
          <span className="hidden xs:inline">{published ? "Published" : "Publish"}</span>
        </Button>
      </header>

      {/* Tabs */}
      <nav className="flex hairline-bottom-gold shrink-0 bg-card/40">
        {([
          { k: "chat", label: "Chat", icon: MessageSquare },
          { k: "preview", label: "Preview", icon: Eye },
          { k: "code", label: "Code", icon: Code2 },
          { k: "history", label: "History", icon: HistoryIcon },
        ] as const).map(({ k, label, icon: Icon }) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors border-b-2 -mb-px ${
              tab === k
                ? "border-primary text-primary"
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
                  <ForgeMark className="h-14 w-14 mx-auto" glow />
                  <h2 className="font-display text-2xl">What will we forge?</h2>
                  <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                    Describe what you want and I'll build it. You'll see it take shape live in <em className="text-primary not-italic">Preview</em>.
                  </p>
                  <div className="grid gap-2 max-w-xs mx-auto pt-2">
                    {[
                      "An editorial portfolio in gold and noir",
                      "A reservation page for a private restaurant",
                      "A landing page for a luxury watch brand",
                    ].map((s) => (
                      <button
                        key={s}
                        onClick={() => setInput(s)}
                        className="text-left text-sm px-3.5 py-2 rounded-lg hairline-gold hover:bg-accent/30 text-muted-foreground hover:text-primary transition-colors"
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
                const showTools = toolParts.length > 0;
                const workOpen = openWorkLogs[m.id] ?? (isStreaming && m.id === messages[messages.length - 1]?.id);
                const reasoningParts = m.parts.filter(
                  (p): p is Extract<typeof p, { type: "reasoning" }> => p.type === "reasoning",
                );
                const reasoningText = reasoningParts
                  .map((p) => (p as any).text ?? "")
                  .join("\n")
                  .trim();
                const isLastStreaming = isStreaming && m.id === messages[messages.length - 1]?.id;
                const thinkingActive =
                  isLastStreaming &&
                  reasoningParts.length > 0 &&
                  !text &&
                  !toolParts.some((t) => t.state === "output-available");
                const thinkOpen = openThinking[m.id] ?? thinkingActive;
                return (
                  <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                    <div
                      className={
                        m.role === "user"
                          ? "rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[85%] bg-primary text-primary-foreground text-sm whitespace-pre-wrap"
                          : "max-w-full text-sm space-y-2 w-full"
                      }
                    >
                      {m.role === "assistant" && reasoningText && (
                        <div className="space-y-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenThinking((cur) => ({ ...cur, [m.id]: !thinkOpen }))
                            }
                            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
                          >
                            {thinkingActive ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                            ) : (
                              <Lightbulb className="h-3.5 w-3.5 text-primary" />
                            )}
                            <span>
                              {thinkingActive
                                ? "Thinking…"
                                : `Thought${
                                    thinkingDurations[m.id]
                                      ? ` for ${thinkingDurations[m.id]}s`
                                      : ""
                                  }`}
                            </span>
                            {thinkOpen ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                          </button>
                          {thinkOpen && (
                            <div className="rounded-lg border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground/90 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                              {reasoningText}
                            </div>
                          )}
                        </div>
                      )}
                      {showTools && (
                        <div className="space-y-1.5">
                          <button
                            type="button"
                            onClick={() => setOpenWorkLogs((current) => ({ ...current, [m.id]: !workOpen }))}
                            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
                          >
                            {toolParts.some((t) => t.state !== "output-available") ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                            )}
                            View work log
                          </button>
                          {workOpen && (
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
            <form onSubmit={handleSend} className="p-3 hairline-top-gold bg-card/40 space-y-2">
              {attachments.length > 0 && (
                <div className="flex gap-2 overflow-x-auto">
                  {attachments.map((a, i) => (
                    <div key={i} className="relative shrink-0">
                      {a.mediaType.startsWith("video/") ? (
                        <video src={a.url} className="h-16 w-16 object-cover rounded-lg border border-border" muted playsInline />
                      ) : (
                        <img src={a.url} alt={a.name} className="h-16 w-16 object-cover rounded-lg border border-border" />
                      )}
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
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => { onPickFiles(e.target.files); e.target.value = ""; }}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*,video/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => { onPickFiles(e.target.files); e.target.value = ""; }}
                />
                <Button type="button" size="icon" variant="ghost" className="h-11 w-11 shrink-0" onClick={() => fileInputRef.current?.click()} title="Attach image or video">
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="h-11 w-11 shrink-0" onClick={() => cameraInputRef.current?.click()} title="Take photo or video">
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
                <Button
                  type="submit"
                  size="icon"
                  className="h-11 w-11 shrink-0 bg-gold-gradient text-primary-foreground hover:opacity-95 shadow-gold-glow rounded-xl"
                  disabled={(!input.trim() && attachments.length === 0) || !token || isStreaming}
                >
                  {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </form>
          </div>
        )}

        {tab === "preview" && (
          <PreviewFrame
            srcDoc={previewDoc}
            previewKey={previewKey}
            onRefresh={async () => {
              await refreshFiles();
              setPreviewKey((k) => k + 1);
            }}
            openInNewTab={
              published && slug
                ? () => window.open(`/s/${slug}`, "_blank")
                : undefined
            }
          />
        )}

        {tab === "history" && (
          <HistoryPanel
            projectId={projectId}
            onRestored={async () => {
              await refreshFiles();
              setPreviewKey((k) => k + 1);
              setTab("preview");
            }}
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

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              <span className="font-display text-2xl">
                {published ? "Your site is live" : "Publish your site"}
              </span>
            </DialogTitle>
            <DialogDescription>
              {published
                ? "Anyone with the link can view your site. Update it any time."
                : "Pick a URL name and we'll publish your project to the public web."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="slug">URL name</Label>
              <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 focus-within:ring-2 focus-within:ring-ring">
                <span className="text-xs text-muted-foreground select-none">/s/</span>
                <Input
                  id="slug"
                  value={slugDraft}
                  onChange={(e) => setSlugDraft(normalizeSlug(e.target.value))}
                  placeholder="my-cool-site"
                  className="border-0 bg-transparent px-0 focus-visible:ring-0 h-10"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Letters, numbers and dashes — 3 to 40 characters.
              </p>
            </div>

            {published && publicUrl && (
              <div className="space-y-1.5">
                <Label>Public link</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                    {publicUrl}
                  </div>
                  <Button type="button" size="icon" variant="outline" onClick={copyPublicUrl} className="h-9 w-9 shrink-0" title="Copy link">
                    <Copy className="h-4 w-4" />
                  </Button>
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-accent shrink-0"
                    title="Open in new tab"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </div>
            )}

            <div className="border-t border-border pt-4">
              <DomainsPanel projectId={projectId} />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            {published && (
              <Button
                type="button"
                variant="outline"
                onClick={handleUnpublish}
                disabled={publishing}
              >
                Unpublish
              </Button>
            )}
            <Button
              type="button"
              onClick={handlePublish}
              disabled={publishing}
              className="bg-gold-gradient text-primary-foreground hover:opacity-95 shadow-gold-glow"
            >
              {publishing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : published ? (
                "Update"
              ) : (
                "Publish"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}