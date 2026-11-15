import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isEnvFile, redactEnv, isCloudflareUrl, assertChatUrlAllowed, ollamaBase, parseEditProposal, decide, fitHelperContext, HELPER_CONTEXT_LIMIT, HELPER_FILE_BUDGET, HELPER_TOOLS, HELPER_TOOL_ROUNDS, HELPER_TOOL_OUTPUT, shouldRetryTunnel, runHelperTool, formatHelperErrors, type EditStatus, type HelperFile, type HelperErrors } from "./assistant-policy";

import { successfulEdit } from "./owner-policy";
import { imageMessageContent } from "./assistant-images";
import type { RunClock } from "./run-clock";
import { isSettingsComplaint, orderChosenBySavedKey, replyText, requireChosen, sortModelsAZ, testBodies, testFailureMessage, testReplyWorks, type ChosenRef } from "./chosen-models";

type Ctx = { supabase: any; userId: string };

async function keyFor(ctx: Ctx, keyId: string) {
  const { data } = await ctx.supabase.from("ollama_keys").select("*").eq("id", keyId).eq("user_id", ctx.userId).maybeSingle();
  if (!data) throw new Error("Ollama key not found");
  const { decryptSecret } = await import("./secrets-crypto.server");
  const base = ollamaBase(data.base_url);
  assertChatUrlAllowed(base);
  return { base, apiKey: await decryptSecret(data.key_encrypted) };
}

type Look = { files: HelperFile[]; errors: HelperErrors };

async function ollamaChat(ctx: Ctx, keyId: string, model: string, messages: Array<{ role: string; content: any }>, look?: Look) {
  const { base, apiKey } = await keyFor(ctx, keyId);
  // Self-hosted models are slow; keep the request small, and stream so long answers are never cut off.
  const convo: any[] = [
    // The system message already puts the attached project first (see buildContext).
    ...messages.filter((m) => m.role === "system").map((m) => ({ ...m, content: String(m.content).slice(0, HELPER_CONTEXT_LIMIT.ollama) })),
    ...messages.filter((m) => m.role !== "system").slice(-8).map((m) => ({ ...m, content: typeof m.content === "string" ? m.content.slice(0, 2500) : m.content })),
  ];
  const { readChatStream } = await import("./sse-chat");
  let useTools = !!look;
  let tunnelRetries = 0;
  for (let round = 0; ; round++) {
    const withTools = useTools && round < HELPER_TOOL_ROUNDS;
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: convo, stream: true, reasoning_effort: "none", max_tokens: 8000, ...(withTools ? { tools: HELPER_TOOLS } : {}) }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      // Some PC models can't use tools: answer from the attached files in the note instead.
      if (withTools && res.status === 400 && /tool/i.test(text)) { useTools = false; continue; }
      // Tunnel gave up while the PC was still reading: ask the same step again.
      if (shouldRetryTunnel(res.status, tunnelRetries)) { tunnelRetries++; round--; continue; }
      if (res.status === 530 && /trycloudflare\.com$/i.test(new URL(base).hostname)) {
        throw new Error("Your Ollama tunnel has expired or is offline. On your computer, stop the tunnel and start it again, copy the new trycloudflare.com address, and save it as the Base URL in Admin → AI Models → Chat helper keys. Your key is unchanged.");
      }
      if (res.status === 524) throw new Error("Your Ollama model took too long to start answering, even after 3 tries. Your laptop may be busy or asleep. Ask a shorter question, or pick a smaller model and try again");
      throw new Error(`Ollama said ${res.status}: ${text.slice(0, 300)}`);
    }
    const { text, complete, toolCalls } = await readChatStream(res.body);
    if (withTools && look && toolCalls.length) {
      convo.push({ role: "assistant", content: text || "", tool_calls: toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments || "{}" } })) });
      for (const c of toolCalls) convo.push({ role: "tool", tool_call_id: c.id, content: runHelperTool(c.name, c.arguments, look.files, look.errors, HELPER_TOOL_OUTPUT.ollama) });
      continue;
    }
    if (!text && !complete) throw new Error("Your Ollama model stopped before answering. Make sure the laptop is awake and the tunnel window is open");
    return complete ? text : `${text}\n\n_(The answer was cut off because the connection dropped.)_`;
  }
}

async function helperChat(ctx: Ctx, keyId: string | null, model: string | null, messages: Array<{ role: string; content: any }>, images = false, look?: Look, chosen?: ChosenRef | null) {
  const { readWorkspaceAI, recordModelCall } = await import("./workspace-ai.server");
  const settings = await readWorkspaceAI();
  const ollama = settings.chatEngine === "ollama" && !images;
  const isChosen = settings.chatEngine === "chosen";
  const ref = isChosen ? { provider: chosen?.provider ?? "chosen", model: chosen?.model ?? "unknown" } : ollama ? { provider: "ollama", model: model ?? "unknown" } : (images ? settings.image : settings.text) ?? { provider: "openrouter", model: "unknown" };
  const started = Date.now();
  try {
    const out = isChosen ? await chosenChat(ctx, requireChosen(chosen), messages, look) : await helperChatInner(ctx, keyId, model, messages, images, settings, look);
    await recordModelCall({ user_id: ctx.userId, provider: ref.provider, model: ref.model, section: "assistant", started_at: started, status: "ok" });
    return out;
  } catch (e: any) {
    await recordModelCall({ user_id: ctx.userId, provider: ref.provider, model: ref.model, section: "assistant", started_at: started, status: "failed", error: e?.message });
    throw e;
  }
}

