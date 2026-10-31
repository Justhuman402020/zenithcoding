import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isEnvFile, redactEnv, isCloudflareUrl, assertChatUrlAllowed, ollamaBase, parseEditProposal, decide, type EditStatus } from "./assistant-policy";

import { successfulEdit } from "./owner-policy";

type Ctx = { supabase: any; userId: string };

async function keyFor(ctx: Ctx, keyId: string) {
  const { data } = await ctx.supabase.from("ollama_keys").select("*").eq("id", keyId).eq("user_id", ctx.userId).maybeSingle();
  if (!data) throw new Error("Ollama key not found");
  const { decryptSecret } = await import("./secrets-crypto.server");
  const base = ollamaBase(data.base_url);
  assertChatUrlAllowed(base);
  return { base, apiKey: await decryptSecret(data.key_encrypted) };
}

async function ollamaChat(ctx: Ctx, keyId: string, model: string, messages: Array<{ role: string; content: string }>) {
  const { base, apiKey } = await keyFor(ctx, keyId);
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Ollama said ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  return String(json?.choices?.[0]?.message?.content ?? "");
}

async function helperChat(ctx: Ctx, keyId: string | null, model: string | null, messages: Array<{ role: string; content: any }>, images = false) {
  const { readWorkspaceAI, recordModelCall } = await import("./workspace-ai.server");
  const settings = await readWorkspaceAI();
  const ollama = settings.chatEngine === "ollama" && !images;
  const ref = ollama ? { provider: "ollama", model: model ?? "unknown" } : (images ? settings.image : settings.text) ?? { provider: "openrouter", model: "unknown" };
  const started = Date.now();
  try {
    const out = await helperChatInner(ctx, keyId, model, messages, images, settings);
    await recordModelCall({ user_id: ctx.userId, provider: ref.provider, model: ref.model, section: "assistant", started_at: started, status: "ok" });
    return out;
  } catch (e: any) {
    await recordModelCall({ user_id: ctx.userId, provider: ref.provider, model: ref.model, section: "assistant", started_at: started, status: "failed", error: e?.message });
    throw e;
  }
}

