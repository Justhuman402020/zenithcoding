import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/github/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return html("<h1>Missing code/state</h1>", 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: row, error } = await supabaseAdmin
          .from("github_oauth_states" as any)
          .select("user_id, expires_at")
          .eq("state", state)
          .maybeSingle();
        if (error || !row) return html("<h1>Invalid state</h1>", 400);
        if (new Date((row as any).expires_at).getTime() < Date.now())
          return html("<h1>State expired — try again</h1>", 400);

        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
            client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
            code,
            redirect_uri: `${url.origin}/api/public/github/callback`,
          }),
        });
        const tok = (await tokenRes.json()) as any;
        if (!tok.access_token) return html(`<h1>OAuth failed</h1><pre>${escape(JSON.stringify(tok))}</pre>`, 400);

        const me = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/vnd.github+json" },
        }).then((r) => r.json() as any).catch(() => ({}));

        await supabaseAdmin
          .from("github_tokens" as any)
          .upsert({
            user_id: (row as any).user_id,
            access_token: tok.access_token,
            github_login: me.login ?? null,
            scope: tok.scope ?? null,
            updated_at: new Date().toISOString(),
          });

        await supabaseAdmin.from("github_oauth_states" as any).delete().eq("state", state);

        return html(`<!doctype html><meta charset="utf-8"><title>Connected</title>
<body style="font-family:system-ui;background:#0f0c1a;color:#e8e3f5;display:grid;place-items:center;min-height:100vh;margin:0">
  <div style="text-align:center">
    <h1>✓ GitHub connected${me.login ? ` as ${escape(me.login)}` : ""}</h1>
    <p>You can close this tab.</p>
  </div>
  <script>
    try { window.opener && window.opener.postMessage({ type: "github-connected" }, "*"); } catch(e){}
    setTimeout(()=>{ try { window.close(); } catch(e){} window.location.href = "/"; }, 800);
  </script>
</body>`);
      },
    },
  },
});

function html(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}