async function helperChatInner(ctx: Ctx, keyId: string | null, model: string | null, messages: Array<{ role: string; content: any }>, images: boolean, settings: Awaited<ReturnType<typeof import("./workspace-ai.server").readWorkspaceAI>>, look?: Look) {
  if (settings.chatEngine === "ollama" && !images) {
    if (!keyId || !model) throw new Error("Select your previous Ollama model");
    return ollamaChat(ctx, keyId, model, messages, look);
  }
  const ref = images ? settings.image : settings.text;
  if (!ref) throw new Error("Select your OpenRouter model in Admin → AI Models");
  return openrouterChat(ref, messages, look);
}

/** A saved Chosen model answers; no fallback to any other model. */
async function chosenChat(ctx: Ctx, chosen: ChosenRef, messages: Array<{ role: string; content: any }>, look?: Look) {
  if (chosen.provider === "ollama") return ollamaChat(ctx, chosen.keyRef, chosen.model, messages, look);
  if (chosen.provider === "registry") return registryChat(ctx, { provider: chosen.keyRef, model: chosen.model }, messages, look);
  return openrouterChat({ provider: chosen.keyRef, model: chosen.model }, messages, look);
}

/** Short, key-free reason a saved AI Models key could not answer. */
function providerFailure(status: number, text: string) {
  if (status === 401 || status === 403) return "The key was rejected";
  if (status === 402 || /credit|quota|billing|insufficient/i.test(text)) return "No credit or quota left on this key";
  if (status === 404 || /model.{0,40}(not found|does not exist|unknown|invalid)|no such model/i.test(text)) return "This model is unavailable on this key";
  if (status === 429) return "This key is rate limited right now";
  return `The provider answered ${status}`;
}

/** A model on any saved Admin → AI Models key (Google AI Studio, Mistral, …). No fallback. */
/** Base URL and key of a saved AI Models key (values never leave the server). */
async function registryEndpoint(ctx: Ctx, providerId: string) {
  const { loadProviderRegistry } = await import("./model-router.server");
  const { providers, keys } = await loadProviderRegistry();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) throw new Error("This saved key is no longer in AI Models");
  let apiKey = keys[providerId];
  if (!apiKey) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret } = await import("./secrets-crypto.server");
    const { data: saved } = await supabaseAdmin.from("project_secrets").select("value_encrypted").eq("user_id", ctx.userId).eq("key", provider.envKey).limit(1).maybeSingle();
    if (saved) { try { apiKey = (await decryptSecret(saved.value_encrypted)).trim(); } catch { /* never surface secret details */ } }
  }
  if (!apiKey) throw new Error("No API key saved for this provider");
  return { base: provider.baseURL.replace(/\/$/, ""), apiKey };
}

/** One tiny real call. Working = the provider answered 200 with a reply, even an empty one from a thinking model. */
async function probeRegistryModel(ctx: Ctx, ref: { provider: string; model: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  let endpoint: { base: string; apiKey: string };
  try { endpoint = await registryEndpoint(ctx, ref.provider); } catch (e: any) { return { ok: false, error: String(e?.message ?? "Key not found") }; }
  let last = { status: 0, text: "" };
  for (const body of testBodies(ref.model)) {
    let response: Response;
    try {
      response = await fetch(`${endpoint.base}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${endpoint.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
    } catch (e: any) {
      return { ok: false, error: /timeout|abort/i.test(String(e?.name ?? e?.message)) ? "The model took longer than 90 seconds to answer. Try again." : "Could not reach the provider. Try again." };
    }
    const text = response.ok ? "" : await response.text().catch(() => "");
    if (response.ok) {
      const json: any = await response.json().catch(() => null);
      if (testReplyWorks(json)) return { ok: true };
      return { ok: false, error: "The provider answered without a reply. Choose another model." };
    }
    last = { status: response.status, text };
    if (!isSettingsComplaint(response.status, text)) break;
  }
  return { ok: false, error: testFailureMessage(last.status, last.text) };
}

async function registryChat(ctx: Ctx, ref: { provider: string; model: string }, messages: Array<{ role: string; content: any }>, look?: Look) {
  const { loadProviderRegistry } = await import("./model-router.server");
  const { providers, keys } = await loadProviderRegistry();
  const provider = providers.find((p) => p.id === ref.provider);
  if (!provider) throw new Error("This saved key is no longer in AI Models");
  let apiKey = keys[ref.provider];
  if (!apiKey) {
    // Same owner-saved keys the AI Models board reads.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret } = await import("./secrets-crypto.server");
    const { data: saved } = await supabaseAdmin.from("project_secrets").select("value_encrypted").eq("user_id", ctx.userId).eq("key", provider.envKey).limit(1).maybeSingle();
    if (saved) { try { apiKey = (await decryptSecret(saved.value_encrypted)).trim(); } catch { /* never surface secret details */ } }
  }
  if (!apiKey) throw new Error("No API key saved for this provider");
  const base = provider.baseURL.replace(/\/$/, "");
  const convo: any[] = [...messages];
  let useTools = !!look;
  for (let round = 0; ; round++) {
    const withTools = useTools && round < HELPER_TOOL_ROUNDS;
    const response = await fetch(`${base}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: ref.model, messages: convo, stream: false, max_tokens: 2000, ...(withTools ? { tools: HELPER_TOOLS } : {}) }) });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (withTools && (response.status === 400 || response.status === 404 || response.status === 422)) { useTools = false; continue; }
      throw new Error(providerFailure(response.status, text));
    }
    const json: any = await response.json();
    const msg = json?.choices?.[0]?.message;
    const calls: any[] = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
    if (withTools && look && calls.length) {
      convo.push({ role: "assistant", content: msg?.content ?? "", tool_calls: calls });
      for (const c of calls) convo.push({ role: "tool", tool_call_id: c.id, content: runHelperTool(String(c.function?.name ?? ""), String(c.function?.arguments ?? ""), look.files, look.errors) });
      continue;
    }
    return replyText(msg);
  }
}

