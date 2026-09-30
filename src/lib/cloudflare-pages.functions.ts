// Deploy a project's files to Cloudflare Pages via the Direct Upload API,
// using the admin-saved Cloudflare Pages Account ID + API token.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CF = "https://api.cloudflare.com/client/v4";

function mime(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return (
    {
      html: "text/html", css: "text/css", js: "application/javascript", mjs: "application/javascript",
      json: "application/json", svg: "image/svg+xml", txt: "text/plain", xml: "application/xml",
      webmanifest: "application/manifest+json", ico: "image/x-icon", map: "application/json",
    } as Record<string, string>
  )[ext] ?? "application/octet-stream";
}

async function hash32(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function b64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function cfJson(res: Response, step: string) {
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    const msg = json?.errors?.[0]?.message || res.statusText || "failed";
    throw new Error(`Cloudflare ${step} failed (${res.status}): ${msg}`);
  }
  return json;
}

export const deployToCloudflarePages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getIntegrationKey } = await import("./integration-keys.server");

    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("id,name,user_id,cloudflare_pages_project" as any)
      .eq("id", data.projectId)
      .maybeSingle();
    const p = project as any;
    if (!p || p.user_id !== context.userId) throw new Error("Project not found");

    const accountId = (await getIntegrationKey("cloudflare_pages", "accountId"))?.trim();
    const token = (await getIntegrationKey("cloudflare_pages", "apiToken"))?.trim().replace(/^Bearer\s+/i, "");
    if (!accountId || !token)
      throw new Error("Cloudflare Pages isn't set up yet. Add it in Admin → Integrations.");
    const auth = { Authorization: `Bearer ${token}` };

    // Prefer built output; fall back to the source files.
    const { data: rows } = await supabaseAdmin
      .from("files")
      .select("path,content,kind" as any)
      .eq("project_id", data.projectId);
    const all = (rows ?? []) as any[];
    const built = all.filter((f) => f.kind === "build");
    const files = (built.length ? built : all.filter((f) => f.kind !== "build")).filter(
      (f) => typeof f.content === "string" && f.path,
    );
    if (!files.some((f) => f.path.replace(/^\/+/, "") === "index.html"))
      throw new Error("This project has no index.html to put online yet.");

    // Ensure the Pages project exists.
    let name: string = p.cloudflare_pages_project;
    if (!name) {
      const base = (p.name ?? "site").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "site";
      name = `${base}-${p.id.slice(0, 6)}`;
    }
    const exists = await fetch(`${CF}/accounts/${accountId}/pages/projects/${name}`, { headers: auth });
    if (exists.status === 404) {
      await cfJson(
        await fetch(`${CF}/accounts/${accountId}/pages/projects`, {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({ name, production_branch: "main" }),
        }),
        "project create",
      );
    } else await cfJson(exists, "project lookup");

    // Upload assets.
    const jwt = (await cfJson(
      await fetch(`${CF}/accounts/${accountId}/pages/projects/${name}/upload-token`, { headers: auth }),
      "upload token",
    )).result.jwt as string;

    const manifest: Record<string, string> = {};
    const payload: any[] = [];
    for (const f of files) {
      const path = "/" + f.path.replace(/^\/+/, "");
      const value = b64(f.content);
      const key = await hash32(value + path.split(".").pop());
      manifest[path] = key;
      payload.push({ key, value, metadata: { contentType: mime(path) }, base64: true });
    }
    const jwtAuth = { Authorization: `Bearer ${jwt}`, "content-type": "application/json" };
    for (let i = 0; i < payload.length; i += 50) {
      await cfJson(
        await fetch(`${CF}/pages/assets/upload`, { method: "POST", headers: jwtAuth, body: JSON.stringify(payload.slice(i, i + 50)) }),
        "file upload",
      );
    }
    await cfJson(
      await fetch(`${CF}/pages/assets/upsert-hashes`, {
        method: "POST",
        headers: jwtAuth,
        body: JSON.stringify({ hashes: payload.map((x) => x.key) }),
      }),
      "file confirm",
    );

    const form = new FormData();
    form.append("manifest", JSON.stringify(manifest));
    form.append("branch", "main");
    const dep = await cfJson(
      await fetch(`${CF}/accounts/${accountId}/pages/projects/${name}/deployments`, { method: "POST", headers: auth, body: form }),
      "deployment",
    );

    const url = `https://${name}.pages.dev`;
    await supabaseAdmin
      .from("projects")
      .update({ cloudflare_pages_url: url, cloudflare_pages_project: name } as any)
      .eq("id", data.projectId);
    return { url, deploymentUrl: (dep.result?.url as string) ?? url, files: files.length };
  });
