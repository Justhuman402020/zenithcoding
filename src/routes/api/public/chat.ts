import { shouldHandoff, emptyBaton, mergeBaton, batonNote } from "@/lib/neuron-budget";
import { countCall as countCallSync, preflightAllowed, PREFLIGHT_MAX } from "@/lib/cf-pool-policy";
import { changedPathsFromStep, completionGate, MAX_GATE_RETRIES, stripThinking, trimCarried } from "@/lib/completion-gate";
import { createFileRoute } from "@tanstack/react-router";
import { consumeStream, convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, streamText, stepCountIs, type UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { debit, ensureWelcomeGrant, hasUnlimitedCredits } from "@/lib/credits.server";
import { createTrace } from "@/lib/trace.server";
import {
  createGroqProvider,
  createProjectFileTools,
  createSecretTools,
  createSupabaseFileStore,
  createSupabaseSecretStore,
} from "@/lib/chat-tools.server";
import {
  buildPlanSystemPrompt,
  buildSystemPrompt,
  compactChatMessages,
  createPrepareStep,
  detectFileChangeIntent,
  isVisualPart,
} from "@/lib/chat-agent.server";

import {
  buildModelChain,
  maxOutputTokensFor,
  modelSupportsVision,
  parseModelKey,
  pickPlanPreference,
  type ModelRef,
} from "@/lib/ai-providers";
import {
  loadProviderRegistry,
  pickAvailableModel,
  readActiveModelRef,
  recordModelStatus,
} from "@/lib/model-router.server";

export { createGroqProvider };

// Extra-provider model lists, reused across requests so replies start faster.
// Text-only copy of the conversation for restarts (images were already
// turned into a written brief on the first run).
function compactMessages0(messages: UIMessage[]) {
  return compactChatMessages(messages).map((m: any) => ({
    ...m,
    parts: (m.parts ?? []).filter((p: any) => p.type === "text"),
  }));
}

const extraModelCache = new Map<string, { at: number; models: any[] }>();

export const Route = createFileRoute("/api/public/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "");
        const projectId = request.headers.get("x-project-id");
        console.log("[chat] POST", { hasToken: !!token, projectId });
        // Server-side restarts (from /api/public/jobs/resume) carry a one-time
        // internal token instead of a user sign-in, and are never charged again.
        const resumeUser = request.headers.get("x-forge-resume-user");
        let isResume = false;
        if (resumeUser) {
          const { verifyResumeToken } = await import("@/lib/job-resume.server");
          isResume = await verifyResumeToken(request.headers.get("x-forge-resume-token"));
          if (!isResume) return new Response("Unauthorized", { status: 401 });
        }
        if (!token && !isResume) return new Response("Unauthorized: missing token", { status: 401 });
        if (!projectId) return new Response("Missing project", { status: 400 });

        const { providers: providerRegistry, keys: providerKeys } = await loadProviderRegistry();
        if (Object.keys(providerKeys).length === 0) {
          return new Response("No AI provider API key is configured", { status: 500 });
        }


        const supabaseUrl = process.env.SUPABASE_URL!;
        const supabasePublishable = process.env.SUPABASE_PUBLISHABLE_KEY!;
        let supabase: any;
        let userId: string;
        if (isResume) {
          const { supabaseAdmin: adminClient } = await import("@/integrations/supabase/client.server");
          supabase = adminClient;
          userId = String(resumeUser);
          const { data: resumedOwner } = await adminClient.auth.admin.getUserById(userId);
          const { isOwner } = await import("@/lib/owner-policy");
          if (!isOwner(resumedOwner.user)) return new Response("Not available", { status: 403 });
        } else {
          supabase = createClient(supabaseUrl, supabasePublishable, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
          if (userErr || !userRes.user) {
            console.log("[chat] getUser failed", userErr?.message);
            return new Response(`Unauthorized: ${userErr?.message ?? "no user"}`, { status: 401 });
          }
          const { isOwner } = await import("@/lib/owner-policy");
          if (!isOwner(userRes.user)) return new Response("Not available", { status: 403 });
          const { data: allowed } = await supabase.rpc("workspace_session_allowed");
          if (!allowed) return new Response("Not available", { status: 403 });
          userId = userRes.user.id;
        }

        const trace = createTrace({ projectId, userId });
        const traceHeaders = { "x-forge-trace-id": trace.traceId };
        const fail = async (status: number, body: string, contentType = "text/plain") => {
          const key = request.headers.get("x-forge-request-key");
          if (key) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            await supabaseAdmin.from("chat_jobs").update({ status: "failed", outcome: "failed", error: body.slice(0, 600), progress: "Could not start", completed_at: new Date().toISOString() }).eq("request_key", key).eq("user_id", userId).in("status", ["queued", "running"]);
          }
          await trace.flush();
          return new Response(body, { status, headers: { "Content-Type": contentType, ...traceHeaders } });
        };
        trace.log("request.authenticated", { detail: { projectId } });


        // confirm project belongs to user
        const { data: proj } = await supabase
          .from("projects")
          .select("id,name,description")
          .eq("id", projectId)
          .eq("user_id", userId)
          .maybeSingle();
        if (!proj) {
          trace.log("project.lookup", { status: "error", message: "project not found" });
          return fail(404, "Project not found");
        }

        const body = (await request.json()) as { messages?: UIMessage[] };
        if (!Array.isArray(body.messages)) {
          trace.log("request.invalid", { status: "error", message: "messages required" });
          return fail(400, "messages required");
        }

        const lastUserText = [...body.messages]
          .reverse()
          .find((message) => message.role === "user")
          ?.parts
          ?.map((part) => (part.type === "text" ? part.text : ""))
          .join(" ") ?? "";
        // Plan mode thinks and proposes; build mode writes files.
        const planMode = (request.headers.get("x-forge-mode") ?? "build").toLowerCase() === "plan";
        const imageBuild = !planMode && request.headers.get("x-forge-image-build") === "yes";
        const cloneMode = request.headers.get("x-forge-clone") === "1";
        const needsFileChange = planMode ? false : detectFileChangeIntent(lastUserText);
        const requestKey = request.headers.get("x-forge-request-key") || crypto.randomUUID();
        if (!planMode && needsFileChange && !isResume && request.headers.get("x-forge-approved") !== "yes") return fail(403, "Build approval required");
        trace.log("request.parsed", {
          detail: { messages: body.messages.length, planMode, needsFileChange, prompt: lastUserText, requestKey },
        });

        // Casual guard: greetings/acks get an instant one-line reply with no model,
        // no tools and no file tree — zero Neurons spent.
        const casual = lastUserText.trim().toLowerCase().replace(/[!.?,\s]+$/g, "");
        if (/^(hi+|hello+|hey+|yo|sup|hiya|howdy|good (morning|afternoon|evening)|gm|ok(ay)?|k|cool|nice|great|thanks?|thank you|thx|ty|alright|got it|sounds good|perfect|awesome|lol)( (there|forge|bro|man|again))?$/.test(casual)) {
          const thanks = /thank|thx|ty/.test(casual);
          const ack = /^(ok|okay|k|cool|nice|great|alright|got it|sounds good|perfect|awesome|lol)/.test(casual);
          const text = thanks ? "Anytime — what's next?" : ack ? "Got it. What should we build next?" : "Ready when you are. What are we building next?";
          trace.log("request.casual", { detail: { prompt: casual } });
          const id = crypto.randomUUID();
          return createUIMessageStreamResponse({
            stream: createUIMessageStream({
              execute: ({ writer }) => {
                writer.write({ type: "text-start", id });
                writer.write({ type: "text-delta", id, delta: text });
                writer.write({ type: "text-end", id });
              },
            }),
          });
        }

        // Ensure the user has a welcome balance, then debit one credit per message.
        // Admins build for free — their jobs must never be blocked by credits.
        // Casual replies above already returned, so they never reach this debit.
        // Run the credit checks together to shave a round-trip before replying.
        const [, unlimitedCredits] = await Promise.all([ensureWelcomeGrant(userId), hasUnlimitedCredits(userId)]);
        // Server restarts continue an already-paid build: never charge twice.
        const unlimited = unlimitedCredits || isResume;
        if (unlimited) {
          trace.log("credits.debit", { detail: { unlimited: true } });
        } else {
          const debitResult = await debit(userId, 1, `chat:${projectId}`);
          if (!debitResult.ok) {
            trace.log("credits.debit", { status: "error", message: "out of credits" });
            return fail(
              402,
              JSON.stringify({ error: "out_of_credits", message: "You're out of credits. Ask Samsung admin to add more credits." }),
              "application/json",
            );
          }
          trace.log("credits.debit", { detail: { balance: debitResult.balance } });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Recover jobs whose request died before its completion handler ran.
        // Healthy jobs refresh updated_at every 15 seconds below.
        // Stale-job cleanup is housekeeping: don't make the reply wait for it.
        void supabaseAdmin
          .from("chat_jobs")
          .update({
            status: "failed",
            progress: "Stopped before completion",
            error: "The previous AI request stopped unexpectedly. Your next message can run normally.",
            completed_at: new Date().toISOString(),
          })
          .eq("project_id", projectId)
          .eq("user_id", userId)
          .in("status", ["queued", "running"])
          // Leave cut-off builds alone while the server can still restart them.
          .or("resume_payload.is.null,auto_resumes.gte.6")
          .lt("updated_at", new Date(Date.now() - 180_000).toISOString())
          .then(() => undefined, () => undefined);

        const { data: existingJob } = await supabase
          .from("chat_jobs")
          .select("id,status,assistant_reply,error,build_engine,engine_provider,engine_model")
          .eq("project_id", projectId)
          .eq("user_id", userId)
          .eq("request_key", requestKey)
          .maybeSingle();
        if (existingJob?.status === "completed" && existingJob.assistant_reply) {
          return new Response(existingJob.assistant_reply, {
            headers: { "content-type": "text/plain; charset=utf-8", "x-forge-job-id": existingJob.id, ...traceHeaders },
          });
        }
        const { data: createdJob } = existingJob
          ? { data: existingJob }
          : await supabase
              .from("chat_jobs")
              .insert({ project_id: projectId, user_id: userId, request_key: requestKey, prompt: lastUserText, status: "running", progress: "AI is working" })
              .select("id")
              .single();
        const jobId = createdJob?.id;
        // Save what's needed to restart this build on the server if the worker
        // is cut off after the phone disconnects, then arm the restart check.
        if (jobId && !planMode) {
          const resumePayload = {
            messages: imageBuild ? compactChatMessages(body.messages) : compactMessages0(body.messages),
            headers: Object.fromEntries(
              ["x-forge-model", "x-forge-auto", "x-forge-mode", "x-forge-clone", "x-forge-vision-model", "x-forge-engine", "x-forge-image-build", "x-forge-approval", "x-forge-approved"]
                .map((h) => [h, request.headers.get(h)])
                .filter(([, v]) => v != null),
            ),
          };
          void (async () => {
            await supabaseAdmin.from("chat_jobs").update({ resume_payload: resumePayload as any, ...(isResume ? {} : { auto_resumes: 0 }) }).eq("id", jobId);
            await supabaseAdmin.rpc("arm_job_resume" as any);
          })().catch(() => undefined);
        }

        // Snapshot current files BEFORE the AI mutates anything, so the user
        // can one-click revert to this stable version if the build fails.
        if (needsFileChange) {
          // Read files now (before any edit) but save the snapshot in the background.
          const { data: currentFiles } = await supabase
            .from("files")
            .select("path,content")
            .eq("project_id", projectId);
          void trace.time("snapshot.create", async () => {
            await supabase.from("project_snapshots").insert({
              project_id: projectId,
              user_id: userId,
              label: lastUserText.slice(0, 120) || "pre-build",
              files: currentFiles ?? [],
            });
          });
        }

        // Old image/tool/reasoning parts made every later request larger until
        // Groq rejected it. Keep recent text context and only this turn's media.
        const compactMessages = compactChatMessages(body.messages);

        // Does the current turn carry images (screenshots, mockups, video frames)?
        const hasImages = compactMessages.some((message) =>
          (message.parts ?? []).some(
            (part: any) => isVisualPart(part),
          ),
        );
        if (imageBuild && !hasImages) return fail(422, "Attach an image for Image build.");

        const requestedRef = parseModelKey(request.headers.get("x-forge-model"));
        const { ref: adminRef, autoFallback } = await readActiveModelRef();
        const availableProviders = Object.keys(providerKeys);
        // In plan mode prefer a strong reasoning model so it thinks longer.
        // The admin's chosen model (e.g. Grok 4.6) leads; for signup/login/admin/data
        // work it always leads, even over a per-editor pick.
        const backendIntent = /\b(sign ?up|sign ?in|log ?in|login|register|registration|auth|admin|dashboard|database|supabase|users?|account|save|data)\b/i.test(lastUserText);
        const planPreference = planMode && !adminRef ? pickPlanPreference(availableProviders, hasImages) : null;
        // A model picked by hand always leads; it is only replaced when it stops working.
        const preferred: ModelRef | null = requestedRef ?? (backendIntent && adminRef ? adminRef : (adminRef ?? planPreference));
        const fullChain = buildModelChain(preferred, { vision: false, availableProviders }) // images go to the vision planner; the coder gets a text blueprint;
        // Providers the admin added by pasting a key join the backup chain too.
        const { isCloudflareBaseUrl } = await import("@/lib/cloudflare-pool.server");
        // Cloudflare uses the saved pool coding model, never an implied selection.
        const extraProviders = providerRegistry.filter((p) => p.id.startsWith("custom-") && providerKeys[p.id] && !isCloudflareBaseUrl(p.baseURL));
        if (extraProviders.length) {
          const { listProviderModels } = await import("@/lib/model-discovery.server");
          // Ask every extra provider at once, and reuse answers for 10 minutes.
          const lists = await Promise.all(
            extraProviders.map(async (provider) => {
              const hit = extraModelCache.get(provider.id);
              if (hit && hit.at > Date.now() - 600_000) return hit.models;
              const models = await listProviderModels(provider.id, providerKeys[provider.id]!, provider).catch(() => [] as any[]);
              extraModelCache.set(provider.id, { at: Date.now(), models });
              return models;
            }),
          );
          for (const [index, provider] of extraProviders.entries()) {
            const models = lists[index]!;
            for (const model of models.filter((m) => m.tools).slice(0, 3)) {
              if (!fullChain.some((r) => r.provider === provider.id && r.model === model.id)) {
                fullChain.push({ provider: provider.id, model: model.id });
              }
            }
          }
        }
        // The admin-only Cloudflare pool toggle decides (default OFF).
        // OFF: the selected non-Cloudflare model only, no Cloudflare calls, no silent fallback.
        // ON: keys 1 → 60 in strict order, handing off at 9,000.
        const { readPoolSettings } = await import("@/lib/cf-pool-settings.server");
        const poolSettings = await readPoolSettings();
        const { workspacePick } = await import("@/lib/workspace-ai.server");
        const editorEngine = !imageBuild && !hasImages && request.headers.get("x-forge-engine") === "cloudflare" ? "cloudflare" : null;
        const selection = await workspacePick(planMode ? "plan" : "build", (existingJob?.build_engine as "openrouter" | "cloudflare" | null) ?? editorEngine, hasImages);
        const editorAuto = selection.engine === "cloudflare";
        if (editorAuto) {
          const approvalId = request.headers.get("x-forge-approval");
          const { data: approval } = approvalId ? await supabaseAdmin.from("assistant_edit_requests").select("id").eq("id", approvalId).eq("user_id", userId).eq("project_id", projectId).eq("request_key", requestKey).eq("status", "running").maybeSingle() : { data: null };
          if (!approval && request.headers.get("x-forge-approved") !== "yes") return fail(403, "Cloudflare approval required");
          if (!poolSettings.poolEnabled) return fail(424, "Cloudflare pool is off. Enable it in AI Models before approving a plan.");
        }
        const engineRef = existingJob?.engine_provider && existingJob.engine_model ? { provider: existingJob.engine_provider, model: existingJob.engine_model } : selection.ref;
        if (jobId) await supabaseAdmin.from("chat_jobs").update({ build_engine: selection.engine, engine_provider: engineRef?.provider ?? null, engine_model: engineRef?.model ?? null, status: "running" }).eq("id", jobId);
        const poolPositions = new Map<string, number>();
        let chain: ModelRef[] = [];
        let runCap: number | null = null;
        if (editorAuto) {
          const { loadCloudflarePool, readCloudflareCodingModel } = await import("@/lib/cloudflare-pool.server");
          const { orderPool, validateRunCap } = await import("@/lib/cf-pool-policy");
          const fullPool = orderPool(await loadCloudflarePool());
          for (const k of fullPool) poolPositions.set(k.id, k.position);
          const todayRemaining = fullPool.length ? fullPool.reduce((t, k) => t + Math.max(0, 9000 - k.used), 0) : null;
          const capCheck = validateRunCap(poolSettings.capEnabled, poolSettings.cap, todayRemaining);
          if (!capCheck.ok) return fail(422, JSON.stringify({ error: "run_cap_invalid", message: capCheck.error }), "application/json");
          runCap = capCheck.cap;
          // Retry / Approve-next-key buttons send the position to start from.
          const from = Math.max(1, Number(request.headers.get("x-forge-pool-from")) || 1);
          const codingModel = await readCloudflareCodingModel();
          // Skip keys already at the 9k hand-off line so a restart never lands back on a spent key.
          chain = fullPool.filter((k) => k.position >= from && k.used < 9000 && providerKeys[k.id]).map((k) => ({ provider: k.id, model: codingModel }));
          if (!chain.length) return fail(424, JSON.stringify({ error: "pool_empty", message: `No saved Cloudflare key from #${from} onward.` }), "application/json");
        } else {
          const { withoutCloudflare } = await import("@/lib/cf-pool-routing");
          const allowed = new Set(withoutCloudflare(providerRegistry).map((p) => p.id));
          const manual = requestedRef && providerRegistry.some((p) => p.id === requestedRef.provider && /^https:\/\/openrouter\.ai\/api\/v1/.test(p.baseURL)) ? requestedRef : null;
          const locked = existingJob?.engine_provider ? engineRef : hasImages ? selection.ref : manual ?? engineRef;
          if (!locked || !allowed.has(locked.provider) || !providerRegistry.some((p) => p.id === locked.provider && /^https:\/\/openrouter\.ai\/api\/v1/.test(p.baseURL))) return fail(424, "Select your OpenRouter text/image model in AI Models first.");
          if (!locked) return fail(424, JSON.stringify({ error: "model_unavailable", message: "The Cloudflare pool is off and no non-Cloudflare coding model is selected. Pick one in Admin → Models, or turn the pool on." }), "application/json");
          chain = [locked];
        }


        // One pool run at a time, enforced by a unique index on running pool jobs.
        if (editorAuto && jobId) {
          // A dead run (no heartbeat for 3 minutes) must never hold the pool lock.
          // A server restart of this same job keeps its own lock.
          await supabaseAdmin
            .from("chat_jobs")
            .update({ status: "failed", pool_run: false, progress: "Stopped before completion", error: "The previous build stopped unexpectedly.", completed_at: new Date().toISOString() } as any)
            .eq("pool_run" as any, true)
            .neq("id", jobId)
            .in("status", ["queued", "running"])
            .lt("updated_at", new Date(Date.now() - 180_000).toISOString())
            .then(() => undefined, () => undefined);
          const { error: lockErr } = await supabaseAdmin.from("chat_jobs").update({ pool_run: true } as any).eq("id", jobId);
          if (lockErr) {
            await supabaseAdmin.from("chat_jobs").update({ status: "failed", error: "Another Cloudflare pool run is already going.", completed_at: new Date().toISOString() }).eq("id", jobId);
            return fail(409, JSON.stringify({ error: "pool_busy", message: "Another Cloudflare pool run is already going. Wait for it to finish or press Stop." }), "application/json");
          }
        }
        const { readAiGatewaySetting } = await import("@/lib/model-router.server");
        const gateway = await readAiGatewaySetting();
        let visualBrief = "";
        if (hasImages && !planMode && needsFileChange) {
          const selectedVision = parseModelKey(request.headers.get("x-forge-vision-model"));
          const { data: poolSettings } = await supabaseAdmin
            .from("ai_pool_settings")
            .select("vision_provider,vision_model")
            .eq("id", "global")
            .maybeSingle();
          const visionPreference = selectedVision ?? (poolSettings?.vision_provider && poolSettings?.vision_model
            ? { provider: poolSettings.vision_provider, model: poolSettings.vision_model }
            : null);
          const { planAttachedImages } = await import("@/lib/vision-planner.server");
          const { imageReaderRef } = await import("@/lib/image-delivery");
          const visualPlan = await planAttachedImages({
            messages: compactMessages,
            providers: providerRegistry.filter((p) => /^https:\/\/openrouter\.ai\/api\/v1/.test(p.baseURL)),
            keys: providerKeys,
            preferred: imageReaderRef(existingJob?.engine_provider ? engineRef : null, imageBuild ? chain[0] ?? null : selectedVision, engineRef ?? visionPreference),
            strict: true,
            gateway,
            onSwitch: async () => {},
          });
          if (!visualPlan) return fail(424, JSON.stringify({ error: "vision_unavailable", message: "No working image model could read this image. Refresh the first lightning menu or add a vision-capable key." }), "application/json");
          visualBrief = visualPlan.brief;
          await supabaseAdmin.from("project_visual_briefs").insert({
            project_id: projectId,
            user_id: userId,
            source_name: "Attached image",
            vision_provider: visualPlan.ref.provider,
            vision_model: visualPlan.ref.model,
            brief: visualPlan.brief,
          });
          trace.log("vision.plan", { detail: { provider: visualPlan.ref.provider, model: visualPlan.ref.model, failed: visualPlan.failed.length } });
        }
        const pick = await trace.time("model.pick", () =>
          pickAvailableModel(chain, providerKeys, providerRegistry, gateway),
        );
        if (!pick.ok) {
          trace.log("model.unavailable", { status: "error", message: pick.error });
          // With Auto off there is no fallback by design — say plainly that the
          // chosen model or its key is the problem instead of a generic message.
          const raw = String(pick.error ?? "");
          const reason = /not available on the Workers Free plan/i.test(raw)
            ? " Cloudflare only offers this model on its paid Workers plan."
            : /insufficient_quota|free quota exhausted|free tier only/i.test(raw)
              ? " This key's free allowance is used up. Add funds to that account, or turn off its \"use free tier only\" setting, then try again."
              : /max_tokens/i.test(raw)
                ? " The provider rejected the reply length."
                : /401|403|unauthori|invalid api key/i.test(raw)
                  ? " The provider key was rejected."
                  : /429|rate limit|quota/i.test(raw)
                    ? " The provider's limit has been reached for now."
                    : "";
          // Name the model that was actually tried, never an unrelated saved pick.
          const lockedRef = !(editorAuto) ? (chain[0] ?? null) : null;
          const locked = !!lockedRef;
          const message = locked
            ? `The model you picked (${lockedRef!.model}) can't answer right now.${reason} Pick a different model, or turn Auto-switch on to let Forge choose one.`
            : pick.error;
          // A locked model being out of quota is an expected, explained outcome,
          // not a server crash — answer with a 4xx so it isn't reported as one.
          return fail(
            locked ? 424 : pick.status,
            JSON.stringify({ error: "model_unavailable", message }),
            "application/json",
          );
        }
        trace.log("model.selected", {
          detail: {
            provider: pick.ref.provider,
            model: pick.ref.model,
            hasImages,
            autoFallback,
            inputMessages: body.messages.length,
            sentMessages: compactMessages.length,
          },
        });

        const provider = createGroqProvider(pick.apiKey, pick.baseURL);
        const model = provider(pick.ref.model);
        const store = createSupabaseFileStore(supabase, projectId, userId);
        const { createIntegrationTools } = await import("@/lib/integration-tools.server");
        const integrationTools = createIntegrationTools({ projectId, userId, projectName: proj.name, trace });
        const allTools = {
          ...createProjectFileTools(store, trace),
          ...createSecretTools(createSupabaseSecretStore(supabase, projectId), trace),
          ...((/models\.github\.ai/i.test(pick.baseURL) ? {} : integrationTools) as typeof integrationTools),
        };
        // Plan mode is read-only: it can look at the project but never change it.
        const tools = planMode
          ? ({
              list_files: allTools.list_files,
              read_file: allTools.read_file,
              list_secrets: allTools.list_secrets,
              web_search: integrationTools.web_search,
              search_images: integrationTools.search_images,
            } as typeof allTools)
          : allTools;

        // Brief the model on what this project IS. Chat history gets compacted
        // away over time and the fallback chain can hand the turn to a model
        // that has never seen this project, so the purpose is restated every turn.
        const [{ data: briefFiles }, { data: firstUserMessage }] = await Promise.all([
          supabase.from("files").select("path").eq("project_id", projectId).limit(200),
          supabase
            .from("chat_messages")
            .select("content")
            .eq("project_id", projectId)
            .eq("role", "user")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle(),
        ]);
        const { loadProjectBackend } = await import("@/lib/project-backend.server");
        const [projectBackend, { data: progressRow }, { data: brainRow }] = await Promise.all([
          loadProjectBackend(projectId),
          supabaseAdmin.from("projects").select("agent_progress").eq("id", projectId).maybeSingle(),
          supabaseAdmin.from("project_brain_notes").select("content").eq("project_id", projectId).maybeSingle(),
        ]);
        const progressModel: { name?: string; files: Set<string> } = { files: new Set() };
        progressModel.name = `${pick.ref.model} (${pick.ref.provider})`;
        const saveProgress = (progress: Record<string, unknown>) =>
          supabaseAdmin.from("projects").update({
            agent_progress: { ...progress, model: progressModel.name ?? null, filesChanged: [...progressModel.files].slice(0, 40) } as any,
          }).eq("id", projectId);
        const projectBrief = {
          backend: projectBackend,
          progress: (progressRow?.agent_progress as any) ?? null,
          description: proj.description,
          originalGoal: firstUserMessage?.content ?? null,
          filePaths: (briefFiles ?? []).map((file: any) => file.path),
          userNotes: `${brainRow?.content ?? ""}${visualBrief ? `\n\nLatest visual brief:\n${visualBrief}` : ""}`,
        };
        trace.log("project.brief", {
          detail: { files: projectBrief.filePaths.length, hasGoal: Boolean(projectBrief.originalGoal) },
        });

        // A text-only model would 400 on image parts — drop them rather than fail.
        const { listProviderModels: listPickedModels } = await import("@/lib/model-discovery.server");
        const pickedProvider = providerRegistry.find((p) => p.id === pick.ref.provider);
        const visionOk = hasImages && pickedProvider && /^https:\/\/openrouter\.ai\/api\/v1/.test(pickedProvider.baseURL)
          ? (await listPickedModels(pick.ref.provider, pick.apiKey, pickedProvider)).find((m) => m.id === pick.ref.model)?.vision === true
          : modelSupportsVision(pick.ref);
        if (hasImages && !planMode && !visualBrief && !visionOk) return fail(424, "The selected model does not declare image input. Choose an image-capable OpenRouter model.");
        // GitHub Models' free tier only accepts ~8k input / 4k output tokens per
        // request, so send a much shorter history there or it silently rejects.
        const isGitHubModels = /models\.github\.ai/i.test(pick.baseURL);
        const turnMessages = isGitHubModels ? compactChatMessages(body.messages, 3) : compactMessages;
        const strippedMessages = visionOk && (!visualBrief || imageBuild)
          ? turnMessages
          : turnMessages.map((message) => ({
              ...message,
              parts: (message.parts ?? []).filter(
                (part: any) => !isVisualPart(part),
              ),
            }));
        // Empty turns (e.g. a reply that only "thought") make providers answer
        // 400 Bad Request. Drop them and merge back-to-back user turns.
        const outgoingMessages: typeof strippedMessages = [];
        for (const message of strippedMessages) {
          const parts = (message.parts ?? []).filter((part: any) =>
            part?.type === "text" ? String(part.text ?? "").trim().length > 0 : part?.type !== "reasoning",
          );
          if (parts.length === 0) continue;
          const prev = outgoingMessages[outgoingMessages.length - 1];
          if (prev && prev.role === "user" && message.role === "user") {
            prev.parts = [...(prev.parts ?? []), ...parts];
            continue;
          }
          outgoingMessages.push({ ...message, parts });
        }
        if (outgoingMessages.length === 0) return fail(400, "Please type a message first.");

        // ---- Server-side agent loop ----------------------------------------
        // The whole job (every step, every key hand-over) runs here on the
        // server, independent of the browser. If a model hangs for 35s, or a
        // Cloudflare key hits its daily Neuron/quota limit, or the stream
        // breaks, the server switches to the next key itself and continues
        // from the last finished step. The browser only watches.
        const STEP_TIMEOUT_MS = 35_000;
        const MAX_ATTEMPTS = 12;
        const STEP_LIMIT = 40;
        const MAX_ROUNDS = 3; // total rounds, including the first one
        const isCfUrl = (url: string) => /api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/ai/i.test(url);
        const errText = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));

        let userStopped = false;
        let currentAbort: AbortController | null = null;
        let stepNo = 0;
        let progressText = "AI is working";
        const recentCalls: string[] = [];
        const replyTexts: string[] = [];

        let beats = 0;
        const heartbeat = jobId
          ? setInterval(async () => {
              beats += 1;
              const { data: jobRow } = await supabaseAdmin.from("chat_jobs").select("status").eq("id", jobId).maybeSingle();
              if (jobRow && jobRow.status !== "queued" && jobRow.status !== "running") {
                userStopped = true;
                currentAbort?.abort();
                return;
              }
              if (beats % 2 === 0) {
                void supabaseAdmin
                  .from("chat_jobs")
                  .update({ progress: progressText, updated_at: new Date().toISOString() })
                  .eq("id", jobId)
                  .in("status", ["queued", "running"]);
              }
            }, 2_000)
          : undefined;
        const stopHeartbeat = () => {
          if (heartbeat) clearInterval(heartbeat);
        };
        const setProgress = (text: string) => {
          progressText = text;
          if (jobId) {
            void supabaseAdmin
              .from("chat_jobs")
              .update({ progress: text, updated_at: new Date().toISOString() })
              .eq("id", jobId)
              .in("status", ["queued", "running"]);
          }
        };

        // Shared work record so a fallback model never starts blind.
        const workLog: string[] = [];
        for (const message of body.messages as any[]) {
          if (message?.role !== "assistant") continue;
          for (const part of message.parts ?? []) {
            const type = String(part?.type ?? "");
            if (!type.startsWith("tool-")) continue;
            const input = part?.input ?? {};
            const target = input.path ?? input.file ?? input.query ?? "";
            const state = part?.state === "output-error" ? " (failed)" : "";
            workLog.push(`- ${type.slice(5)}${target ? ` ${String(target).slice(0, 160)}` : ""}${state}`);
          }
        }
        const sharedContext = workLog.length
          ? `\n\nWork already done earlier in this chat (most recent last; previous models may have made these changes — read files before editing, do not redo finished work):\n${workLog.slice(-40).join("\n")}`
          : "";
        // Named asset library: the agent maps "@handle" to the exact URL.
        const { data: assetRows } = await supabaseAdmin
          .from("project_assets")
          .select("handle, url, content_type")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(60);
        const mentionedHandles = Array.from(lastUserText.matchAll(/@([A-Za-z0-9_\-.]+)/g)).map((m) => m[1]!.toLowerCase().replace(/[.]+$/, ""));
        const requiredAssets = (assetRows ?? []).filter((a) => mentionedHandles.includes(a.handle.toLowerCase()));
        const missingHandles = mentionedHandles.filter((h) => !(assetRows ?? []).some((a) => a.handle.toLowerCase() === h) && !h.includes("."));
        const assetContext =
          (assetRows?.length
            ? `\n\n## Named assets (use these EXACT URLs when the user mentions @name)\n${assetRows
                .map((a) => `- @${a.handle} (${a.content_type?.startsWith("video/") ? "video" : "image"}): ${a.url}`)
                .join("\n")}\nImages go in <img src>, videos in <video src controls playsinline>. Never invent or alter these URLs.`
            : "") +
          (requiredAssets.length
            ? `\n\n## REQUIRED in this turn\nThe user referenced these assets. You MUST write_file so the code literally contains each exact URL below where they asked. Saying it was used without writing the file is a failure.\n${requiredAssets.map((a) => `- @${a.handle} → ${a.url}`).join("\n")}`
            : "") +
          (missingHandles.length && assetRows
            ? `\n\nThese @names are NOT in the asset library: ${missingHandles.map((h) => `@${h}`).join(", ")}. Tell the user plainly instead of inserting a random image.`
            : "");
        let assetRetryDone = false;
        const findUnusedAssets = async () => {
          const missing: typeof requiredAssets = [];
          for (const a of requiredAssets) {
            const { count } = await supabaseAdmin
              .from("files")
              .select("id", { count: "exact", head: true })
              .eq("project_id", projectId)
              .ilike("content", `%${a.url.replace(/[%_]/g, "\\$&")}%`);
            if (!count) missing.push(a);
          }
          return missing;
        };
        // Website cloner: compact blueprint of a linked site. Clone mode (third
        // ⚡ button) or a "clone <url>" message triggers it. MiroMiro (saved admin
        // key) gives a rich design read; the simple fetcher is the fallback.
        const { detectCloneUrl, buildSiteBlueprint } = await import("@/lib/site-cloner.server");
        const anyUrl = lastUserText.match(/https?:\/\/[^\s<>"')]+/i)?.[0]?.replace(/[.,;]+$/, "") ?? null;
        const cloneUrl = detectCloneUrl(lastUserText) ?? (cloneMode ? anyUrl : null);
        let blueprint: string | null = null;
        let cloneSource = "simple";
        if (cloneUrl) {
          const { cloneSiteWithMiroMiro } = await import("@/lib/miromiro.server");
          const miro = await cloneSiteWithMiroMiro(cloneUrl).catch(() => null);
          if (miro) {
            blueprint = miro.blueprint;
            cloneSource = "miromiro";
            if (miro.creditsLeft != null && miro.creditsLeft < 30) {
              trace.log("clone.quota_low", { detail: { creditsLeft: miro.creditsLeft } });
            }
          }
          if (!blueprint) blueprint = await buildSiteBlueprint(cloneUrl);
        }
        if (cloneUrl) trace.log("clone.blueprint", { detail: { url: cloneUrl, ok: Boolean(blueprint), source: cloneSource } });
        const cloneContext = blueprint
          ? `\n\n## Design blueprint of the site to replicate\n${blueprint}\nBuild a responsive page matching this layout, colors, navigation and text. Write original code; use the listed image URLs where fitting.`
          : cloneUrl
            ? `\n\nThe user linked ${cloneUrl} to replicate, but it could not be read. Build your best matching page and say in one line that the site couldn't be read.`
            : "";
        const visualContext = visualBrief ? `\n\n## Visual planner brief\n${visualBrief}\nThis brief was created by the image reader. You are the coding boss: use it as the source of truth and edit the files now. Do not spend tokens re-describing the image.` : "";
        const { vaultPromptSection } = await import("@/lib/admin-vault.server");
        const adminVaultContext = await vaultPromptSection();
        // "/spec", "/plan", "/build"… at the start of a message activates that Brain skill.
        const { loadBrainNotes } = await import("@/lib/admin-vault.server");
        const { activeSkillSection } = await import("@/lib/brain-skills");
        const skillContext = activeSkillSection(lastUserText, await loadBrainNotes());
        const systemPrompt =
          (planMode ? buildPlanSystemPrompt(proj.name, projectBrief) : buildSystemPrompt(proj.name, projectBrief)) +
          sharedContext + assetContext + cloneContext + visualContext + adminVaultContext + skillContext;
        const baseMessages = await convertToModelMessages(outgoingMessages as UIMessage[]);
        // Messages produced by finished steps of earlier (failed) attempts.
        let carried: any[] = [];

        type Pick = { ref: ModelRef; apiKey: string; baseURL: string };
        let current: Pick = pick;
        const tried = new Set<string>([`${pick.ref.provider}:${pick.ref.model}`]);

        // Browser disconnects must never cost a key or switch models: writes to a
        // closed stream are swallowed and the job keeps running here.
        const safeWriter = (w?: { merge: (s: ReadableStream<any>) => void; write: (c: any) => void }) =>
          w && {
            merge: (st: ReadableStream<any>) => { try { w.merge(st); } catch { /* browser gone */ } },
            write: (c: any) => { try { w.write(c); } catch { /* browser gone */ } },
          };
        const isClientDrop = (msg: string) => /client (closed|disconnect)|ResponseAborted|BodyStreamBuffer|socket hang up|premature close/i.test(msg);
        let clientDropRetries = 0;
        let sameKeyRetries = 0;
        let runUsed = 0;
        let capHit = false;
        let pausedAtKey: number | null = null;
        let stopNote: string | null = null;
        const ledger: any[] = [];
        const runJob = async (rawWriter?: { merge: (s: ReadableStream<any>) => void; write: (c: any) => void }) => {
          const writer = safeWriter(rawWriter);
          let finalReason: string | undefined;
          let lastError: string | null = null;
          let rounds = 1;
          let stoppedEarly = false;
          let stopCause = "";
          let outOfKeys = false;
          let gateRetries = 0;
          let incompleteReason: string | null = null;
          let baton = emptyBaton();
          const replyLog: string[] = [];
          const keyNo = (id: string) => poolPositions.get(id) ?? "?";

          for (let attempt = 0; attempt < MAX_ATTEMPTS && !userStopped; attempt++) {
            const isGh = /models\.github\.ai/i.test(current.baseURL);
            const isCf = isCfUrl(current.baseURL);
            progressModel.name = `${current.ref.model} (${current.ref.provider})`;
            const attemptAbort = new AbortController();
            currentAbort = attemptAbort;
            let timedOut = false;
            let handoff = false;
            let attemptNeurons = 0;
            let baseNeurons = 0;
            const cfPool = isCf ? await import("@/lib/cloudflare-pool.server") : null;
            const stepCosts: number[] = [];
            let streamedChars = 0;
            let countSource: "cloudflare" | "estimate" | "uncertain" = "estimate";
            if (cfPool) {
              // Start from the real count Cloudflare shows; fall back to our own count.
              const { data: u } = await supabaseAdmin
                .from("cloudflare_neuron_usage" as any)
                .select("neurons_used")
                .eq("provider_id", current.ref.provider)
                .eq("day", cfPool.utcDay())
                .maybeSingle();
              baseNeurons = Number((u as any)?.neurons_used ?? 0);
              try {
                const acct = /accounts\/([^/]+)\//i.exec(current.baseURL)?.[1];
                const real = acct ? await cfPool.fetchRealNeurons(acct, current.apiKey) : null;
                if (real != null) baseNeurons = Math.max(baseNeurons, real);
              } catch { /* estimate stays */ }
            }
            let failure: string | null = null;
            let finished = false;
            let attemptSteps: any[] = [];
            let attemptStepCount = 0;
            let loopHit = false;
            let watchdog: ReturnType<typeof setTimeout> | undefined;
            const kick = () => {
              if (watchdog) clearTimeout(watchdog);
              watchdog = setTimeout(() => {
                timedOut = true;
                attemptAbort.abort();
              }, STEP_TIMEOUT_MS);
            };
            kick();
            const model = createGroqProvider(current.apiKey, current.baseURL)(current.ref.model);
            trace.log("attempt.start", { detail: { attempt, provider: current.ref.provider, model: current.ref.model, carried: carried.length } });

            const result = streamText({
              model,
              system: systemPrompt,
              messages: [...baseMessages, ...trimCarried(carried)],
              tools,
              abortSignal: attemptAbort.signal,
              onChunk: ({ chunk }: any) => {
                kick();
                if (chunk?.type === "text-delta" || chunk?.type === "reasoning-delta") streamedChars += String(chunk.text ?? chunk.delta ?? "").length;
              },
              onStepFinish: async (step: any) => {
                kick();
                stepNo += 1;
                attemptStepCount += 1;
                attemptSteps = step?.response?.messages ?? attemptSteps;
                const visible = stripThinking(String(step?.text ?? ""));
                if (visible) replyTexts.push(visible);
                // Only successful writes/edits/deletes count as changed files; reads don't.
                for (const p of changedPathsFromStep(step)) progressModel.files.add(p);
                let last = "";
                for (const c of (step?.toolCalls ?? []) as any[]) {
                  const path = c?.input?.path ?? c?.args?.path;
                  const name = String(c?.toolName ?? "tool");
                  last = `${name.replace(/_/g, " ")}${typeof path === "string" ? ` ${path}` : ""}`;
                  recentCalls.push(`${name}:${JSON.stringify(c?.input ?? c?.args ?? {}).slice(0, 400)}`);
                }
                if (cfPool) {
                  const counted = countCallSync({ model: current.ref.model, inputTokens: step?.usage?.inputTokens, outputTokens: step?.usage?.outputTokens, chars: String(step?.text ?? "").length });
                  if (counted.source === "uncertain") countSource = "uncertain";
                  const cost = counted.neurons;
                  const { recordNeuronCall } = await import("@/lib/workspace-ai.server");
                  await recordNeuronCall({ user_id: userId, project_id: projectId, request_key: requestKey, section: planMode ? "plan" : needsFileChange ? "build" : "chat", provider_id: current.ref.provider, key_number: poolPositions.get(current.ref.provider), model: current.ref.model, step: stepNo, input_tokens: step?.usage?.inputTokens, output_tokens: step?.usage?.outputTokens, neurons: cost, source: counted.source, action: last || (planMode ? "Planning step" : "Response") });
                  attemptNeurons += cost;
                  stepCosts.push(cost);
                  // Look ahead: stop now if the next step would cross 9,000 (1,000 reserve kept).
                  if (editorAuto && shouldHandoff(baseNeurons + attemptNeurons, stepCosts)) handoff = true;
                  if (runCap != null && runUsed + attemptNeurons >= runCap) { handoff = true; capHit = true; }
                  const tot = Math.round(baseNeurons + attemptNeurons);
                  replyLog.push(`Key #${keyNo(current.ref.provider)} · step cost ${cost} · ${tot.toLocaleString()} / 9,000 · ${Math.max(0, 9000 - tot).toLocaleString()} left`);
                  writer?.write({
                    type: "message-metadata",
                    messageMetadata: { neurons: { key: current.ref.provider, keyNo: keyNo(current.ref.provider), start: Math.round(baseNeurons), used: Math.round(attemptNeurons), step: stepCosts[stepCosts.length - 1] ?? 0, cap: cfPool.SOFT_CAP_NEURONS, log: replyLog.slice(-20) } },
                  });
                }
                if (recentCalls.length > 12) recentCalls.splice(0, recentCalls.length - 12);
                const neuronNote = cfPool ? ` · ${(Math.round(baseNeurons + attemptNeurons) / 1000).toFixed(1)}k/9k Neurons` : "";
                setProgress(`Step ${stepNo}${last ? ` · ${last}` : " · thinking"} · ${progressModel.files.size} file(s) changed${neuronNote}`);
              },
              prepareStep: (opts: any) => {
                createPrepareStep(needsFileChange, trace)(opts);
                if (!cfPool) return undefined;
                const total = Math.round(baseNeurons + attemptNeurons);
                // Preflight guard: never send a call whose worst case could pass 9,500.
                const lastCost = stepCosts.length ? Math.max(stepCosts[stepCosts.length - 1]!, stepCosts.reduce((a, b) => a + b, 0) / stepCosts.length) * 1.25 : 500;
                if (editorAuto && (total >= 9000 || !preflightAllowed(total, lastCost))) {
                  handoff = true;
                  trace.log("pool.preflight_block", { detail: { total, projected: total + lastCost, max: PREFLIGHT_MAX } });
                  attemptAbort.abort();
                  return undefined;
                }
                return {
                  system: `${systemPrompt}\n\n## Neuron budget (this key)\nStarted at ${Math.round(baseNeurons)}, used this turn ${Math.round(attemptNeurons)}, now ${total} of the 9,000 soft cap (${Math.max(0, 9000 - total)} left). Finish each step completely; if close to 9,000, end the current step cleanly so the next key can continue.${baton.items.length || baton.keyLog.length ? `\n\n${batonNote(baton, `Key #${keyNo(current.ref.provider)}`)}` : ""}`,
                };
              },
              stopWhen: [
                stepCountIs(STEP_LIMIT),
                () => handoff,
                () => {
                  const n = recentCalls.length;
                  const looping = n >= 3 && recentCalls[n - 1] === recentCalls[n - 2] && recentCalls[n - 2] === recentCalls[n - 3];
                  if (looping) loopHit = true;
                  return looping;
                },
              ],
              // Alibaba Model Studio only accepts reply lengths between 10 and 2048.
              maxOutputTokens: isGh
                ? 4_000
                : /aliyuncs\.com|dashscope/i.test(current.baseURL)
                  ? 2_048
                  : maxOutputTokensFor(current.ref),
              onFinish: async ({ finishReason, usage }) => {
                finished = true;
                finalReason = finishReason;
                trace.log("stream.finish", { detail: { finishReason, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null } });
              },
              onError: ({ error }) => {
                failure = errText(error) || "Stream failed";
              },
              onAbort: () => {
                if (timedOut) failure = `${current.ref.model} sent nothing for 35 seconds`;
              },
            });

            if (writer) {
              // Drop "abort" chunks: a key hand-off or retry aborts one attempt, but the
              // job keeps going on the server. Passing it on made the editor think the
              // whole build stopped and resend it, which then collided with the live run.
              writer.merge(
                result
                  .toUIMessageStream({ sendStart: attempt === 0, sendFinish: false, sendReasoning: true })
                  .pipeThrough(new TransformStream({ transform(chunk, ctl) { if ((chunk as { type?: string }).type !== "abort") ctl.enqueue(chunk); } })),
              );
            }
            // Drain the stream on the server no matter what the browser does.
            await result.consumeStream({ onError: (e) => { failure ??= errText(e); } });
            if (watchdog) clearTimeout(watchdog);

            // Record the sum of every step's cost. Failed calls that streamed text but
            // reported no tokens are counted from characters, labeled uncertain.
            if (cfPool && attemptStepCount === 0) {
              const { countCall } = await import("@/lib/cf-pool-policy");
              const c = countCall({ model: current.ref.model, chars: streamedChars });
              attemptNeurons = c.neurons;
              countSource = "uncertain";
              const { recordNeuronCall } = await import("@/lib/workspace-ai.server");
              await recordNeuronCall({ user_id: userId, project_id: projectId, request_key: requestKey, section: planMode ? "plan" : "build", provider_id: current.ref.provider, key_number: poolPositions.get(current.ref.provider), model: current.ref.model, neurons: c.neurons, source: c.source, action: "Interrupted call", status: "partial" });
            }
            // The ledger trigger atomically updates the daily key total.
            runUsed += attemptNeurons;
            if (handoff && cfPool) {
              if (attemptSteps.length) carried = [...carried, ...attemptSteps];
              const label = `Key #${keyNo(current.ref.provider)}`;
              baton = mergeBaton(baton, {
                files: [...progressModel.files],
                next: `continue after: ${progressText}`,
                keyLog: [{ key: label, neurons: Math.round(baseNeurons + attemptNeurons), items: `${attemptStepCount} step(s)` }],
              });
              const { handoffNote } = await import("@/lib/cf-pool-policy");
              const nextPos = (Number(keyNo(current.ref.provider)) || 0) + 1;
              carried.push({
                role: "user",
                content: `${batonNote(baton, `Key #${nextPos}`)}\n\n${handoffNote({ completed: [...progressModel.files], remaining: "the rest of the original request", lastError, next: `continue after: ${progressText}`, position: nextPos })}`,
              });
              writer?.write({ type: "message-metadata", messageMetadata: { handoff: { from: label, neurons: Math.round(baseNeurons + attemptNeurons), files: progressModel.files.size } } });
              trace.log("attempt.handoff", { detail: { attempt, provider: current.ref.provider, neurons: baseNeurons + attemptNeurons } });
              failure = null;
              attempt -= 1; // a handoff is not a failure and never uses up an attempt
            }
            const success = finished && !failure && !timedOut && !handoff;
            if (success && requiredAssets.length && !assetRetryDone && !userStopped) {
              const unused = await findUnusedAssets();
              if (unused.length) {
                assetRetryDone = true;
                if (attemptSteps.length) carried = [...carried, ...attemptSteps];
                carried.push({
                  role: "user",
                  content: `Check failed: no project file contains these asset URLs yet: ${unused.map((a) => `@${a.handle} → ${a.url}`).join("; ")}. read_file the page, then write_file it with each exact URL placed where I asked. Do not claim it is done until written.`,
                });
                trace.log("asset.recheck", { detail: { missing: unused.map((a) => a.handle) } });
                finished = false;
                finalReason = undefined;
                attempt -= 1;
                continue;
              }
            }
            // An empty stream with no output counts as a failure too.
            if (success && (stepNo > 0 || replyTexts.length)) {
              // Only a natural finish counts. The 40-step limit and the
              // repeated-call guard mean the work is not done yet.
              const hitLimit = loopHit || attemptStepCount >= STEP_LIMIT;
              if (!hitLimit) {
                stoppedEarly = false;
                // "Is it really done?" check before calling it Finished.
                if (!planMode && !userStopped) {
                  const changedList = [...progressModel.files];
                  const [{ data: changedRows }, { data: pathRows }] = await Promise.all([
                    changedList.length
                      ? supabaseAdmin.from("files").select("path,content").eq("project_id", projectId).in("path", changedList)
                      : Promise.resolve({ data: [] as any[] }),
                    supabaseAdmin.from("files").select("path").eq("project_id", projectId),
                  ]);
                  const gate = completionGate({
                    needsFileChange,
                    changed: changedList.map((p) => ({ path: p, content: (changedRows ?? []).find((r: any) => r.path === p)?.content ?? null })),
                    allPaths: (pathRows ?? []).map((r: any) => r.path),
                    finalText: replyTexts[replyTexts.length - 1] ?? "",
                  });
                  trace.log("gate.check", { status: gate.ok ? "ok" : "warn", message: gate.ok ? undefined : gate.reason, detail: { changed: changedList.length, retries: gateRetries } });
                  if (!gate.ok) {
                    incompleteReason = gate.reason;
                    if (gateRetries < MAX_GATE_RETRIES) {
                      gateRetries += 1;
                      if (attemptSteps.length) carried = [...carried, ...attemptSteps];
                      carried.push({ role: "user", content: gate.nudge });
                      recentCalls.length = 0;
                      setProgress(`Check: ${gate.reason} · sending it back to finish (${gateRetries}/${MAX_GATE_RETRIES})`);
                      finished = false;
                      finalReason = undefined;
                      attempt -= 1;
                      continue;
                    }
                  } else {
                    incompleteReason = null;
                  }
                }
                break;
              }
              stoppedEarly = true;
              stopCause = loopHit ? "repeated-tool-call guard" : `${STEP_LIMIT}-step limit`;
              trace.log("round.limit", { detail: { round: rounds, cause: stopCause, steps: stepNo } });
              if (rounds >= MAX_ROUNDS || userStopped) break;
              if (attemptSteps.length) carried = [...carried, ...attemptSteps];
              carried.push({
                role: "user",
                content: `Continuation (round ${rounds + 1} of ${MAX_ROUNDS}): the previous round was cut off by the ${stopCause}, the task is NOT finished. Files already written (trust them): ${[...progressModel.files].slice(-20).join(", ") || "none"}. Do not repeat the same tool call with the same input. Do the remaining work of the original request, then stop with a short summary.`,
              });
              recentCalls.length = 0;
              rounds += 1;
              if (editorAuto) {
                const remaining = chain.filter((r) => !tried.has(`${r.provider}:${r.model}`));
                const next = remaining.length ? await pickAvailableModel(remaining, providerKeys, providerRegistry, gateway) : null;
                if (!next || !next.ok) {
                  if (next && !next.ok) lastError = null;
                  outOfKeys = true;
                  break;
                }
                current = next;
                tried.add(`${next.ref.provider}:${next.ref.model}`);
                writer?.write({ type: "message-metadata", messageMetadata: { model: `${next.ref.model.split("/").pop()} · ${next.ref.provider}`, keyPos: poolPositions.get(next.ref.provider) ?? null } });
              }
              setProgress(`Round ${rounds} of ${MAX_ROUNDS} · continuing · ${progressModel.files.size} file(s) changed`);
              finalReason = undefined;
              continue;
            }
            if (userStopped) break;
            lastError = handoff ? "Soft cap handoff" : failure ?? (timedOut ? "Timed out" : "The model returned nothing");
            // A dropped browser connection is not the key's fault: retry the same key.
            if (!handoff && !timedOut && failure && isClientDrop(failure) && clientDropRetries < 3) {
              clientDropRetries += 1;
              if (attemptSteps.length) carried = [...carried, ...attemptSteps];
              lastError = null;
              continue;
            }

            // Keep the finished steps so the next key continues where this stopped.
            if (attemptSteps.length) carried = [...carried, ...attemptSteps];
            if (!handoff) await recordModelStatus(current.ref, /429|rate.?limit/i.test(lastError) ? "rate_limited" : "unavailable", null, lastError);
            trace.log("attempt.failover", { status: "error", message: lastError, detail: { attempt, provider: current.ref.provider } });

            if (!(editorAuto)) break;
            const P = await import("@/lib/cf-pool-policy");
            const pos = Number(keyNo(current.ref.provider)) || 0;
            if (!handoff) {
              // Only a confirmed daily-allocation error counts as quota; a bare 429 never marks a key used up.
              const kind = P.classifyError(/\b429\b/.test(lastError) ? 429 : null, lastError);
              const decision = P.onKeyError(kind, sameKeyRetries);
              if (decision.action === "retry") {
                sameKeyRetries += 1;
                ledger.push(P.ledgerEntry({ key: pos, filesDone: [...progressModel.files], neuronsThisTurn: Math.round(attemptNeurons), totalAtHandoff: Math.round(baseNeurons + attemptNeurons), source: countSource, reason: `rate limited — retry ${decision.attempt} of ${P.SAME_KEY_RETRIES} in 60s`, successor: pos, retries: sameKeyRetries }));
                setProgress(`Key #${pos} rate limited · retry ${decision.attempt}/${P.SAME_KEY_RETRIES} in 60s`);
                await new Promise((r) => setTimeout(r, decision.delayMs));
                lastError = null;
                attempt -= 1;
                continue;
              }
              if (decision.action === "pause") {
                pausedAtKey = pos;
                ledger.push(P.ledgerEntry({ key: pos, filesDone: [...progressModel.files], neuronsThisTurn: Math.round(attemptNeurons), totalAtHandoff: Math.round(baseNeurons + attemptNeurons), source: countSource, reason: `paused: ${lastError.slice(0, 200)}`, successor: null, retries: sameKeyRetries }));
                break;
              }
            }
            // Handoff or confirmed quota → next key in strict order. Re-check the toggle and cap.
            const live = await readPoolSettings();
            const stop = P.runStopReason({ runUsed, cap: runCap, poolEnabled: editorAuto, userStopped, taskDone: false, atLastKey: !P.nextKey(chain.map((r) => ({ position: Number(keyNo(r.provider)) || 0 })), pos) });
            ledger.push(P.ledgerEntry({ key: pos, filesDone: [...progressModel.files], neuronsThisTurn: Math.round(attemptNeurons), totalAtHandoff: Math.round(baseNeurons + attemptNeurons), source: countSource, reason: handoff ? (capHit ? "run cap reached" : "handoff at 9,000") : `quota: ${lastError.slice(0, 160)}`, successor: stop ? null : pos + 1, retries: sameKeyRetries }));
            sameKeyRetries = 0;
            if (stop) {
              stopNote = stop;
              if (stop === "last_key") outOfKeys = true;
              break;
            }
            const remaining = chain.filter((r) => !tried.has(`${r.provider}:${r.model}`) && (Number(keyNo(r.provider)) || 0) > pos);
            if (!remaining.length) {
              outOfKeys = true;
              break;
            }
            setProgress(`${progressText} · switching to the next key`);
            if (writer) writer.write({ type: "message-metadata", messageMetadata: { model: "switching to the next key…" } });
            const next = await pickAvailableModel(remaining, providerKeys, providerRegistry, gateway);
            if (!next.ok) {
              lastError = next.error;
              outOfKeys = true;
              break;
            }
            current = next;
            tried.add(`${next.ref.provider}:${next.ref.model}`);
            if (writer) {
              writer.write({ type: "message-metadata", messageMetadata: { model: `${next.ref.model.split("/").pop()} · ${next.ref.provider}`, keyPos: poolPositions.get(next.ref.provider) ?? null } });
            }
            lastError = null;
            finalReason = undefined;
          }

          stopHeartbeat();
          currentAbort = null;
          const succeeded = !userStopped && !lastError && finalReason !== undefined;
          const truncated = finalReason === "length";
          const fileCount = progressModel.files.size;
          const counts = `${stepNo} step${stepNo === 1 ? "" : "s"}, ${fileCount} file${fileCount === 1 ? "" : "s"} changed`;
          const isPaused = pausedAtKey != null || stopNote === "cap" || stopNote === "toggle_off";
          const outcome: "finished" | "incomplete" | "stopped_early" | "out_of_keys" | "failed" | "stopped" | "paused" = userStopped
            ? "stopped"
            : succeeded && !stoppedEarly
              ? incompleteReason ? "incomplete" : "finished"
              : isPaused
                ? "paused"
                : outOfKeys
                  ? "out_of_keys"
                  : succeeded && stoppedEarly
                    ? "stopped_early"
                    : "failed";
          if (outcome === "paused") {
            lastError =
              stopNote === "cap" ? `Run cap of ${runCap?.toLocaleString()} Neurons reached (${Math.round(runUsed).toLocaleString()} used).`
              : stopNote === "toggle_off" ? "The Cloudflare pool was turned off."
              : `Key #${pausedAtKey} paused: ${lastError ?? "error"}. Tap Retry or Approve next key.`;
          }
          const jobStats = {
            outcome, steps_done: stepNo, files_changed: fileCount, rounds, trace_id: trace.traceId,
            pool_run: false, pool_ledger: ledger.length ? ledger : null, paused_at_key: pausedAtKey,
          } as any;
          if (outcome === "finished") {
            const finalText =
              (replyTexts.join("\n\n").trim() || (truncated ? "" : `Finished: ${counts}.`)) +
              (truncated ? "\n\n[[FORGE_CONTINUE]]" : "");
            if (jobId) {
              await supabaseAdmin.from("chat_jobs").update({
                ...jobStats,
                status: "completed",
                progress: truncated ? "Continuing…" : `Finished · ${counts}`,
                assistant_reply: finalText,
                error: null,
                completed_at: new Date().toISOString(),
              }).eq("id", jobId);
            }
            if (!planMode) await supabaseAdmin.from("chat_messages").insert({ project_id: projectId, user_id: userId, role: "assistant", content: finalText });
            await saveProgress({
              status: truncated ? "unfinished" : "finished",
              lastRequest: lastUserText.slice(0, 600),
              lastReply: finalText.slice(-800),
              error: null,
              at: new Date().toISOString(),
            });
          } else {
            const reason =
              outcome === "stopped"
                ? "Stopped by you"
                : outcome === "incomplete"
                  ? `Not finished: ${incompleteReason} · ${counts}. Tap Continue to finish.`
                  : outcome === "stopped_early"
                  ? `Stopped early by the ${stopCause} after ${rounds} round(s) · ${counts}. Tap Continue to finish.`
                  : outcome === "out_of_keys"
                    ? `Out of saved AI keys before the work finished · ${counts}.${lastError ? ` Last error: ${lastError}` : ""}`
                    : lastError || "The AI build stopped";
            const partial = replyTexts.join("\n\n").trim();
            if (jobId) {
              await supabaseAdmin.from("chat_jobs").update({
                ...jobStats,
                status: "failed",
                progress: outcome === "stopped" ? "Stopped" : `${outcome.replace("_", " ")} · ${counts}`,
                assistant_reply: partial || null,
                error: reason,
                completed_at: new Date().toISOString(),
              }).eq("id", jobId).in("status", ["queued", "running"]);
            }
            await saveProgress({
              status: userStopped || outcome === "stopped_early" || outcome === "incomplete" ? "unfinished" : "failed",
              outcome,
              lastRequest: lastUserText.slice(0, 600),
              error: reason.slice(0, 600),
              at: new Date().toISOString(),
            });
            if (!userStopped && writer) writer.write({ type: "error", errorText: reason });
          }
          if (writer) writer.write({ type: "finish" });
          await trace.flush();
        };

        const { keepAlive } = await import("@/lib/wait-until.server");
        const stream = createUIMessageStream({
          originalMessages: body.messages,
          execute: async ({ writer }) => {
            writer.write({
              type: "message-metadata",
              messageMetadata: { model: `${pick.ref.model.split("/").pop()} · ${pick.ref.provider}`, keyPos: poolPositions.get(pick.ref.provider) ?? null },
            });
            // The job is detached from the browser response: a dropped or
            // aborted connection never stops it, and the worker is kept alive
            // until every step and file write has finished.
            const job = runJob(writer as any);
            keepAlive(job);
            await job;
          },
          onError: (error) => errText(error) || "The AI build failed before it could write files.",
        });

        return createUIMessageStreamResponse({
          stream,
          headers: { ...traceHeaders, "x-forge-model-used": `${pick.ref.provider}:${pick.ref.model}`, ...(jobId ? { "x-forge-job-id": jobId } : {}) },
          // Keep the whole job running on the server after the browser disconnects.
          consumeSseStream: ({ stream: s }) => consumeStream({ stream: s }),
        });
      },
    },
  },
});