async function openrouterChat(ref: { provider: string; model: string }, messages: Array<{ role: string; content: any }>, look?: Look) {
  const { loadProviderRegistry } = await import("./model-router.server");
  const { providers, keys } = await loadProviderRegistry();
  const provider = providers.find((p) => p.id === ref.provider && /^https:\/\/openrouter\.ai\/api\/v1/.test(p.baseURL));
  if (!provider || !keys[ref.provider]) throw new Error("Saved OpenRouter key is not active");
  const convo: any[] = [...messages];
  let useTools = !!look;
  for (let round = 0; ; round++) {
    const withTools = useTools && round < HELPER_TOOL_ROUNDS;
    const response = await fetch(`${provider.baseURL}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${keys[ref.provider]}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: ref.model, messages: convo, stream: false, max_tokens: 2000, ...(withTools ? { tools: HELPER_TOOLS } : {}) }) });
    if (!response.ok) {
      if (withTools && (response.status === 400 || response.status === 404)) { useTools = false; continue; }
      throw new Error(`OpenRouter could not answer (${response.status})`);
    }
    const json: any = await response.json();
    const msg = json?.choices?.[0]?.message;
    const calls: any[] = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
    if (withTools && look && calls.length) {
      convo.push({ role: "assistant", content: msg?.content ?? "", tool_calls: calls });
      for (const c of calls) convo.push({ role: "tool", tool_call_id: c.id, content: runHelperTool(String(c.function?.name ?? ""), String(c.function?.arguments ?? ""), look.files, look.errors) });
      continue;
    }
    return replyText(msg);
  }
}

/** One readable work-log line from a build trace row. */
function liveLine(t: { phase: string; status: string; message: string | null; detail: any }): string | null {
  if (/^(request\.|credits\.|project\.|snapshot\.)/.test(t.phase)) return null;
  const path = t.detail?.path ? ` ${t.detail.path}` : "";
  const model = t.detail?.model ? ` ${String(t.detail.model).split("/").pop()}` : "";
  return `${t.phase.replace(/^tool\./, "")}${path}${model}${t.status === "ok" ? "" : ` [${t.status}]`}${t.message ? ` — ${String(t.message).slice(0, 160)}` : ""}`;
}

async function isAdmin(ctx: Ctx) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return !!data;
}

/** Loads every file and every known problem of the attached project (read only). */
async function loadProjectLook(ctx: Ctx, projectId: string): Promise<Look> {
  const files: HelperFile[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page } = await ctx.supabase.from("files").select("path,content").eq("project_id", projectId).order("path").range(from, from + 999);
    files.push(...((page ?? []) as any[]).map((f) => ({ path: String(f.path), content: String(f.content ?? "") })));
    if (!page || page.length < 1000) break;
  }
  const { checkProjectBuild, formatBuildIssues } = await import("./build-check");
  let build = "not checked";
  try { const r = checkProjectBuild(files); build = r.ok ? `passed (${r.checked} files checked)` : formatBuildIssues(r, 15); } catch { build = "could not run"; }
  const { data: failed } = await ctx.supabase.from("chat_jobs").select("prompt,error,created_at").eq("project_id", projectId).eq("status", "failed").order("created_at", { ascending: false }).limit(5);
  const jobs = ((failed ?? []) as any[]).map((j) => `${String(j.created_at).slice(0, 16)} "${String(j.prompt).slice(0, 60)}" → ${String(j.error ?? "no reason saved").slice(0, 200)}`);
  const { data: checks } = await ctx.supabase.from("browser_checks").select("visual_status,visual_report,created_at").eq("project_id", projectId).eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(2);
  const preview = ((checks ?? []) as any[]).filter((c) => c.visual_report).map((c) => `${String(c.created_at).slice(0, 16)} [${c.visual_status}] ${String(c.visual_report).slice(0, 700)}`);
  return { files, errors: { build, jobs, preview } };
}

/** Read-only context about Code Haven + the selected project. */
async function buildContext(ctx: Ctx, projectId: string | null, engine: "ollama" | "openrouter", look: Look | null) {
  const core: string[] = [
    "You are the Code Haven chat helper. Code Haven is the owner's personal AI website builder (like Lovable): projects with files, a live preview, Cloudflare for approved planning, and a separate build model that edits files after approval.",
    "You can LOOK AT EVERYTHING in the attached project: every file, build problems, failed builds and preview screenshot findings. Project files are given to you as plain text below and through your tools; read them, never say you cannot see them or that they are images.",
    "Tools (read only): list_files, read_file(path), search_files(query), project_errors. Use them whenever you need a file or error that is not shown below. Help the owner understand problems, find the cause, and explain the fix.",
    "You can NEVER edit, create or delete files, change Admin, or run builds yourself. When something should change, explain briefly, then put ONE precise instruction for the build model inside <edit>...</edit> (name the files, the problem and the exact fix). The owner taps Yes and the build model does the work. Never claim the change is done yourself.",
    "Be concise and friendly; the owner is not technical.",
  ];
  const project: string[] = [];
  const extra: string[] = [];
  const fileBudget = HELPER_FILE_BUDGET[engine];
  if (projectId) {
    const { data: proj } = await ctx.supabase.from("projects").select("name,description").eq("id", projectId).eq("user_id", ctx.userId).maybeSingle();
    if (proj && look) {
      project.push(`ATTACHED PROJECT: "${proj.name}"${proj.description ? ` — ${proj.description}` : ""}. The owner attached this project to the chat and you CAN see its files. Never ask the owner to upload, paste or attach the project or a file; it is already here.`);
      const list = look.files;
      project.push(`Files in "${proj.name}" (${list.length}): ${list.map((f) => f.path).join(", ")}`);
      project.push(`Known problems:\n${formatHelperErrors(look.errors).slice(0, engine === "ollama" ? 1500 : 6000)}`);
      let budget: number = fileBudget.total;
      for (const f of list) {
        if (budget <= 0) break;
        const chunk = (isEnvFile(f.path) ? redactEnv(f.content) : f.content).slice(0, Math.min(fileBudget.perFile, budget));
        budget -= chunk.length;
        project.push(`--- ${f.path}\n${chunk}`);
      }
      const { data: jobs } = await ctx.supabase.from("chat_jobs").select("prompt,status,outcome,files_changed,created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(5);
      project.push(`Recent builds: ${(jobs ?? []).map((j: any) => `[${j.status}/${j.outcome ?? "-"}] ${String(j.prompt).slice(0, 80)}`).join(" | ") || "none"}`);
      const { listBrainZips } = await import("./brain-zip.server");
      const { brainZipContext } = await import("./brain-zip");
      const references = await listBrainZips(ctx.supabase, projectId);
      extra.push(brainZipContext(references));
      if (references.length) extra.push("You cannot call reference tools yourself. Include the requested ZIP name and referenceId in the <edit> instruction so the approved coding agent reads it. Preserve existing navigation and functionality during a redesign.");
    }
  } else {
    core.push("No project is attached to this chat. If the owner asks about a project, tell them to tap the project button at the top of this chat to attach it.");
  }
  const { data: projects } = await ctx.supabase.from("projects").select("id,name,description").eq("user_id", ctx.userId).order("updated_at", { ascending: false }).limit(40);
  extra.push(`Owner's other projects (not attached): ${(projects ?? []).map((p: any) => p.name).join(", ")}`);
  if (await isAdmin(ctx)) {
    const { loadAdminBrain, listVault } = await import("./admin-vault.server");
    const brain = await loadAdminBrain();
    if (brain) extra.push(`Brain rules:\n${brain.slice(0, 3000)}`);
    const vault = await listVault();
    extra.push(`Saved key names in the Admin vault (values hidden): ${vault.map((v) => v.label).join(", ") || "none"}`);
    const { readWorkspaceAI } = await import("./workspace-ai.server");
    const ai = await readWorkspaceAI();
    extra.push(`Admin AI Models (read only): planning=Cloudflare; build engine=${ai.engine}; text=${ai.text?.model ?? "not selected"}; image=${ai.image?.model ?? "not selected"}; chat=${ai.chatEngine}. Never change these settings.`);
  }
  return fitHelperContext({ core, project, extra }, HELPER_CONTEXT_LIMIT[engine]);
}


export const listOllamaKeys = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data } = await (context.supabase as any).from("ollama_keys").select("id,label,base_url,created_at,active,active_model").order("created_at");
  return ((data ?? []) as any[]).map((k) => ({ ...k, cloudflare: isCloudflareUrl(k.base_url) })) as Array<{ id: string; label: string; base_url: string; created_at: string; active: boolean; active_model: string | null; cloudflare: boolean }>;
});