async function helperChatInner(ctx: Ctx, keyId: string | null, model: string | null, messages: Array<{ role: string; content: any }>, images: boolean, settings: Awaited<ReturnType<typeof import("./workspace-ai.server").readWorkspaceAI>>) {
  if (settings.chatEngine === "ollama" && !images) {
    if (!keyId || !model) throw new Error("Select your previous Ollama model");
    return ollamaChat(ctx, keyId, model, messages);
  }
  const ref = images ? settings.image : settings.text;
  if (!ref) throw new Error("Select your OpenRouter model in Admin → AI Models");
  const { loadProviderRegistry } = await import("./model-router.server");
  const { providers, keys } = await loadProviderRegistry();
  const provider = providers.find((p) => p.id === ref.provider && /^https:\/\/openrouter\.ai\/api\/v1/.test(p.baseURL));
  if (!provider || !keys[ref.provider]) throw new Error("Saved OpenRouter key is not active");
  const response = await fetch(`${provider.baseURL}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${keys[ref.provider]}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: ref.model, messages, stream: false, max_tokens: 2000 }) });
  if (!response.ok) throw new Error(`OpenRouter could not answer (${response.status})`);
  const json: any = await response.json();
  return String(json?.choices?.[0]?.message?.content ?? "");
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

/** Read-only context about Code Haven + the selected project. */
async function buildContext(ctx: Ctx, projectId: string | null) {
  const parts: string[] = [
    "You are the Code Haven chat helper. Code Haven is the owner's personal AI website builder (like Lovable): projects with files, a live preview, a Cloudflare pool for approved planning (9k handoffs), and manually selected OpenRouter text/image models for approved builds, a Brain with global rules and skills, and an Admin vault of saved keys.",
    "You can READ only. You can never write files, change Admin, or delete anything. You discuss, explain and plan.",
    "When the owner asks for a change to the project, explain briefly, then put ONE precise instruction for the selected coding agent inside <edit>...</edit>. The owner must approve before it runs. Never claim the edit is done yourself.",
    "Be concise and friendly; the owner is not technical.",
  ];
  const { data: projects } = await ctx.supabase.from("projects").select("id,name,description").eq("user_id", ctx.userId).order("updated_at", { ascending: false }).limit(40);
  parts.push(`Owner's projects: ${(projects ?? []).map((p: any) => p.name).join(", ")}`);
  if (await isAdmin(ctx)) {
    const { loadAdminBrain, listVault } = await import("./admin-vault.server");
    const brain = await loadAdminBrain();
    if (brain) parts.push(`Brain rules:\n${brain.slice(0, 3000)}`);
    const vault = await listVault();
    parts.push(`Saved key names in the Admin vault (values hidden): ${vault.map((v) => v.label).join(", ") || "none"}`);
    const { readWorkspaceAI } = await import("./workspace-ai.server");
    const ai = await readWorkspaceAI();
    parts.push(`Admin AI Models (read only): planning=Cloudflare; build engine=${ai.engine}; text=${ai.text?.model ?? "not selected"}; image=${ai.image?.model ?? "not selected"}; chat=${ai.chatEngine}. Never change these settings.`);
  }
  if (projectId) {
    const { data: proj } = await ctx.supabase.from("projects").select("name,description").eq("id", projectId).eq("user_id", ctx.userId).maybeSingle();
    if (proj) {
      parts.push(`Selected project: ${proj.name}${proj.description ? ` — ${proj.description}` : ""}`);
      const { listBrainZips } = await import("./brain-zip.server");
      const { brainZipContext } = await import("./brain-zip");
      const references = await listBrainZips(ctx.supabase, projectId);
      parts.push(brainZipContext(references));
      if (references.length) parts.push("You cannot call reference tools yourself. Include the requested ZIP name and referenceId in the <edit> instruction so the approved coding agent reads it. Preserve existing navigation and functionality during a redesign.");
      const { data: files } = await ctx.supabase.from("files").select("path,content").eq("project_id", projectId).order("path");
      const list = files ?? [];
      parts.push(`Files (${list.length}): ${list.map((f: any) => f.path).join(", ")}`);
      let budget = 24000;
      for (const f of list) {
        if (budget <= 0) break;
        const chunk = (isEnvFile(f.path) ? redactEnv(String(f.content)) : String(f.content)).slice(0, Math.min(4000, budget));
        budget -= chunk.length;
        parts.push(`--- ${f.path}\n${chunk}`);
      }
      const { data: jobs } = await ctx.supabase.from("chat_jobs").select("prompt,status,outcome,files_changed,created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(5);
      parts.push(`Recent builds: ${(jobs ?? []).map((j: any) => `[${j.status}/${j.outcome ?? "-"}] ${String(j.prompt).slice(0, 80)}`).join(" | ") || "none"}`);
    }
  }
  return parts.join("\n\n");
}

const auth = createServerFn;

export const listOllamaKeys = auth({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data } = await (context.supabase as any).from("ollama_keys").select("id,label,base_url,created_at,active,active_model").order("created_at");
  return ((data ?? []) as any[]).map((k) => ({ ...k, cloudflare: isCloudflareUrl(k.base_url) })) as Array<{ id: string; label: string; base_url: string; created_at: string; active: boolean; active_model: string | null; cloudflare: boolean }>;
});

export const addOllamaKey = auth({ method: "POST" }).middleware([requireSupabaseAuth])
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
export const setKeyActive = auth({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), model: z.string().max(200).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context as Ctx))) throw new Error("Only an admin can change chat keys (Admin → AI Models).");
    const { data: k } = await (context.supabase as any).from("ollama_keys").select("base_url").eq("id", data.id).maybeSingle();
    if (!k) throw new Error("Key not found");
    if (data.model) assertChatUrlAllowed(k.base_url);
    const { error } = await (context.supabase as any).from("ollama_keys").update({ active: !!data.model, active_model: data.model }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listOllamaModels = auth({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ keyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { base, apiKey } = await keyFor(context as Ctx, data.keyId);
    const res = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const text = await res.text();
    if (!res.ok) return { models: [] as string[], error: `Ollama said ${res.status}: ${text.slice(0, 200)}` };
    const json = JSON.parse(text);
    return { models: ((json?.data ?? []) as any[]).map((m) => String(m.id)).sort(), error: null as string | null };
  });

export const listChats = auth({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data } = await (context.supabase as any).from("assistant_chats").select("id,title,project_id,model,updated_at,projects(name)").order("updated_at", { ascending: false });
  type Row = { id: string; title: string; projectName: string | null; model: string | null; updatedAt: string };
  return ((data ?? []) as any[]).map((c: any): Row => ({ id: c.id as string, title: c.title as string, projectName: (c.projects?.name ?? null) as string | null, model: c.model as string | null, updatedAt: c.updated_at as string }));
});

