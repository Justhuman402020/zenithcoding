import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { debit, ensureWelcomeGrant } from "@/lib/credits.server";
import { createTrace } from "@/lib/trace.server";
import {
  createGroqProvider,
  createProjectFileTools,
  createSupabaseFileStore,
} from "@/lib/chat-tools.server";
import {
  buildSystemPrompt,
  compactChatMessages,
  createPrepareStep,
  detectFileChangeIntent,
} from "@/lib/chat-agent.server";

import { buildModelChain, modelSupportsVision, parseModelKey, type ModelRef } from "@/lib/ai-providers";
import {
  loadProviderKeys,
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

        // Ensure the user has a welcome balance, then debit one credit per message.
        await ensureWelcomeGrant(userId);
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

        // confirm project belongs to user
        const { data: proj } = await supabase
          .from("projects")
          .select("id,name")
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
        const needsFileChange = detectFileChangeIntent(lastUserText);
        trace.log("request.parsed", {
          detail: { messages: body.messages.length, needsFileChange, prompt: lastUserText },
        });

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
            (part: any) =>
              (part?.type === "file" || part?.type === "image") &&
              typeof part?.mediaType === "string" &&
              part.mediaType.startsWith("image/"),
          ),
        );

        const requestedRef = parseModelKey(request.headers.get("x-forge-model"));
        const { ref: adminRef, autoFallback } = await readActiveModelRef();
        const preferred: ModelRef | null = requestedRef ?? adminRef;
        const availableProviders = Object.keys(providerKeys);
        const fullChain = buildModelChain(preferred, { vision: hasImages, availableProviders });
        const chain = autoFallback ? fullChain : fullChain.slice(0, 1);

        const pick = await trace.time("model.pick", () => pickAvailableModel(chain, providerKeys));
        if (!pick.ok) {
          trace.log("model.unavailable", { status: "error", message: pick.error });
          return fail(
            pick.status,
            JSON.stringify({ error: "model_unavailable", message: pick.error }),
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
        const tools = createProjectFileTools(store, trace);

        // A text-only model would 400 on image parts — drop them rather than fail.
        const visionOk = modelSupportsVision(pick.ref);
        const outgoingMessages = visionOk
          ? compactMessages
          : compactMessages.map((message) => ({
              ...message,
              parts: (message.parts ?? []).filter(
                (part: any) => !(typeof part?.mediaType === "string" && part.mediaType.startsWith("image/")),
              ),
            }));

        const result = streamText({
          model,
          system: buildSystemPrompt(proj.name),
          messages: await convertToModelMessages(outgoingMessages as UIMessage[]),

          tools,
          prepareStep: createPrepareStep(needsFileChange, trace),
          stopWhen: stepCountIs(50),
          onFinish: async ({ finishReason, usage, text }) => {
            trace.log("stream.finish", {
              status: needsFileChange ? "ok" : "ok",
              detail: {
                finishReason,
                inputTokens: usage?.inputTokens ?? null,
                outputTokens: usage?.outputTokens ?? null,
                replyChars: text?.length ?? 0,
              },
            });
            await trace.flush();
          },
          onError: async ({ error }) => {
            await recordModelStatus(
              pick.ref,
              "unavailable",
              null,
              error instanceof Error ? error.message : String(error),
            );
            trace.log("stream.error", {
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            });
            await trace.flush();
          },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: body.messages,
          sendReasoning: true,
          headers: traceHeaders,
          onError: (error) => {
            const message = error instanceof Error ? error.message : String(error ?? "");
            if (/request too large|tokens per minute|TPM/i.test(message)) {
              return "This request was too large for Groq's free limit. Forge shortened the chat context; please send the instruction once more.";
            }
            if (/429|rate.?limit|too many requests/i.test(message)) {
              return "Groq hit its rate limit mid-build. Wait about a minute and send the message again — Forge will automatically try the next model.";
            }
            return message || "The AI build failed before it could write files.";
          },
        });
      },
    },
  },
});