export const addOllamaKey = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ label: z.string().min(1).max(80), apiKey: z.string().min(1).max(2000), baseUrl: z.string().url().max(300).optional().or(z.literal("")) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context as Ctx))) throw new Error("Only an admin can change chat keys (Admin → AI Models).");
    const base = ollamaBase(data.baseUrl || "https://ollama.com");
    const { encryptSecret } = await import("./secrets-crypto.server");
    const { error } = await (context.supabase as any).from("ollama_keys").insert({ user_id: context.userId, label: data.label, base_url: base, key_encrypted: await encryptSecret(data.apiKey) });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Activate a model on a saved key so it shows in the chat picker. Cloudflare keys can't be activated. */
export const setKeyActive = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), model: z.string().max(200).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context as Ctx))) throw new Error("Only an admin can change chat keys (Admin → AI Models).");
    const { data: k } = await (context.supabase as any).from("ollama_keys").select("base_url").eq("id", data.id).maybeSingle();
    if (!k) throw new Error("Key not found");
    if (data.model) assertChatUrlAllowed(k.base_url);
    const { error } = await (context.supabase as any).from("ollama_keys").update({ active: !!data.model, active_model: data.model, activated_at: data.model ? new Date().toISOString() : null }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listOllamaModels = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ keyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { base, apiKey } = await keyFor(context as Ctx, data.keyId);
    const res = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const text = await res.text();
    if (res.status === 530 && /trycloudflare\.com$/i.test(new URL(base).hostname)) {
      return { models: [] as string[], error: "Your Ollama tunnel is offline or has expired. Restart Ollama and the tunnel on your computer. If it gives you a new URL, save that URL in Admin → AI Models, then tap Activate again. Your saved key has not been changed." };
    }
    if (!res.ok) return { models: [] as string[], error: `Ollama said ${res.status}: ${text.slice(0, 200)}` };
    const json = JSON.parse(text);
    return { models: ((json?.data ?? []) as any[]).map((m) => String(m.id)).sort(), error: null as string | null };
  });

export const listChats = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data } = await (context.supabase as any).from("assistant_chats").select("id,title,project_id,model,updated_at,projects(name)").order("updated_at", { ascending: false });
  type Row = { id: string; title: string; projectName: string | null; model: string | null; updatedAt: string };
  return ((data ?? []) as any[]).map((c: any): Row => ({ id: c.id as string, title: c.title as string, projectName: (c.projects?.name ?? null) as string | null, model: c.model as string | null, updatedAt: c.updated_at as string }));
});

