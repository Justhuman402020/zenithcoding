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
import { buildSystemPrompt, createPrepareStep, detectFileChangeIntent } from "@/lib/chat-agent.server";

import { buildGroqModelChain, modelSupportsVision } from "@/lib/ai-models";

export { createGroqProvider };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ModelPick = { model: string } | { error: string; status: number };

/**
 * Probes Groq with a tiny request so we can pick a model that is actually
 * available right now. On a 429 we wait out Retry-After once, then fall
 * through to the next model in the chain instead of failing the build.
 */
async function pickAvailableGroqModel(apiKey: string, chain: string[]): Promise<ModelPick> {
  let lastRateLimited: string | null = null;
  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      });
      if (res.ok) return { model };
      if (res.status === 429) {
        lastRateLimited = model;
        const retryAfter = Number(res.headers.get("retry-after") ?? "0");
        if (attempt === 0 && retryAfter > 0 && retryAfter <= 8) {
          await sleep(retryAfter * 1000);
          continue;
        }
        break; // try the next model in the chain
      }
      if (res.status === 401 || res.status === 403) {
        return { error: "The Groq API key is invalid or expired. Add a fresh key in settings.", status: 401 };
      }
      break; // model unavailable for this key — try the next one
    }
  }
  if (lastRateLimited) {
    return {
      error:
        "Every Groq model is rate limited right now (429). Your free-tier limit resets shortly — wait about a minute and send the message again.",
      status: 429,
    };
  }
  return { error: "No Groq model is available for this API key right now.", status: 502 };
}

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

        const groqKey = process.env.GROQ_API_KEY;
        if (!groqKey) return new Response("Missing GROQ_API_KEY", { status: 500 });

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

        // Does this turn carry images (screenshots, mockups, video frames)?
        const hasImages = body.messages.some((message) =>
          (message.parts ?? []).some(
            (part: any) =>
              (part?.type === "file" || part?.type === "image") &&
              typeof part?.mediaType === "string" &&
              part.mediaType.startsWith("image/"),
          ),
        );

        const requestedModel = request.headers.get("x-groq-model");
        const pick = await trace.time("model.pick", () =>
          pickAvailableGroqModel(groqKey, buildGroqModelChain(requestedModel, { vision: hasImages })),
        );
        if ("error" in pick) {
          trace.log("model.unavailable", { status: "error", message: pick.error });
          return fail(
            pick.status,
            JSON.stringify({ error: "model_unavailable", message: pick.error }),
            "application/json",
          );
        }
        trace.log("model.selected", { detail: { model: pick.model, hasImages } });

        const groq = createGroqProvider(groqKey);
        const model = groq(pick.model);
        const store = createSupabaseFileStore(supabase, projectId, userId);
        const tools = createProjectFileTools(store, trace);

        // A text-only model would 400 on image parts — drop them rather than fail.
        const visionOk = modelSupportsVision(pick.model);
        const outgoingMessages = visionOk
          ? body.messages
          : body.messages.map((message) => ({
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