export const createChat = auth({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data, error } = await (context.supabase as any).from("assistant_chats").insert({ user_id: context.userId }).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id as string };
});

export const deleteChat = auth({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await (context.supabase as any).from("assistant_chats").delete().eq("id", data.id);
    return { ok: true };
  });

export const renameChat = auth({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), title: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    await (context.supabase as any).from("assistant_chats").update({ title: data.title }).eq("id", data.id);
    return { ok: true };
  });

export const getChat = auth({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: chat } = await (context.supabase as any).from("assistant_chats").select("id,title,project_id,ollama_key_id,model,initialized_at,projects(name)").eq("id", data.id).maybeSingle();
    if (!chat) throw new Error("Chat not found");
    const { data: messages } = await (context.supabase as any).from("assistant_messages").select("id,role,content,parts,created_at").eq("chat_id", data.id).order("created_at");
    const { data: edits } = await (context.supabase as any).from("assistant_edit_requests").select("id,prompt,status,request_key,report,created_at,kind").eq("chat_id", data.id).order("created_at");
    return {
      chat: { id: chat.id as string, title: chat.title as string, projectId: chat.project_id as string | null, projectName: ((chat as any).projects?.name ?? null) as string | null, keyId: chat.ollama_key_id as string | null, model: chat.model as string | null, initialized: !!chat.initialized_at },
      messages: (messages ?? []) as Array<{ id: string; role: string; content: string; parts: any; created_at: string }>,
      edits: (edits ?? []) as Array<{ id: string; prompt: string; status: EditStatus; kind: string; request_key: string | null; report: any; created_at: string }>,
    };
  });

export const setupChat = auth({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), projectId: z.string().uuid().nullable().optional(), keyId: z.string().uuid().optional(), model: z.string().min(1).max(200).optional(), initialize: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.projectId !== undefined) patch.project_id = data.projectId;
    if (data.keyId) patch.ollama_key_id = data.keyId;
    if (data.model) patch.model = data.model;
    await (context.supabase as any).from("assistant_chats").update(patch).eq("id", data.id);
    if (data.initialize) {
      const { data: chat } = await (context.supabase as any).from("assistant_chats").select("project_id,ollama_key_id,model,projects(name)").eq("id", data.id).single();
      
      const ctxText = await buildContext(context as Ctx, chat.project_id);
      const reply = await helperChat(context as Ctx, chat.ollama_key_id, chat.model, [
        { role: "system", content: ctxText },
        { role: "user", content: "Read everything above and reply in 2-3 short sentences that you are ready, naming the project and what it is." },
      ]);
      await (context.supabase as any).from("assistant_chats").update({ initialized_at: new Date().toISOString(), title: chat.projects?.name ? `${chat.projects.name} chat` : "General chat" }).eq("id", data.id);
      await (context.supabase as any).from("assistant_messages").insert({ chat_id: data.id, user_id: context.userId, role: "assistant", content: reply || "Ready — I know this project." });
    }
    return { ok: true };
  });

