import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/s/$slug")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!url || !key) return new Response("Server not configured", { status: 500 });

        const supabase = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: project } = await supabase
          .from("projects")
          .select("id,name,slug,published")
          .eq("slug", params.slug)
          .eq("published", true)
          .maybeSingle();

        if (!project) {
          return new Response(notFoundHtml(params.slug), {
            status: 404,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }

        const { data: files } = await supabase
          .from("files")
          .select("path,content")
          .eq("project_id", project.id);

        const map = new Map((files ?? []).map((f) => [f.path, f.content]));
        const indexHtml = map.get("index.html");
        if (!indexHtml) {
          return new Response(emptyHtml(project.name), {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }

        // Inline <link href="..."> CSS and <script src="..."> JS from project files
        let html = indexHtml.replace(
          /<link\s+[^>]*href=["']([^"']+)["'][^>]*>/g,
          (m, href) => {
            const css = map.get(href);
            if (css == null) return m;
            return `<style data-from="${href}">${css}</style>`;
          },
        );
        html = html.replace(
          /<script\s+([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/g,
          (m, pre, src, post) => {
            const js = map.get(src);
            if (js == null) return m;
            const typeAttr = /type=/.test(pre + post) ? "" : ' type="text/javascript"';
            return `<script${typeAttr} data-from="${src}">${js}\n//# sourceURL=${src}</script>`;
          },
        );

        return new Response(html, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=30",
          },
        });
      },
    },
  },
});

function notFoundHtml(slug: string) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Site not found</title><meta name="viewport" content="width=device-width,initial-scale=1"/><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0f0a1a;color:#e7e3f1;display:grid;place-items:center;min-height:100vh;margin:0;padding:2rem;text-align:center}h1{font-size:2rem;margin:0 0 .5rem}p{color:#9c95b3;max-width:32rem}code{background:#1a1525;padding:.15rem .4rem;border-radius:.3rem}</style></head><body><div><h1>Site not found</h1><p>No published site at <code>/s/${escapeHtml(slug)}</code>. The owner may not have published it yet.</p></div></body></html>`;
}

function emptyHtml(name: string) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(name)}</title></head><body style="font-family:system-ui;padding:2rem;color:#666">This site doesn't have an <code>index.html</code> yet.</body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}