/**
 * Some models "type out" their tool calls as raw JSON in the reply instead of
 * (or as well as) calling the tool. That JSON — often a whole HTML file with
 * escaped quotes — must never show up in the chat bubble.
 */
const TOOL_JSON_START = /\{\s*"(?:path|name|tool|tool_name|function|arguments|parameters|content|file)"\s*:/g;

function matchingBraceEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length; // unterminated (still streaming) — hide the rest
}

export function stripLeakedToolJson(input: string): string {
  let text = input;
  // Fenced json blocks that carry file contents / tool args.
  text = text.replace(/```(?:json|tool|tool_call)?\s*\{[\s\S]*?(?:```|$)/gi, (block) =>
    /"(content|path|arguments|name)"\s*:/.test(block) ? "" : block,
  );
  // Inline JSON objects that look like tool calls.
  let out = "";
  let cursor = 0;
  TOOL_JSON_START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOOL_JSON_START.exec(text))) {
    const start = m.index;
    if (start < cursor) continue;
    const end = matchingBraceEnd(text, start);
    const chunk = text.slice(start, end);
    if (/"(content|arguments|path)"\s*:/.test(chunk) && chunk.length > 40) {
      out += text.slice(cursor, start);
      cursor = end;
      TOOL_JSON_START.lastIndex = end;
    }
  }
  out += text.slice(cursor);
  // Leftover fragments of escaped HTML (e.g. `dth=device-width, ...\">`).
  out = out
    .split("\n")
    .filter((line) => !(/\\"/.test(line) && /[<>]|\\n/.test(line)))
    .join("\n");
  return out.replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Short, readable summary of tool input for the tool card. */
export function summarizeToolInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") {
    // Partial streaming args arrive as a raw string — never show it.
    return "";
  }
  if (typeof input !== "object") return String(input);
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string" && value.length > 160) {
      const lines = value.split("\n").length;
      clean[key] = `(${lines} line${lines === 1 ? "" : "s"}, ${value.length.toLocaleString()} characters)`;
    } else {
      clean[key] = value;
    }
  }
  try {
    return JSON.stringify(clean, null, 2);
  } catch {
    return "";
  }
}
