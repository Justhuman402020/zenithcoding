// Pure rules for side-chat proposals. The side chat plans and looks; it never builds.
// A "Yes" sends the work to the project's build screen, where Cloudflare plans it
// first and the owner then approves the OpenRouter build.

export type ChatProposal =
  | { kind: "new_project"; name: string; prompt: string }
  | { kind: "handoff"; prompt: string };

/** Pulls one proposal out of a chat reply: <new-project name="…">plan</new-project>, <send-to-build>…</send-to-build> or the older <edit>…</edit>. */
export function parseChatProposal(reply: string): { text: string; proposal: ChatProposal | null } {
  const fresh = /<new-project(?:\s+name\s*=\s*["“]([^"”]*)["”])?\s*>([\s\S]*?)<\/new-project>/i.exec(reply);
  if (fresh) {
    const prompt = fresh[2]!.trim();
    const text = reply.replace(fresh[0], "").trim();
    if (!prompt) return { text, proposal: null };
    const name = (fresh[1] ?? "").trim().replace(/\s+/g, " ").slice(0, 60) || "New project";
    return { text, proposal: { kind: "new_project", name, prompt } };
  }
  const fix = /<(send-to-build|edit)>([\s\S]*?)<\/\1>/i.exec(reply);
  if (!fix) return { text: reply.trim(), proposal: null };
  const prompt = fix[2]!.trim();
  return { text: reply.replace(fix[0], "").trim(), proposal: prompt ? { kind: "handoff", prompt } : null };
}

export type ChatEngine = "openrouter" | "ollama" | "chosen";
export type ChatRoute = "ollama" | "chosen" | "openrouter-text" | "openrouter-image";

/** Images always go to the model in charge of chat. Only an OpenRouter-run chat sends them to OpenRouter. */
export function chatRoute(chatEngine: string, hasImages: boolean): ChatRoute {
  if (chatEngine === "ollama") return "ollama";
  if (chatEngine === "chosen") return "chosen";
  return hasImages ? "openrouter-image" : "openrouter-text";
}

/** The message the build screen sends to Cloudflare Plan after a chat "Yes". */
export function handoffPlanPrompt(kind: string, prompt: string, name?: string | null): string {
  const intro = kind === "new_project"
    ? `New project "${name || "New project"}" planned in my side chat. Replan it the best way for this project`
    : "My side chat found this work for this project. Read the current files, then replan it the best way";
  return `${intro}: list every step, name each API key it will use from the Admin Brain and AI Models (names only), say which keys are missing and where to get them, and recommend which OpenRouter build key/model should build it. Do not change any files — end with the approval line so I can approve the OpenRouter build.\n\n${prompt}`;
}