export const createChat = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data, error } = await (context.supabase as any).from("assistant_chats").insert({ user_id: context.userId }).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id as string };
});

export const deleteChat = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await (context.supabase as any).from("assistant_chats").delete().eq("id", data.id);
    return { ok: true };
  });

export const renameChat = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), title: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    await (context.supabase as any).from("assistant_chats").update({ title: data.title }).eq("id", data.id);
    return { ok: true };
  });

export const getChat = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: chat } = await (context.supabase as any).from("assistant_chats").select("id,title,project_id,ollama_key_id,model,chosen_model_id,initialized_at,projects(name),chat_chosen_models(model)").eq("id", data.id).maybeSingle();
    if (!chat) throw new Error("Chat not found");
    const { data: messages } = await (context.supabase as any).from("assistant_messages").select("id,role,content,parts,created_at").eq("chat_id", data.id).order("created_at");
    const { data: edits } = await (context.supabase as any).from("assistant_edit_requests").select("id,prompt,status,request_key,report,created_at,kind").eq("chat_id", data.id).order("created_at");
    // Saved work clocks so finished jobs keep showing how long they worked.
    const keys = ((edits ?? []) as any[]).map((e) => e.request_key).filter(Boolean);
    const { data: jobs } = keys.length
      ? await (context.supabase as any).from("chat_jobs").select("request_key,status,outcome,work_started_at,work_paused_at,work_paused_ms,completed_at").in("request_key", keys)
      : { data: [] };
    const clocks = new Map<string, RunClock>(((jobs ?? []) as any[]).map((j) => [j.request_key, { status: j.status, outcome: j.outcome, work_started_at: j.work_started_at, work_paused_at: j.work_paused_at, work_paused_ms: j.work_paused_ms, completed_at: j.completed_at }]));
    for (const e of (edits ?? []) as any[]) e.clock = e.request_key ? clocks.get(e.request_key) ?? null : null;
    return {
      chat: { id: chat.id as string, title: chat.title as string, projectId: chat.project_id as string | null, projectName: ((chat as any).projects?.name ?? null) as string | null, keyId: chat.ollama_key_id as string | null, model: chat.model as string | null, chosenModelId: (chat.chosen_model_id ?? null) as string | null, chosenModel: ((chat as any).chat_chosen_models?.model ?? null) as string | null, initialized: !!chat.initialized_at },
      messages: (messages ?? []) as Array<{ id: string; role: string; content: string; parts: any; created_at: string }>,
      edits: (edits ?? []) as Array<{ id: string; prompt: string; status: EditStatus; kind: string; request_key: string | null; report: any; created_at: string; clock: RunClock | null }>,
    };
  });

export const setupChat = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), projectId: z.string().uuid().nullable().optional(), keyId: z.string().uuid().optional(), model: z.string().min(1).max(200).optional(), initialize: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.projectId !== undefined) patch.project_id = data.projectId;
    if (data.keyId) patch.ollama_key_id = data.keyId;
    if (data.model) patch.model = data.model;
    await (context.supabase as any).from("assistant_chats").update(patch).eq("id", data.id);
    if (data.initialize) {
      // Save instantly: no model call here. Slow self-hosted models (e.g. Ollama on a laptop
      // behind a tunnel) can take minutes to read the whole site, which froze this button.
      const { data: chat } = await (context.supabase as any).from("assistant_chats").select("project_id,model,initialized_at,projects(name)").eq("id", data.id).single();
      await (context.supabase as any).from("assistant_chats").update({ initialized_at: new Date().toISOString(), ...(chat?.initialized_at ? {} : { title: chat?.projects?.name ? `${chat.projects.name} chat` : "General chat" }) }).eq("id", data.id);
      const name = chat?.projects?.name ? ` for ${chat.projects.name}` : "";
      await (context.supabase as any).from("assistant_messages").insert({ chat_id: data.id, user_id: context.userId, role: "assistant", content: `Now using ${chat?.model ?? "your model"}${name}. Ask me anything.` });
    }
    return { ok: true };
  });

