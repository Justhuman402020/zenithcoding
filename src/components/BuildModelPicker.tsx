import { useState } from "react";
import { Check, Image, Info, Search } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { routerPriceLabel, searchRouterModels, tokenPrice, type RouterModel } from "@/lib/openrouter-catalog";

export function BuildModelPicker({ kind, models, selected, onSelect }: {
  kind: "text" | "image"; models: RouterModel[]; selected: string; onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [about, setAbout] = useState<RouterModel | null>(null);
  const items = searchRouterModels(models, query, kind === "image");
  const chosen = models.find((m) => m.id === selected);
  return <div className="min-w-0 space-y-2">
    <span className="text-sm">{kind === "image" ? "Image model" : "Text model"}</span>
    <Button variant="outline" className="h-auto min-h-10 w-full justify-start whitespace-normal text-left" onClick={() => setOpen(true)} aria-label={`Choose ${kind} build model`}>
      <span className="min-w-0 break-words">{chosen?.label ?? selected || "Select manually"}</span>
    </Button>
    {chosen && <p className="break-all text-xs text-muted-foreground">{chosen.id} · {routerPriceLabel(chosen.pricing)}</p>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl overflow-hidden">
      <DialogHeader><DialogTitle>{kind === "image" ? "Image models" : "OpenRouter models"}</DialogTitle><DialogDescription>{items.length} / {models.length} models · Build key</DialogDescription></DialogHeader>
      <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" aria-label={`Search ${kind} models`} placeholder="Search model name, ID, or description" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      <div className="max-h-[55dvh] overflow-y-auto divide-y" role="list" aria-label={`${kind} model catalog`}>
        {items.map((m) => <div key={m.id} className="flex min-w-0 items-center gap-2 py-2" role="listitem">
          <Button variant={m.id === selected ? "secondary" : "ghost"} className="h-auto min-h-12 min-w-0 flex-1 justify-start gap-2 whitespace-normal text-left" onClick={() => { onSelect(m.id); setOpen(false); }} aria-label={`Select ${m.label}`}>
            {m.id === selected && <Check className="h-4 w-4 shrink-0" />}
            <span className="min-w-0 flex-1"><span className="block break-words text-sm">{m.label}</span><span className="block break-all text-xs text-muted-foreground">{m.id}</span><span className="block text-xs text-muted-foreground">{routerPriceLabel(m.pricing)}</span></span>
            {m.vision && <Image className="h-4 w-4 shrink-0 text-primary" aria-label="Accepts image input" />}
          </Button>
          <Button size="icon" variant="ghost" className="shrink-0" title={`About ${m.label}`} aria-label={`About ${m.label}`} onClick={() => setAbout(m)}><Info className="h-4 w-4" /></Button>
        </div>)}
        {!items.length && <p className="py-6 text-sm text-muted-foreground">No models found.</p>}
      </div>
    </DialogContent></Dialog>
    <Dialog open={!!about} onOpenChange={(value) => { if (!value) setAbout(null); }}><DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
      {about && <><DialogHeader><DialogTitle className="break-words pr-6">{about.label}</DialogTitle><DialogDescription className="break-all">{about.id}</DialogDescription></DialogHeader>
        <p className="whitespace-pre-wrap text-sm">{about.description || "No description supplied by OpenRouter."}</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Price</dt><dd>{routerPriceLabel(about.pricing)}</dd>
          <dt className="text-muted-foreground">Image input</dt><dd>{about.vision ? "Supported" : "Not declared"}</dd>
          <dt className="text-muted-foreground">Inputs</dt><dd className="break-words">{about.inputModalities.join(", ") || "Not provided"}</dd>
          <dt className="text-muted-foreground">Outputs</dt><dd>{about.outputModalities.join(", ") || "Not provided"}</dd>
          <dt className="text-muted-foreground">Context</dt><dd>{about.contextLength?.toLocaleString() ?? "Not provided"} tokens</dd>
          <dt className="text-muted-foreground">Max output</dt><dd>{about.topProvider.max_completion_tokens?.toLocaleString() ?? "Not provided"}</dd>
          <dt className="text-muted-foreground">Input price</dt><dd>{tokenPrice(about.pricing.prompt)}</dd>
          <dt className="text-muted-foreground">Output price</dt><dd>{tokenPrice(about.pricing.completion)}</dd>
        </dl>
        <div><h3 className="text-sm font-medium">Supported parameters</h3><p className="break-words text-sm text-muted-foreground">{about.supportedParameters.join(", ") || "Not provided"}</p></div>
        <details><summary className="cursor-pointer text-sm">All OpenRouter details</summary><pre className="mt-2 max-w-full whitespace-pre-wrap break-all text-xs">{JSON.stringify(about.details, null, 2)}</pre></details>
        <a href={`https://openrouter.ai/${about.id}`} target="_blank" rel="noreferrer" className="text-sm text-primary underline">View on OpenRouter</a>
      </>}
    </DialogContent></Dialog>
  </div>;
}