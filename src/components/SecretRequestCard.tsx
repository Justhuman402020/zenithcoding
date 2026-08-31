import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, CheckCircle2, ExternalLink, AlertTriangle } from "lucide-react";
import { upsertProjectSecret, testProjectSecret } from "@/lib/project-secrets.functions";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

type Props = {
  projectId: string;
  secretKey: string;
  reason?: string | null;
  whereToGet?: string | null;
  initialValue?: string;
  onSaved?: (key: string) => void;
};

type TestState = { status: "idle" | "testing" | "ok" | "failed"; message?: string };

/**
 * Rendered inline in chat whenever the AI calls `request_secret`. It gives the
 * user the one thing they were missing: a safe place to paste the API key.
 */
export function SecretRequestCard({ projectId, secretKey, reason, whereToGet, initialValue, onSaved }: Props) {
  const [value, setValue] = useState(initialValue ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const queryClient = useQueryClient();

  useEffect(() => {
    if (initialValue) setValue(initialValue);
  }, [initialValue]);

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
      // Read it back from storage and hit the provider so the result is known
      // before the user continues.
      setTest({ status: "testing" });
      try {
        const result: any = await testProjectSecret({ data: { projectId, key: secretKey } });
        if (result?.ok) {
          setTest({
            status: "ok",
            message: result.tested
              ? `Connection test passed — ${result.modelCount ?? 0} models reachable.`
              : "Saved and read back from storage successfully.",
          });
        } else {
          setTest({ status: "failed", message: result?.error ?? "The provider rejected that key." });
        }
      } catch (error) {
        setTest({
          status: "failed",
          message: error instanceof Error ? error.message : "Could not test that key",
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save that key");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <div className="rounded-xl hairline-gold bg-card/60 px-3 py-2.5 text-sm space-y-1.5">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
          <span className="text-foreground">
            {secretKey} is saved and encrypted. It stays saved after you refresh.
          </span>
        </div>
        {test.status === "testing" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing the connection…
          </div>
        )}
        {test.status === "ok" && (
          <div className="flex items-center gap-2 text-xs text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" /> {test.message}
          </div>
        )}
        {test.status === "failed" && (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {test.message}
          </div>
        )}
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