export const sendChatMessage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), text: z.string().min(1).max(20000), attachments: z.array(z.object({ name: z.string().max(200), text: z.string().max(20000) })).max(5).optional(), images: z.array(z.object({ type: z.literal("file"), mediaType: z.string().regex(/^image\/(png|jpeg|webp|gif)$/), url: z.string().max(8000000) })).max(3).optional(), plan: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: chat } = await (context.supabase as any).from("assistant_chats").select("project_id,ollama_key_id,model,chosen_model_id").eq("id", data.id).single();
    if (!chat) throw new Error("Chat not found");
    if (data.plan) {
      if (!chat.project_id) throw new Error("Select a project first");
      await (context.supabase as any).from("assistant_messages").insert({ chat_id: data.id, user_id: context.userId, role: "user", content: data.text });
      const { error } = await (context.supabase as any).from("assistant_edit_requests").insert({ chat_id: data.id, user_id: context.userId, project_id: chat.project_id, prompt: data.text, kind: "plan" });
      if (error) throw new Error("Could not save planning request");
      return { ok: true };
    }
    const attachText = (data.attachments ?? []).map((a) => `\n\n[Attached ${a.name}]\n${isEnvFile(a.name) ? redactEnv(a.text) : a.text}`).join("");
    const { error: saveError } = await (context.supabase as any).from("assistant_messages").insert({ chat_id: data.id, user_id: context.userId, role: "user", content: data.text + attachText, parts: { images: data.images ?? [] } });
    if (saveError) throw new Error("Could not save your message. Please try again.");
    const { data: history } = await (context.supabase as any).from("assistant_messages").select("role,content").eq("chat_id", data.id).order("created_at", { ascending: false }).limit(60);
    const { readWorkspaceAI } = await import("./workspace-ai.server");
    const chatEngine = (await readWorkspaceAI()).chatEngine;
    const chosen = chatEngine === "chosen" ? await chosenForChat(context as Ctx, data.id, chat.chosen_model_id) : null;
    const engine = chatEngine === "chosen" ? (chosen?.provider === "ollama" ? "ollama" : "openrouter") : chatEngine === "ollama" && !data.images?.length ? "ollama" : "openrouter";
    const look = chat.project_id ? await loadProjectLook(context as Ctx, chat.project_id) : null;
    const ctxText = await buildContext(context as Ctx, chat.project_id, engine, look);
    let reply: string;
    const askedAt = Date.now();
    try {
      const previous = ((history ?? []).reverse() as any[]).slice(0, -1).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
      reply = await helperChat(context as Ctx, chat.ollama_key_id, chat.model, [{ role: "system", content: ctxText }, ...previous, { role: "user", content: imageMessageContent(data.text + attachText, data.images ?? []) }], !!data.images?.length, look ?? undefined, chosen);
    } catch (e) {
      reply = chatEngine === "chosen"
        ? `⚠️ ${e instanceof Error ? e.message : "The chosen model failed"}. This model is not working right now — choose another model from the model list.`
        : `⚠️ ${e instanceof Error ? e.message : "Ollama failed"}. Pick another key or model and try again.`;
    }
    const { text, edit } = parseEditProposal(reply);
    await (context.supabase as any).from("assistant_messages").insert({ chat_id: data.id, user_id: context.userId, role: "assistant", content: text || "Here's the edit I'd send.", parts: { reply_ms: Date.now() - askedAt, ...(chosen ? { model: chosen.model } : {}) } });
    if (edit && chat.project_id) {
      await (context.supabase as any).from("assistant_edit_requests").insert({ chat_id: data.id, user_id: context.userId, project_id: chat.project_id, prompt: edit, images: data.images ?? [] });
    }
    await (context.supabase as any).from("assistant_chats").update({ updated_at: new Date().toISOString() }).eq("id", data.id);
    return { ok: true };
  });

export const decideEdit = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), answer: z.enum(["yes", "no"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: req } = await (context.supabase as any).from("assistant_edit_requests").select("status,chat_id,project_id,prompt,kind").eq("id", data.id).single();
    const next = decide(req.status as EditStatus, data.answer);
    const requestKey = next === "approved" ? crypto.randomUUID() : null;
    const { data: claimed, error: claimError } = await (context.supabase as any).from("assistant_edit_requests").update({ status: next === "approved" ? "running" : next, request_key: requestKey, updated_at: new Date().toISOString() }).eq("id", data.id).eq("status", "pending").select("id");
    if (claimError || !claimed?.length) throw new Error("This request was already answered");
    let started = true;
    if (next === "approved" && requestKey) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.rpc("start_approved_workspace_job", { _edit: data.id });
      if (error) {
        started = false;
        await (context.supabase as any).from("assistant_edit_requests").update({ status: "failed", report: { error: error.message } }).eq("id", data.id);
      }
    }
    await (context.supabase as any).from("assistant_messages").insert({
      chat_id: req.chat_id, user_id: context.userId, role: "assistant",
      content: next !== "approved" ? "Okay, I won't send that edit." : started ? (req.kind === "plan" ? "Planning with Cloudflare." : "I’m on it.") : "Could not start. Check the pool and selected OpenRouter models in AI Models.",
    });
    return { status: next, requestKey, started };
  });

/** Stops a running chat edit straight away. */
export const stopEdit = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: req } = await (context.supabase as any).from("assistant_edit_requests").select("status,request_key,chat_id").eq("id", data.id).single();
    if (req?.status !== "running" || !req.request_key) return { ok: false };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("chat_jobs")
      .update({ status: "failed", progress: "Stopped", error: "Stopped by you", completed_at: new Date().toISOString(), pool_run: false } as any)
      .eq("request_key", req.request_key).eq("user_id", context.userId).in("status", ["queued", "running"]);
    return { ok: true };
  });

