import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Eye, Loader2, RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getEditorModelControls, refreshEditorModelControls, type EditorModelOption } from "@/lib/model-controls.functions";
import { MODEL_STORAGE_KEY } from "@/lib/ai-providers";

export const VISION_MODEL_STORAGE_KEY = "forge:vision-model";

function Picker({ kind, items, selected, onSelect, refreshing, onRefresh }: { kind: "vision" | "coding"; items: EditorModelOption[]; selected: string; onSelect: (item: EditorModelOption) => void; refreshing: boolean; onRefresh: () => void }) {
  const isVision = kind === "vision";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="icon" className="h-8 w-8 rounded-full shrink-0" title={isVision ? "Choose an image reader" : "Choose a Cloudflare coding model"} aria-label={isVision ? "Vision models" : "Coding models"}>
          <Zap className="h-4 w-4 text-primary" fill="currentColor" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-1.5rem)]">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0 flex items-center gap-2">{isVision ? <Eye className="h-4 w-4" /> : <Zap className="h-4 w-4" />} {isVision ? "Image readers" : "Cloudflare coding"}</DropdownMenuLabel>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={refreshing} onClick={(event) => { event.preventDefault(); onRefresh(); }} title="Refresh working models">
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <DropdownMenuSeparator />
        {items.length === 0 ? <div className="px-2 py-4 text-xs text-muted-foreground">No working {isVision ? "image models" : "Cloudflare models"} found.</div> : items.map((item) => {
          const key = `${item.provider}:${item.model}`;
          return <DropdownMenuItem key={key} onSelect={() => onSelect(item)} className="items-start">
            <Check className={`mt-0.5 h-3.5 w-3.5 ${selected === key ? "opacity-100 text-primary" : "opacity-0"}`} />
            <span className="min-w-0"><span className="flex items-center gap-1.5 truncate text-sm">{item.label}{!isVision && item.vision ? <span className="rounded border px-1 text-[10px] uppercase text-muted-foreground">vision</span> : null}</span><span className="block truncate text-[11px] text-muted-foreground">{item.keyNumber ? `Key #${item.keyNumber} · ` : ""}{item.keyLabel}</span></span>
          </DropdownMenuItem>;
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ChatModelControls() {
  const load = useServerFn(getEditorModelControls);
  const refresh = useServerFn(refreshEditorModelControls);
  const [data, setData] = useState<Awaited<ReturnType<typeof load>> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [visionSelected, setVisionSelected] = useState("");
  const [codingSelected, setCodingSelected] = useState("");
  useEffect(() => {
    setVisionSelected(localStorage.getItem(VISION_MODEL_STORAGE_KEY) ?? "");
    setCodingSelected(localStorage.getItem(MODEL_STORAGE_KEY) ?? "");
    void load({}).then(setData).catch(() => {});
  }, [load]);
  const coding = useMemo(() => {
    const seen = new Set<string>();
    return (data?.coding ?? []).filter((item) => seen.has(item.model) ? false : (seen.add(item.model), true));
  }, [data]);
  async function doRefresh() {
    setRefreshing(true);
    try { const next = await refresh({}); setData(next); toast.success("Working models refreshed"); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not refresh models"); } finally { setRefreshing(false); }
  }
  return <div className="inline-flex items-center gap-1" aria-label="Model controls">
    <Picker kind="vision" items={data?.vision ?? []} selected={visionSelected} refreshing={refreshing} onRefresh={doRefresh} onSelect={(item) => { const key = `${item.provider}:${item.model}`; localStorage.setItem(VISION_MODEL_STORAGE_KEY, key); setVisionSelected(key); toast.success(`${item.label} will read the next image`); }} />
    <Picker kind="coding" items={coding} selected={codingSelected} refreshing={refreshing} onRefresh={doRefresh} onSelect={(item) => { const key = `${item.provider}:${item.model}`; localStorage.setItem(MODEL_STORAGE_KEY, key); setCodingSelected(key); toast.success(`${item.label} selected for coding`); }} />
  </div>;
}
