import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Home, MessageSquare, MoreHorizontal, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { createChat, deleteChat, listChats, renameChat } from "@/lib/assistant.functions";

export const Route = createFileRoute("/_authenticated/chats/")({
  head: () => ({ meta: [{ title: "Chats — Code Haven" }, { name: "description", content: "Talk with your Code Haven helper about any project." }, { property: "og:title", content: "Chats — Code Haven" }, { property: "og:description", content: "Talk with your Code Haven helper about any project." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: ChatsPage,
});

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

function ChatsPage() {
  const list = useServerFn(listChats);
  const create = useServerFn(createChat);
  const remove = useServerFn(deleteChat);
  const rename = useServerFn(renameChat);
  const navigate = useNavigate();
  const [chats, setChats] = useState<Awaited<ReturnType<typeof list>>>([]);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const reload = () => list().then(setChats).catch(() => {});
  useEffect(() => { void reload(); }, []);
  const shown = chats.filter((c) => !q || `${c.title} ${c.projectName ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  async function newChat() { const { id } = await create(); navigate({ to: "/chats/$chatId", params: { chatId: id } }); }
  return (
    <div className="min-h-screen bg-background text-foreground pb-36">
      <div className="mx-auto max-w-2xl px-5 pt-6">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold">Chats</h1>
          <Button variant="outline" size="icon" className="rounded-full h-11 w-11" onClick={() => setSearching((s) => !s)} aria-label="Search chats"><Search className="h-5 w-5" /></Button>
        </div>
        {searching && <Input autoFocus className="mt-4" placeholder="Search chats…" value={q} onChange={(e) => setQ(e.target.value)} />}
        <div className="mt-6 space-y-5">
          {shown.length === 0 && <p className="text-muted-foreground text-sm">No chats yet. Tap New chat to start.</p>}
          {shown.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-3">
              <Link to="/chats/$chatId" params={{ chatId: c.id }} className="min-w-0 flex-1">
                <div className="truncate text-lg font-semibold">{c.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{ago(c.updatedAt)}</span>
                  {c.projectName && <span className="rounded-full bg-muted px-3 py-0.5 text-foreground">{c.projectName}</span>}
                  {c.model && <span className="rounded-full bg-muted px-3 py-0.5">{c.model}</span>}
                </div>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="rounded-full" aria-label="Chat options"><MoreHorizontal className="h-5 w-5" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={async () => { const t = window.prompt("Rename chat", c.title); if (t) { await rename({ data: { id: c.id, title: t } }); void reload(); } }}>Rename</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onSelect={async () => { if (window.confirm("Delete this chat?")) { await remove({ data: { id: c.id } }); void reload(); } }}>Delete chat</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 flex flex-col items-center gap-3 pb-5">
        <Button onClick={newChat} className="rounded-full px-6 h-12 text-base"><Plus className="h-5 w-5 mr-1" />New chat</Button>
        <div className="flex items-center gap-10 rounded-full border bg-card px-8 py-3">
          <Link to="/" aria-label="Home"><Home className="h-6 w-6" /></Link>
          <span aria-label="Chats" className="text-primary"><MessageSquare className="h-6 w-6" /></span>
        </div>
      </div>
    </div>
  );
}