/** Checks the Cloudflare build; when it ends, Ollama writes you the summary. */
export const checkEdit = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: req } = await (context.supabase as any).from("assistant_edit_requests").select("*").eq("id", data.id).single();
    if (req.status !== "running" || !req.request_key) return { status: req.status as EditStatus, progress: null as string | null, log: [] as string[] };
    const { data: job } = await (context.supabase as any).from("chat_jobs").select("id,status,progress,outcome,steps_done,files_changed,error,trace_id,assistant_reply,created_at,work_started_at,work_paused_at,work_paused_ms,completed_at").eq("request_key", req.request_key).maybeSingle();
    if (!job) return { status: "running" as EditStatus, progress: "Starting…", log: [] as string[] };
    if (job.status === "queued" || job.status === "running") {
      // Live work log: this build's trace lines so far.
      const { data: rows } = await (context.supabase as any).from("chat_traces").select("phase,status,message,detail,created_at")
        .eq("project_id", req.project_id).eq("trace_id", job.trace_id ?? "none").order("created_at", { ascending: false }).limit(40);
      const log = ((rows ?? []) as any[]).reverse().map((t) => liveLine(t)).filter(Boolean) as string[];
      return { status: "running" as EditStatus, progress: job.progress ?? "Working…", log, clock: { status: job.status, outcome: job.outcome, work_started_at: job.work_started_at, work_paused_at: job.work_paused_at, work_paused_ms: job.work_paused_ms, completed_at: job.completed_at }, stepCount: Number(job.steps_done), fileCount: Number(job.files_changed) };
    }
    const { data: trace } = job.trace_id ? await (context.supabase as any).from("chat_traces").select("phase,status,message").eq("trace_id", job.trace_id).order("seq").limit(200) : { data: [] };
    const log = ((trace ?? []) as any[]).map((t) => `${t.phase} [${t.status}] ${t.message ?? ""}`.trim());
    const ok = successfulEdit(job);
    const report = { jobStatus: job.status, outcome: job.outcome, steps: job.steps_done, files: job.files_changed, error: job.error, log };
    if (req.kind === "plan") {
      const { data: calls } = await (context.supabase as any).from("neuron_call_ledger").select("step,neurons,key_number,model,action").eq("request_key", req.request_key).order("step");
      const used = (calls ?? []).reduce((t: number, c: any) => t + c.neurons, 0);
      const planText = String(job.assistant_reply ?? "");
      const { data: claimed } = await (context.supabase as any).from("assistant_edit_requests").update({ status: ok ? "done" : "failed", chat_job_id: job.id, report: { ...report, neurons: used, steps: calls }, updated_at: new Date().toISOString() }).eq("id", data.id).eq("status", "running").select("id");
      if (!claimed?.length) return { status: (ok ? "done" : "failed") as EditStatus, progress: null, log: [] as string[] };
      await (context.supabase as any).from("assistant_messages").insert({ chat_id: req.chat_id, user_id: context.userId, role: "assistant", content: ok ? planText : `Planning stopped: ${job.error ?? "No complete plan"}`, parts: { log, planning: { used, steps: calls ?? [] } } });
      if (ok) await (context.supabase as any).from("assistant_edit_requests").insert({ chat_id: req.chat_id, user_id: context.userId, project_id: req.project_id, prompt: planText, kind: "build" });
      return { status: (ok ? "done" : "failed") as EditStatus, progress: null, log: [] as string[] };
    }
    const { data: chat } = await (context.supabase as any).from("assistant_chats").select("ollama_key_id,model").eq("id", req.chat_id).single();
    let summary = `${ok ? "✅ Done" : "⚠️ Stopped"}: ${job.steps_done} steps, ${job.files_changed} files changed.${job.error ? ` Error: ${job.error}` : ""}`;
    try {
      if (chat) {
        summary = await helperChat(context as Ctx, chat.ollama_key_id, chat.model, [
          { role: "system", content: "Summarize this finished edit for a non-technical owner: what was edited, which files, whether the typecheck/build passed, any problem. Short bullet list." },
          { role: "user", content: `Edit asked: ${req.prompt}\nResult: ${JSON.stringify({ ...report, log: log.slice(-60) })}\nAgent reply: ${String(job.assistant_reply ?? "").slice(0, 3000)}` },
        ]);
      }
    } catch { /* keep plain summary */ }
    const { data: claimed } = await (context.supabase as any).from("assistant_edit_requests").update({ status: ok ? "done" : "failed", chat_job_id: job.id, report, updated_at: new Date().toISOString() }).eq("id", data.id).eq("status", "running").select("id");
    if (!claimed?.length) return { status: (ok ? "done" : "failed") as EditStatus, progress: null, log: [] as string[] };
    await (context.supabase as any).from("assistant_messages").insert({ chat_id: req.chat_id, user_id: context.userId, role: "assistant", content: summary, parts: { editId: data.id, log } });
    return { status: (ok ? "done" : "failed") as EditStatus, progress: null, log: [] as string[] };
  });

export const listChatProjects = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data } = await (context.supabase as any).from("projects").select("id,name,updated_at").eq("user_id", context.userId).order("updated_at", { ascending: false }).limit(100);
  return (data ?? []) as Array<{ id: string; name: string; updated_at: string }>;
});

export const listProjectFiles = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const all: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error } = await (context.supabase as any).from("files").select("path,content").eq("project_id", data.projectId).order("path").range(from, from + 999);
      if (error) throw new Error(error.message);
      all.push(...(page ?? []));
      if (!page || page.length < 1000) break;
    }
    all.sort((a, b) => String(a.path).localeCompare(String(b.path), undefined, { sensitivity: "base" }));
    return all.map((f) => ({ path: f.path as string, text: String(f.content) }));
  });


// ---------- Chosen models (side chat) ----------

type ChosenRow = { id: string; provider: "ollama" | "openrouter" | "registry"; key_ref: string; key_label: string; model: string; last_status: string; tested_at: string };

/** The chat's chosen model; a new chat starts on the model used last. */
async function chosenForChat(ctx: Ctx, chatId: string, chosenId: string | null): Promise<ChosenRef | null> {
  let row: ChosenRow | null = null;
  if (chosenId) row = (await ctx.supabase.from("chat_chosen_models").select("*").eq("id", chosenId).maybeSingle()).data;
  if (!row) {
    const { data: last } = await ctx.supabase.from("assistant_chats").select("chosen_model_id").not("chosen_model_id", "is", null).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (last?.chosen_model_id) row = (await ctx.supabase.from("chat_chosen_models").select("*").eq("id", last.chosen_model_id).maybeSingle()).data;
    if (row) await ctx.supabase.from("assistant_chats").update({ chosen_model_id: row.id }).eq("id", chatId);
  }
  return row ? { provider: row.provider, keyRef: row.key_ref, model: row.model } : null;
}

