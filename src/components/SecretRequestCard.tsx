import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, CheckCircle2, ExternalLink } from "lucide-react";
import { upsertProjectSecret } from "@/lib/project-secrets.functions";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

type Props = {
  projectId: string;
  secretKey: string;
  reason?: string | null;
  whereToGet?: string | null;
  onSaved?: (key: string) => void;
};

/**
 * Rendered inline in chat whenever the AI calls `request_secret`. It gives the
 * user the one thing they were missing: a safe place to paste the API key.
 */
export function SecretRequestCard({ projectId, secretKey, reason, whereToGet, onSaved }: Props) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();

  async function save() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await upsertProjectSecret({
        data: {
          projectId,
          key: secretKey,
          value: value.trim(),
          expose_to_client: false,
          description: reason ?? undefined,
        },
      });
      setSaved(true);
      setValue("");
      await queryClient.invalidateQueries({ queryKey: ["project-secrets", projectId] });
      onSaved?.(secretKey);
      toast.success(`${secretKey} saved securely`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save that key");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <div className="flex items-center gap-2 rounded-xl hairline-gold bg-card/60 px-3 py-2.5 text-sm">
        <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
        <span className="text-foreground">
          {secretKey} is saved and encrypted. Ask Forge to continue building — it can use it now.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl hairline-gold bg-card/60 p-3 space-y-2.5">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <KeyRound className="h-4 w-4 text-primary shrink-0" />
        Paste your {secretKey}
      </div>
      {reason && <p className="text-xs text-muted-foreground leading-relaxed">{reason}</p>}
      {whereToGet && (
        <p className="text-xs text-muted-foreground/90 flex items-start gap-1.5">
          <ExternalLink className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/70" />
          <span>{whereToGet}</span>
        </p>
      )}
      <div className="flex gap-2">
        <input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`Paste ${secretKey} here`}
          className="flex-1 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <Button
          type="button"
          onClick={save}
          disabled={saving || !value.trim()}
          className="shrink-0"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground/70">
        Stored encrypted in this project's Settings → Secrets. It is never shown in chat or in your code.
      </p>
    </div>
  );
}
