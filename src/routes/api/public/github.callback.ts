import { createFileRoute } from "@tanstack/react-router";
import { getCanonicalCallbackUrl } from "@/lib/github-shared";

function decodeReturnOrigin(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const decoded = atob(b64 + pad);
    const u = new URL(decoded);
    return u.origin;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/github/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const stateRaw = url.searchParams.get("state");
        if (!code || !stateRaw) return html("<h1>Missing code/state</h1>", 400);

        // state = "<dbState>.<base64url(returnOrigin)>" (return-origin optional
        // for backwards compatibility with older flows).
        const dotIdx = stateRaw.indexOf(".");
        const state = dotIdx === -1 ? stateRaw : stateRaw.slice(0, dotIdx);
        const returnOrigin =
          dotIdx === -1 ? url.origin : decodeReturnOrigin(stateRaw.slice(dotIdx + 1)) || url.origin;

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
            redirect_uri: getCanonicalCallbackUrl(),
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

        const backHref = `${returnOrigin}/?github=connected`;
        return html(`<!doctype html><meta charset="utf-8"><title>Connected</title>
<body style="font-family:system-ui;background:#0f0c1a;color:#e8e3f5;display:grid;place-items:center;min-height:100vh;margin:0">
  <div style="text-align:center">
    <h1>✓ GitHub connected${me.login ? ` as ${escape(me.login)}` : ""}</h1>
    <p>You can close this tab and return to Forge.</p>
    <p style="margin-top:16px"><a href="${escape(backHref)}" style="color:#d4af37">← Back to Forge</a></p>
  </div>
  <script>
    var BACK = ${JSON.stringify(backHref)};
    // Notify the original tab through every channel available so mobile (where
    // window.opener is often null) still picks up the connection.
    try { window.opener && window.opener.postMessage({ type: "github-connected" }, "*"); } catch(e){}
    try { localStorage.setItem("forge-github-connected", String(Date.now())); } catch(e){}
    try { new BroadcastChannel("forge-github").postMessage({ type: "github-connected" }); } catch(e){}
    // If we were opened as a popup, close. Otherwise (mobile new-tab),
    // bounce back to the original origin so the user lands on the connected UI.
    setTimeout(function(){
      var opened = false;
      try { window.close(); opened = true; } catch(e){}
      if (!opened || !window.closed) { window.location.href = BACK; }
    }, 1200);
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