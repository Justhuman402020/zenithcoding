import { useEffect, useRef, useState } from "react";

/**
 * Lightweight editor for phones and huge files: an uncontrolled, GPU-composited
 * textarea (no tokenizing), so pasting thousands of lines never freezes the page.
 * Saves in the background after typing pauses.
 */
export function LightCodeEditor({ path, value, onSave }: { path: string; value: string; onSave: (v: string) => Promise<void> | void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<"saved" | "pending" | "saving">("saved");
  const [lines, setLines] = useState(() => value.split("\n").length);

  // Reset contents only when switching files (not on every save echo).
  useEffect(() => {
    if (ref.current) ref.current.value = value;
    setLines(value.split("\n").length);
    setStatus("saved");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const schedule = () => {
    setStatus("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const text = ref.current?.value ?? "";
      setLines(text.split("\n").length);
      setStatus("saving");
      await onSave(text);
      setStatus("saved");
    }, 700);
  };

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
        <span className="truncate">{path} · {lines.toLocaleString()} lines</span>
        <span>{status === "saved" ? "Saved" : status === "saving" ? "Saving…" : "Typing…"}</span>
      </div>
      <textarea
        ref={ref}
        defaultValue={value}
        onInput={schedule}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        className="flex-1 w-full resize-none bg-card p-3 font-mono text-[13px] leading-5 text-foreground outline-none"
        style={{ transform: "translateZ(0)", willChange: "transform", tabSize: 2 }}
      />
    </div>
  );
}
