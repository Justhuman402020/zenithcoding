// Shared agent behaviour for chat edits: intent detection, the step policy that
// keeps Groq moving list -> read -> write, and the system prompt.
// Extracted so the regression test drives the exact same logic as production.

import type { UIMessage } from "ai";
import type { TraceLogger } from "./trace.server";

const QUESTION_INTENT =
  /\b(explain|describe|what does|what is|what's|how does|how is|why does|walk me|tell me about|summari[sz]e|show me how)\b/i;
const NO_CHANGE_INTENT = /\b(do not|don't|without)\s+(change|modify|edit|touch|alter|update)\b/i;

// Verbs that actually ask for a change. Nouns alone ("the button", "this page")
// are NOT enough — asking "what does this button do?" is a question, not a build.
const ACTION_INTENT =
  /\b(build|add|create|make|fix|repair|update|change|replace|swap|tweak|adjust|improve|polish|move|resize|align|implement|redesign|remove|delete|edit|rewrite|refactor|restyle|wire|hook\s*up|connect|generate|set\s*up|apply)\b/i;
const QUESTION_OPENER =
  /^\s*(what|what's|whats|why|how|how's|who|when|where|which|can|could|do|does|did|is|are|should|would|will|tell|explain|describe)\b/i;

export function detectFileChangeIntent(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Pure explanation questions ("explain how this project is structured") must
  // not trigger the forced edit pipeline — forcing write_file when the model
  // only wants to read makes Groq reject the call and the answer never comes.
  if (QUESTION_INTENT.test(trimmed) || NO_CHANGE_INTENT.test(trimmed)) return false;
  const hasAction = ACTION_INTENT.test(trimmed);
  // A question-shaped message ("can you fix this?" is still a request, but
  // "does this page load?" is not) only counts as an edit when it also carries
  // an action verb.
  if (!hasAction && (QUESTION_OPENER.test(trimmed) || trimmed.endsWith("?"))) return false;
  if (hasAction) return true;
  // Bare instructions like "dark mode" / "bigger header" still imply an edit.
  return /\b(broken|failing|failed|not\s+working|doesn'?t\s+work|signup|sign\s*up|login|dark\s*mode)\b/i.test(trimmed);
}

function isVisualPart(part: UIMessage["parts"][number]) {
  if (part.type !== "file") return false;
  return typeof part.mediaType === "string" && part.mediaType.startsWith("image/");
}

/**
 * Keep chat context useful without resending old screenshots, reasoning, and
 * tool payloads on every turn. Groq's free vision tier has a small TPM window;
 * replaying one old screenshot through a long conversation eventually makes
 * every later request fail even when the new turn is text-only.
 */
export function compactChatMessages(messages: UIMessage[], maxMessages = 6): UIMessage[] {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  const recentIndexes = messages
    .map((_, index) => index)
    .filter((index) => index <= latestUserIndex)
    .slice(-maxMessages);

  return recentIndexes.flatMap((index) => {
    const message = messages[index];
    if (!message) return [];
    const isLatestUser = index === latestUserIndex;
    const parts: UIMessage["parts"] = [];
    for (const part of message.parts) {
      if (part.type === "text") {
        const text = part.text.trim();
        if (!text) continue;
        const limit = isLatestUser ? 4_000 : 1_200;
        parts.push({ ...part, text: text.slice(-limit) });
        continue;
      }
      if (isLatestUser && isVisualPart(part)) parts.push(part);
    }
    return parts.length > 0 ? [{ ...message, parts } as UIMessage] : [];
  });
}

function getToolOutput(result: unknown) {
  if (!result || typeof result !== "object") return undefined;
  return "output" in result ? (result as { output?: unknown }).output : undefined;
}

type StepLike = { toolResults: Array<{ toolName: string }> };

/**
 * Forces the model through list -> read -> write when the request implies a file
 * change. Every tool definition stays attached on every step: narrowing
 * `activeTools` made earlier tool calls disappear from the continuation request
 * and Groq aborted the build before write_file could run.
 */
type ForcedTool = "list_files" | "read_file" | "write_file";

export function createPrepareStep(needsFileChange: boolean, trace?: TraceLogger) {
  return ({ steps, stepNumber }: { steps: StepLike[]; stepNumber: number }) => {
    const toolResults = steps.flatMap((step) => step.toolResults);
    const hasListed = toolResults.some((result) => result.toolName === "list_files");
    const hasRead = toolResults.some((result) => result.toolName === "read_file");
    const writeResults = toolResults.filter((result) => result.toolName === "write_file");
    const deleteResults = toolResults.filter((result) => result.toolName === "delete_file");
    const hasSuccessfulWrite = writeResults.some(
      (result) => (getToolOutput(result) as { ok?: boolean } | undefined)?.ok === true,
    );
    const hasSuccessfulDelete = deleteResults.some(
      (result) => (getToolOutput(result) as { ok?: boolean } | undefined)?.ok === true,
    );
    const hasMutation = hasSuccessfulWrite || hasSuccessfulDelete;

    trace?.log("model.step", {
      detail: { stepNumber, toolCalls: toolResults.length, hasListed, hasRead, hasMutation },
    });

    if (!needsFileChange) return undefined;
    // Only ever force list_files. Forcing a SPECIFIC later tool (read_file /
    // write_file) hard-fails the whole stream when the model legitimately
    // wants a different one ("tool call validation failed"), which is what cut
    // replies off with no answer. "required" keeps the agent using tools until
    // a write lands, but lets it pick which one.
    if (stepNumber === 0 || !hasListed) return { toolChoice: { type: "tool" as const, toolName: "list_files" as ForcedTool } };
    if (!hasMutation && stepNumber < 12) return { toolChoice: "required" as const };
    return undefined;
  };
}

export function buildSystemPrompt(projectName: string) {
  return `You are Forge, an autonomous AI coding agent working on the user's project "${projectName}". You behave like Lovable: when the user asks for a feature, you BUILD IT — you do not explain what you would do, you do not ask permission, you do not stall. Implement, then briefly report.

Be calm, supportive, and direct. When the user says something failed, is broken, or is not what they asked for, acknowledge that briefly, inspect the current files, and correct it. Never argue with the user, blame them, or pretend a change worked when a tool failed.

The user may attach images or video frames (screenshots, photos, mockups, design references, screen recordings). Treat them as visual specs.

## Project shape
The project can be a blank Forge site or an imported GitHub repository. Always inspect the files first and preserve the existing stack and folder structure. Static apps preview from index.html with relative CSS/JS files. Imported repos may include React/Vite/TypeScript or other source files; edit the real source files the repo already uses instead of replacing it with a generic static page. There is no npm install/build runner inside this editor, so keep changes self-contained and maintain a useful index.html preview shell when the repo does not already have one.

## Tools available
- list_files — see what exists
- read_file — read a file's contents
- write_file — create or overwrite a file with its FULL new contents (never diffs, never placeholders, never "...")
- delete_file — remove a file
- list_secrets — see which API keys this project already has saved (names only)
- request_secret — ask the user to paste an API key; this shows them a secure paste box right inside the chat

## API keys and secrets
Forge HAS a secure place for API keys, so NEVER tell the user "paste your key here in chat", never tell them there is nowhere to store it, and never invent a fake key like "YOUR_API_KEY_HERE" and move on.
1. Call list_secrets first. If the key is already saved, just use it.
2. If it is missing, call request_secret with the key name (SCREAMING_SNAKE_CASE), a one-sentence reason, and where to get it. The user gets a paste box in chat and the value is stored encrypted in the project's Settings → Secrets.
3. Keep building the rest of the feature in the same turn. In the project code read the value from the injected config (window.FORGE_ENV.OPENAI_API_KEY for client-exposed keys) instead of hardcoding it, and explain in one friendly line what the key does.
Talk to the user like a patient teacher: we are building a real website, so explain in simple words what the key is for and what happens after they paste it.


## How you MUST work on every build request
1. Call list_files first to see the current state.
2. read_file index.html and any css/js file you will modify so you preserve existing work.
3. write_file for every file you create or change — with the COMPLETE, runnable file contents. Do NOT output code in chat instead of writing it. Do NOT say "I'll add..." without calling the tool in the same turn.
4. Make sure index.html links every css/js file you created. Prefer simple relative paths like "style.css" and "app.js".
5. If the user asks for a signup/sign up area, build a visible signup interface in the project itself: email and password fields, clear sign-up button, validation, success/error states, and a working submit handler (local demo behavior is OK unless backend auth is specifically requested).
6. After the changes land, reply with a 1–3 sentence summary naming the files you changed. If a write tool returns ok:false, say the exact failure instead of claiming success.

## Behavior rules
- Default to action. If the request is reasonable (e.g. "build a signup area", "add a contact form", "make it dark mode"), just build it with sensible defaults — do not ask clarifying questions first.
- Ship complete, working features in one turn. A "signup area" means a real form with email + password fields, validation, a submit handler, and visible success/error states — not a placeholder.
- Match the existing visual style of the project when extending it.
- Never leave TODOs, "// your code here", or empty handlers. Wire everything up.
- If something genuinely blocks you (missing API key, ambiguous business logic), say so plainly in one line and still ship the best default implementation.`;
}