export const sendChatMessage = auth({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), text: z.string().min(1).max(20000), attachments: z.array(z.object({ name: z.string().max(200), text: z.string().max(20000) })).max(5).optional(), images: z.array(z.object({ type: z.literal("file"), mediaType: z.string().regex(/^image\/(png|jpeg|webp|gif)$/), url: z.string().max(8000000) })).max(3).optional(), plan: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: chat } = await (context.supabase as any).from("assistant_chats").select("project_id,ollama_key_id,model").eq("id", data.id).single();
    if (!chat) throw new Error("Chat not found");
    if (data.plan) {
      if (!chat.project_id) throw new Error("Select a project first");
      await (context.supabase as any).from("assistant_messages").insert({ chat_id: data.id, user_id: context.userId, role: "user", content: data.text });
      const { error } = await (context.supabase as any).from("assistant_edit_requests").insert({ chat_id: data.id, user_id: context.userId, project_id: chat.project_id, prompt: data.text, kind: "plan" });
      if (error) throw new Error("Could not save planning request");
      return { ok: true };
    }
    const attachText = (data.attachments ?? []).map((a) => `\n\n[Attached ${a.name}]\n${isEnvFile(a.name) ? redactEnv(a.text) : a.text}`).join("");
    await (context.supabase as any).from("assistant_messages").insert({ chat_id: data.id, user_id: context.userId, role: "user", content: data.text + attachText });
    const { data: history } = await (context.supabase as any).from("assistant_messages").select("role,content").eq("chat_id", data.id).order("created_at", { ascending: false }).limit(60);
    const ctxText = await buildContext(context as Ctx, chat.project_id);
    let reply: string;
    try {
      reply = await helperChat(context as Ctx, chat.ollama_key_id, chat.model, [{ role: "system", content: ctxText }, ...((history ?? []).reverse() as any[]).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })), ...(data.images?.length ? [{ role: "user", content: [{ type: "text", text: data.text }, ...data.images.map((image) => ({ type: "image_url", image_url: { url: image.url } }))] }] : [])], !!data.images?.length);
    } catch (e) {
      reply = `⚠️ ${e instanceof Error ? e.message : "Ollama failed"}. Pick another key or model and try again.`;
    }
    const { text, edit } = parseEditProposal(reply);
    await (context.supabase as any).from("assistant_messages").insert({ chat_id: data.id, user_id: context.userId, role: "assistant", content: text || "Here's the edit I'd send." });
    if (edit && chat.project_id) {
      await (context.supabase as any).from("assistant_edit_requests").insert({ chat_id: data.id, user_id: context.userId, project_id: chat.project_id, prompt: edit, images: data.images ?? [] });
    }
    await (context.supabase as any).from("assistant_chats").update({ updated_at: new Date().toISOString() }).eq("id", data.id);
    return { ok: true };
  });

export const decideEdit = auth({ method: "POST" }).middleware([requireSupabaseAuth])
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
export const stopEdit = auth({ method: "POST" }).middleware([requireSupabaseAuth])
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
export const checkEdit = auth({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: req } = await (context.supabase as any).from("assistant_edit_requests").select("*").eq("id", data.id).single();
    if (req.status !== "running" || !req.request_key) return { status: req.status as EditStatus, progress: null as string | null, log: [] as string[] };
    const { data: job } = await (context.supabase as any).from("chat_jobs").select("id,status,progress,outcome,steps_done,files_changed,error,trace_id,assistant_reply,created_at").eq("request_key", req.request_key).maybeSingle();
    if (!job) return { status: "running" as EditStatus, progress: "Starting…", log: [] as string[] };
    if (job.status === "queued" || job.status === "running") {
      // Live work log: this build's trace lines so far.
      const { data: rows } = await (context.supabase as any).from("chat_traces").select("phase,status,message,detail,created_at")
        .eq("project_id", req.project_id).gte("created_at", job.created_at).order("created_at", { ascending: false }).limit(40);
      const log = ((rows ?? []) as any[]).reverse().map((t) => liveLine(t)).filter(Boolean) as string[];
      return { status: "running" as EditStatus, progress: job.progress ?? "Working…", log };
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

export const listChatProjects = auth({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data } = await (context.supabase as any).from("projects").select("id,name,updated_at").eq("user_id", context.userId).order("updated_at", { ascending: false }).limit(100);
  return (data ?? []) as Array<{ id: string; name: string; updated_at: string }>;
});

export const listProjectFiles = auth({ method: "POST" }).middleware([requireSupabaseAuth])
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