async function openrouterKeys() {
  const { loadProviderRegistry } = await import("./model-router.server");
  const { providers, keys } = await loadProviderRegistry();
  return providers.filter((p) => /^https:\/\/openrouter\.ai\/api\/v1/.test(p.baseURL) && keys[p.id]).map((p) => ({ id: p.id, label: p.label, baseURL: p.baseURL, apiKey: keys[p.id] }));
}

/** Every saved key that can power the chat (labels only, never values). */
export const listChatKeys = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  if (!(await isAdmin(context as Ctx))) throw new Error("Only an admin can manage chosen models");
  const { data: ollama } = await (context.supabase as any).from("ollama_keys").select("id,label").order("created_at");
  const routers = await openrouterKeys();
  return [
    ...((ollama ?? []) as any[]).map((k) => ({ provider: "ollama" as const, keyRef: String(k.id), label: `Ollama · ${k.label}` })),
    ...routers.map((r) => ({ provider: "openrouter" as const, keyRef: r.id, label: r.label })),
  ];
});

export const listKeyModels = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ provider: z.enum(["ollama", "openrouter"]), keyRef: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context as Ctx))) throw new Error("Only an admin can manage chosen models");
    try {
      let base: string, apiKey: string;
      if (data.provider === "ollama") ({ base, apiKey } = await keyFor(context as Ctx, data.keyRef));
      else { const k = (await openrouterKeys()).find((r) => r.id === data.keyRef); if (!k) throw new Error("Key not active"); base = k.baseURL.replace(/\/v1$/, ""); apiKey = k.apiKey; }
      const res = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!res.ok) return { models: [] as string[], error: res.status === 530 ? "This Ollama tunnel is offline or expired." : `Could not list models (${res.status})` };
      const json: any = await res.json();
      return { models: sortModelsAZ(((json?.data ?? []) as any[]).map((m) => String(m.id))), error: null as string | null };
    } catch (e: any) { return { models: [] as string[], error: String(e?.message ?? "Could not list models").slice(0, 200) }; }
  });

export const testChatModel = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ provider: z.enum(["ollama", "openrouter"]), keyRef: z.string().min(1).max(200), model: z.string().min(1).max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context as Ctx))) throw new Error("Only an admin can manage chosen models");
    try {
      // No error from the provider means it answered; a thinking model may leave the visible text empty.
      await chosenChat(context as Ctx, { provider: data.provider, keyRef: data.keyRef, model: data.model }, [{ role: "user", content: "Reply with the single word OK." }]);
      return { ok: true, error: null as string | null };
    } catch (e: any) { return { ok: false, error: `${String(e?.message ?? "Not working").slice(0, 200)}. Choose another model.` }; }
  });

export const listChosenModels = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data } = await (context.supabase as any).from("chat_chosen_models").select("id,provider,key_ref,key_label,model,last_status,tested_at");
  // Same key order as Admin → AI Models (saved order, newest key last), then Chat helper keys; models A to Z inside each key.
  const { loadProviderRegistry } = await import("./model-router.server");
  const { providers } = await loadProviderRegistry();
  const { data: ollama } = await (context.supabase as any).from("ollama_keys").select("id").order("created_at");
  const keyOrder = [...providers.map((p) => p.id), ...((ollama ?? []) as any[]).map((k) => String(k.id))];
  return orderChosenBySavedKey((data ?? []) as ChosenRow[], keyOrder);
});

export const saveChosenModel = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ provider: z.enum(["ollama", "openrouter"]), keyRef: z.string().min(1).max(200), keyLabel: z.string().max(200), model: z.string().min(1).max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context as Ctx))) throw new Error("Only an admin can manage chosen models");
    const { error } = await (context.supabase as any).from("chat_chosen_models").upsert({ user_id: context.userId, provider: data.provider, key_ref: data.keyRef, key_label: data.keyLabel, model: data.model, last_status: "good", tested_at: new Date().toISOString() }, { onConflict: "user_id,provider,key_ref,model" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteChosenModel = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).from("chat_chosen_models").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setChatChosenModel = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ chatId: z.string().uuid(), chosenId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await (context.supabase as any).from("chat_chosen_models").select("model").eq("id", data.chosenId).maybeSingle();
    if (!row) throw new Error("Chosen model not found");
    const { error } = await (context.supabase as any).from("assistant_chats").update({ chosen_model_id: data.chosenId, updated_at: new Date().toISOString() }).eq("id", data.chatId);
    if (error) throw new Error(error.message);
    await (context.supabase as any).from("assistant_messages").insert({ chat_id: data.chatId, user_id: context.userId, role: "assistant", content: `Now using ${row.model}. Ask me anything.`, parts: { model: row.model } });
    return { ok: true };
  });

/** AI Models board: test one model on a saved key; save it for chat only when it answers. */
export const testAndChooseModel = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ provider: z.string().min(1).max(200), keyLabel: z.string().max(200), model: z.string().min(1).max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context as Ctx))) throw new Error("Only an admin can choose chat models");
    const result = await probeRegistryModel(context as Ctx, { provider: data.provider, model: data.model });
    if (!result.ok) return { ok: false, error: result.error };
    // It answered: mark it Working on the board too, so a passing model never shows as an error.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await (supabaseAdmin as any).from("ai_model_status").upsert({ provider: data.provider, model: data.model, last_status: "ok", last_error: null, last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "provider,model" });
    } catch { /* the save below is what matters */ }
    const { error } = await (context.supabase as any).from("chat_chosen_models").upsert({ user_id: context.userId, provider: "registry", key_ref: data.provider, key_label: data.keyLabel, model: data.model, last_status: "good", tested_at: new Date().toISOString() }, { onConflict: "user_id,provider,key_ref,model" });
    if (error) return { ok: false, error: "The model works, but saving it failed. Try again." };
    return { ok: true, error: null as string | null };
  });
