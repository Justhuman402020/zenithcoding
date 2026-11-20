import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Slash } from "lucide-react";
import { listBrainSkills } from "@/lib/admin-brain.functions";

/** "/" menu: every Brain skill. Refetches on open so newly saved skills show up. */
export function SkillMenu({ filter, onPick }: { filter: string; onPick: (command: string) => void }) {
  const load = useServerFn(listBrainSkills);
  const { data, isLoading } = useQuery({ queryKey: ["brain-skills"], queryFn: () => load(), staleTime: 0, refetchOnMount: "always" });
  const q = filter.toLowerCase();
  const skills = (data?.skills ?? []).filter((s) => s.command.startsWith(q) || s.title.toLowerCase().includes(q));
  return (
    <div className="rounded-xl border bg-popover text-popover-foreground shadow-lg max-h-64 overflow-y-auto">
      <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Slash className="h-3 w-3" /> Brain skills · tap to run now
      </div>
      {isLoading ? (
        <p className="px-3 pb-3 text-sm text-muted-foreground">Loading skills…</p>
      ) : skills.length === 0 ? (
        <p className="px-3 pb-3 text-sm text-muted-foreground">No skill matches. Add a Brain note titled "Skill /name: what it does".</p>
      ) : (
        skills.map((s) => (
          <button
            key={s.command}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(s.command)}
            className="w-full text-left px-3 py-2 hover:bg-accent focus:bg-accent border-t"
          >
            <div className="text-sm"><span className="font-mono text-primary">/{s.command}</span> <span className="text-muted-foreground">· {s.title}</span></div>
            {s.summary ? <div className="text-xs text-muted-foreground truncate">{s.summary}</div> : null}
          </button>
        ))
      )}
    </div>
  );
}
