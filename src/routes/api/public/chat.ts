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

export const Route = createFileRoute("/api/public/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "");
        const projectId = request.headers.get("x-project-id");
        console.log("[chat] POST", { hasToken: !!token, projectId });
        if (!token) return new Response("Unauthorized: missing token", { status: 401 });
        if (!projectId) return new Response("Missing project", { status: 400 });

        const { providers: providerRegistry, keys: providerKeys } = await loadProviderRegistry();
        if (Object.keys(providerKeys).length === 0) {
          return new Response("No AI provider API key is configured", { status: 500 });
        }


        const supabaseUrl = process.env.SUPABASE_URL!;
        const supabasePublishable = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const supabase = createClient(supabaseUrl, supabasePublishable, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
        if (userErr || !userRes.user) {
          console.log("[chat] getUser failed", userErr?.message);
          return new Response(`Unauthorized: ${userErr?.message ?? "no user"}`, { status: 401 });
        }
        const userId = userRes.user.id;

        const trace = createTrace({ projectId, userId });
        const traceHeaders = { "x-forge-trace-id": trace.traceId };
        const fail = async (status: number, body: string, contentType = "text/plain") => {
          await trace.flush();
          return new Response(body, { status, headers: { "Content-Type": contentType, ...traceHeaders } });
        };
        trace.log("request.authenticated", { detail: { projectId } });


        // confirm project belongs to user
        const { data: proj } = await supabase
          .from("projects")
          .select("id,name,description")
          .eq("id", projectId)
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
        const needsFileChange = planMode ? false : detectFileChangeIntent(lastUserText);
        const requestKey = request.headers.get("x-forge-request-key") || crypto.randomUUID();
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
        await ensureWelcomeGrant(userId);
        const unlimited = await hasUnlimitedCredits(userId);
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
        await supabaseAdmin
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
          .lt("updated_at", new Date(Date.now() - 180_000).toISOString());

        const { data: existingJob } = await supabase
          .from("chat_jobs")
          .select("id,status,assistant_reply,error")
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

        // Snapshot current files BEFORE the AI mutates anything, so the user
        // can one-click revert to this stable version if the build fails.
        if (needsFileChange) {
          await trace.time("snapshot.create", async () => {
            const { data: currentFiles } = await supabase
              .from("files")
              .select("path,content")
              .eq("project_id", projectId);
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
        const fullChain = buildModelChain(preferred, { vision: hasImages, availableProviders });
        // Providers the admin added by pasting a key join the backup chain too.
        const { isCloudflareBaseUrl } = await import("@/lib/cloudflare-pool.server");
        // Cloudflare keys only ever run Qwen 3.8 27B through the pool below.
        const extraProviders = providerRegistry.filter((p) => p.id.startsWith("custom-") && providerKeys[p.id] && !isCloudflareBaseUrl(p.baseURL));
        if (extraProviders.length) {
          const { listProviderModels } = await import("@/lib/model-discovery.server");
          for (const provider of extraProviders) {
            const models = await listProviderModels(provider.id, providerKeys[provider.id]!, provider);
            for (const model of models.filter((m) => m.tools && (!hasImages || m.vision)).slice(0, 3)) {
              if (!fullChain.some((r) => r.provider === provider.id && r.model === model.id)) {
                fullChain.push({ provider: provider.id, model: model.id });
              }
            }
          }
        }
        // The editor's Auto-switch toggle: off means use only the chosen model.
        const editorAuto = request.headers.get("x-forge-auto") !== "off";
        // Models that just stopped mid-work go to the back so a retry lands on a different one.
        let orderedChain = fullChain;
        if (editorAuto && fullChain.length > 1) {
          try {
            const since = new Date(Date.now() - 5 * 60_000).toISOString();
            const { data: recentFails } = await supabaseAdmin
              .from("ai_model_status")
              .select("provider, model")
              .in("last_status", ["unavailable", "rate_limited"])
              .gte("updated_at", since);
            const bad = new Set((recentFails ?? []).map((r: any) => `${r.provider}:${r.model}`));
            orderedChain = [
              ...fullChain.filter((r) => !bad.has(`${r.provider}:${r.model}`)),
              ...fullChain.filter((r) => bad.has(`${r.provider}:${r.model}`)),
            ];
          } catch {
            /* ordering is best effort */
          }
        }
        let chain = autoFallback && editorAuto ? orderedChain : fullChain.slice(0, 1);
        // Cloudflare key pool leads automatic coding (Qwen), key #1 → #2 → … #21,
        // unless the user picked a model by hand in the editor. With Auto off the
        // manually picked model is used exactly as chosen — never rerouted to Qwen.
        if (editorAuto) {
          const { loadCloudflarePool, readCloudflareCodingModel } = await import("@/lib/cloudflare-pool.server");
          const pool = (await loadCloudflarePool()).filter((k) => k.status !== "exhausted" && providerKeys[k.id]);
          if (pool.length) {
            const codingModel = await readCloudflareCodingModel();
            const poolRefs = pool.map((k) => ({ provider: k.id, model: codingModel }));
            const poolIds = new Set(pool.map((k) => k.id));
            const rest = chain.filter((r) => !poolIds.has(r.provider));
            if (requestedRef && !poolIds.has(requestedRef.provider)) {
              // Manual pick stays first; if it stops, the pool (key #1 → #21) takes over.
              chain = autoFallback ? [rest[0] ?? requestedRef, ...poolRefs, ...rest.slice(1)] : [rest[0] ?? requestedRef];
            } else {
              chain = autoFallback ? [...poolRefs, ...rest] : poolRefs;
            }
          }
        } else if (requestedRef) {
          // Auto off + a manual pick: lock to that one model, no Qwen, no fallback.
          chain = [requestedRef];
        }


        const { readAiGatewaySetting } = await import("@/lib/model-router.server");
        const gateway = await readAiGatewaySetting();
        let visualBrief = "";
        if (hasImages) {
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
          const visualPlan = await planAttachedImages({
            messages: compactMessages,
            providers: providerRegistry,
            keys: providerKeys,
            preferred: visionPreference,
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
          const locked = !editorAuto && !!requestedRef;
          const message = locked
            ? `The model you picked (${requestedRef!.model}) can't answer right now.${reason} Pick a different model, or turn Auto-switch on to let Forge choose one.`
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
          filePaths: (briefFiles ?? []).map((file) => file.path),
          userNotes: `${brainRow?.content ?? ""}${visualBrief ? `\n\nLatest visual brief:\n${visualBrief}` : ""}`,
        };
        trace.log("project.brief", {
          detail: { files: projectBrief.filePaths.length, hasGoal: Boolean(projectBrief.originalGoal) },
        });

        // A text-only model would 400 on image parts — drop them rather than fail.
        const visionOk = modelSupportsVision(pick.ref);
        // GitHub Models' free tier only accepts ~8k input / 4k output tokens per
        // request, so send a much shorter history there or it silently rejects.
        const isGitHubModels = /models\.github\.ai/i.test(pick.baseURL);
        const turnMessages = isGitHubModels ? compactChatMessages(body.messages, 3) : compactMessages;
        const strippedMessages = visionOk && !visualBrief
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
        const MAX_ATTEMPTS = 8;
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
        // Website cloner: compact blueprint of a linked site.
        const { detectCloneUrl, buildSiteBlueprint } = await import("@/lib/site-cloner.server");
        const cloneUrl = detectCloneUrl(lastUserText);
        const blueprint = cloneUrl ? await buildSiteBlueprint(cloneUrl) : null;
        if (cloneUrl) trace.log("clone.blueprint", { detail: { url: cloneUrl, ok: Boolean(blueprint) } });
        const cloneContext = blueprint
          ? `\n\n## Design blueprint of the site to replicate\n${blueprint}\nBuild a responsive page matching this layout, colors, navigation and text. Write original code; use the listed image URLs where fitting.`
          : cloneUrl
            ? `\n\nThe user linked ${cloneUrl} to replicate, but it could not be fetched. Build your best matching page and say in one line that the site couldn't be read.`
            : "";
        const visualContext = visualBrief ? `\n\n## Visual planner brief\n${visualBrief}\nThis brief was created by the image reader. You are the coding boss: use it as the source of truth and edit the files now. Do not spend tokens re-describing the image.` : "";
        const { vaultPromptSection } = await import("@/lib/admin-vault.server");
        const adminVaultContext = await vaultPromptSection();
        const systemPrompt =
          (planMode ? buildPlanSystemPrompt(proj.name, projectBrief) : buildSystemPrompt(proj.name, projectBrief)) +
          sharedContext + assetContext + cloneContext + visualContext + adminVaultContext;
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
        const runJob = async (rawWriter?: { merge: (s: ReadableStream<any>) => void; write: (c: any) => void }) => {
          const writer = safeWriter(rawWriter);
          let finalReason: string | undefined;
          let lastError: string | null = null;

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
            if (cfPool) {
              const { data: u } = await supabaseAdmin
                .from("cloudflare_neuron_usage" as any)
                .select("neurons_used")
                .eq("provider_id", current.ref.provider)
                .eq("day", cfPool.utcDay())
                .maybeSingle();
              baseNeurons = Number((u as any)?.neurons_used ?? 0);
            }
            let failure: string | null = null;
            let finished = false;
            let attemptSteps: any[] = [];
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
              messages: [...baseMessages, ...carried],
              tools,
              abortSignal: attemptAbort.signal,
              onChunk: () => kick(),
              onStepFinish: (step: any) => {
                kick();
                stepNo += 1;
                attemptSteps = step?.response?.messages ?? attemptSteps;
                if (step?.text?.trim()) replyTexts.push(step.text.trim());
                let last = "";
                for (const c of (step?.toolCalls ?? []) as any[]) {
                  const path = c?.input?.path ?? c?.args?.path;
                  if (typeof path === "string") progressModel.files.add(path);
                  const name = String(c?.toolName ?? "tool");
                  last = `${name.replace(/_/g, " ")}${typeof path === "string" ? ` ${path}` : ""}`;
                  recentCalls.push(`${name}:${JSON.stringify(c?.input ?? c?.args ?? {}).slice(0, 400)}`);
                }
                if (cfPool) {
                  attemptNeurons += cfPool.estimateNeurons(step?.usage?.inputTokens, step?.usage?.outputTokens);
                  // 9k soft cap: let this step finish cleanly, then stop and route
                  // the very next step to the next key (1,000 Neuron reserve kept).
                  if (autoFallback && editorAuto && baseNeurons + attemptNeurons >= cfPool.SOFT_CAP_NEURONS) {
                    handoff = true;
                  }
                  writer?.write({
                    type: "message-metadata",
                    messageMetadata: { neurons: { key: current.ref.provider, start: Math.round(baseNeurons), used: Math.round(attemptNeurons), cap: cfPool.SOFT_CAP_NEURONS } },
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
                return {
                  system: `${systemPrompt}\n\n## Neuron budget (this key)\nStarted at ${Math.round(baseNeurons)}, used this turn ${Math.round(attemptNeurons)}, now ${total} of the 9,000 soft cap (${Math.max(0, 9000 - total)} left). Finish each step completely; if close to 9,000, end the current step cleanly so the next key can continue.`,
                };
              },
              stopWhen: [
                stepCountIs(40),
                () => handoff,
                () => {
                  const n = recentCalls.length;
                  return n >= 3 && recentCalls[n - 1] === recentCalls[n - 2] && recentCalls[n - 2] === recentCalls[n - 3];
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
                if (cfPool) await cfPool.addNeurons(current.ref.provider, cfPool.estimateNeurons(usage?.inputTokens, usage?.outputTokens));
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
              writer.merge(result.toUIMessageStream({ sendStart: attempt === 0, sendFinish: false, sendReasoning: true }));
            }
            // Drain the stream on the server no matter what the browser does.
            await result.consumeStream({ onError: (e) => { failure ??= errText(e); } });
            if (watchdog) clearTimeout(watchdog);

            if (handoff && cfPool) {
              // Twin handoff: save usage, reserve the key, pass a compact note to the next key.
              // onFinish already recorded this attempt's Neurons when the step ended cleanly.
              if (!finished) await cfPool.addNeurons(current.ref.provider, attemptNeurons);
              await cfPool.markExhausted(current.ref.provider);
              if (attemptSteps.length) carried = [...carried, ...attemptSteps];
              carried.push({
                role: "user",
                content: `Handoff note (previous key reached its 9,000 Neuron soft cap after a completed step). You are still Forge — same voice, same plan, same task; the user should not notice a switch. Finished: ${stepNo} step(s). Files already written (trust them — do NOT re-read or rewrite): ${[...progressModel.files].slice(-20).join(", ") || "none"}. Last completed action: ${progressText}. Next: do the next remaining step of the original request only.`,
              });
              trace.log("attempt.handoff", { detail: { attempt, provider: current.ref.provider, neurons: baseNeurons + attemptNeurons } });
              failure = null;
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
            if (success && (stepNo > 0 || replyTexts.length)) break;
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
            if (!handoff) await recordModelStatus(current.ref, isCf || /429|rate.?limit/i.test(lastError) ? "rate_limited" : "unavailable", null, lastError);
            if (!handoff && isCf && /429|rate.?limit|quota|neuron|too many requests|daily|exhaust/i.test(lastError)) {
              const { markExhausted } = await import("@/lib/cloudflare-pool.server");
              await markExhausted(current.ref.provider);
            }
            trace.log("attempt.failover", { status: "error", message: lastError, detail: { attempt, provider: current.ref.provider } });

            if (!(autoFallback && editorAuto)) break;
            const remaining = chain.filter((r) => !tried.has(`${r.provider}:${r.model}`));
            if (!remaining.length) break;
            setProgress(`${progressText} · switching to the next key`);
            if (writer) writer.write({ type: "message-metadata", messageMetadata: { model: "switching to the next key…" } });
            const next = await pickAvailableModel(remaining, providerKeys, providerRegistry, gateway);
            if (!next.ok) {
              lastError = next.error;
              break;
            }
            current = next;
            tried.add(`${next.ref.provider}:${next.ref.model}`);
            if (writer) {
              writer.write({ type: "message-metadata", messageMetadata: { model: `${next.ref.model.split("/").pop()} · ${next.ref.provider}` } });
            }
            lastError = null;
            finalReason = undefined;
          }

          stopHeartbeat();
          currentAbort = null;
          const succeeded = !userStopped && !lastError && finalReason !== undefined;
          const truncated = finalReason === "length";
          if (succeeded) {
            const finalText =
              (replyTexts.join("\n\n").trim() || (truncated ? "" : "The build finished and all completed file changes were saved.")) +
              (truncated ? "\n\n[[FORGE_CONTINUE]]" : "");
            if (jobId) {
              await supabaseAdmin.from("chat_jobs").update({
                status: "completed",
                progress: truncated ? "Continuing…" : "Finished",
                assistant_reply: finalText,
                error: null,
                trace_id: trace.traceId,
                completed_at: new Date().toISOString(),
              }).eq("id", jobId);
            }
            await supabaseAdmin.from("chat_messages").insert({ project_id: projectId, user_id: userId, role: "assistant", content: finalText });
            await saveProgress({
              status: truncated ? "unfinished" : "finished",
              lastRequest: lastUserText.slice(0, 600),
              lastReply: finalText.slice(-800),
              error: null,
              at: new Date().toISOString(),
            });
          } else {
            const reason = userStopped ? "Stopped by you" : lastError || "The AI build stopped";
            if (jobId) {
              await supabaseAdmin.from("chat_jobs").update({
                status: "failed",
                progress: userStopped ? "Stopped" : `${progressText} · stopped`,
                error: reason,
                trace_id: trace.traceId,
                completed_at: new Date().toISOString(),
              }).eq("id", jobId).in("status", ["queued", "running"]);
            }
            await saveProgress({
              status: userStopped ? "unfinished" : "failed",
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
              messageMetadata: { model: `${pick.ref.model.split("/").pop()} · ${pick.ref.provider}` },
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
