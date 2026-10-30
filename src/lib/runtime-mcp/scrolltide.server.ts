import { auth, createMCPClient, UnauthorizedError, type OAuthClientProvider, type OAuthTokens, type OAuthClientInformation, type OAuthAuthorizationServerInformation } from "@ai-sdk/mcp";
import { encryptSecret, decryptSecret } from "@/lib/secrets-crypto.server";
import { SCROLLTIDE_URL, allowedScrolltideOrigin } from "./scrolltide-policy";
import { mcpFetch } from "./fetch.server";
import { validOAuthReturn } from "./oauth-policy";

type AuthData = { tokens?: OAuthTokens; client?: OAuthClientInformation; verifier?: string; state?: string; server?: OAuthAuthorizationServerInformation; authUrl?: string };
async function db() { return (await import("@/integrations/supabase/client.server")).supabaseAdmin; }
export async function connectionFor(userId: string) {
  const { data, error } = await (await db()).from("runtime_mcp_connections").select("*").eq("user_id", userId).eq("provider", "scrolltide").maybeSingle();
  if (error) throw new Error("Could not load Scrolltide connection.");
  return data;
}
type Connection = NonNullable<Awaited<ReturnType<typeof connectionFor>>>;
async function providerFor(row: Connection) {
  const saved: AuthData = JSON.parse(await decryptSecret(row.encrypted_auth));
  const persist = async () => {
    const { error } = await (await db()).from("runtime_mcp_connections").update({ encrypted_auth: await encryptSecret(JSON.stringify(saved)), updated_at: new Date().toISOString() }).eq("id", row.id).eq("user_id", row.user_id);
    if (error) throw new Error("Could not save Scrolltide authorization.");
  };
  const provider: OAuthClientProvider = {
    redirectUrl: `${row.origin}/api/public/mcp/scrolltide/callback`,
    clientMetadata: { client_name: "Code Haven", client_uri: row.origin, redirect_uris: [`${row.origin}/api/public/mcp/scrolltide/callback`], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" },
    tokens: () => saved.tokens,
    saveTokens: async (tokens) => { saved.tokens = tokens; await persist(); },
    clientInformation: () => saved.client,
    isClientInformationDynamicallyRegistered: () => true,
    saveClientInformation: async (client) => { saved.client = client; await persist(); },
    authorizationServerInformation: () => saved.server,
    saveAuthorizationServerInformation: async (server) => { saved.server = server; await persist(); },
    saveCodeVerifier: async (verifier) => { saved.verifier = verifier; await persist(); },
    codeVerifier: () => { if (!saved.verifier) throw new Error("Authorization expired. Connect again."); return saved.verifier; },
    redirectToAuthorization: async (url) => { if (url.origin !== "https://www.scrolltide.co") throw new Error("Unexpected authorization provider."); saved.authUrl = url.href; await persist(); },
    state: () => saved.state ?? "",
    saveState: async (state) => { saved.state = state; await persist(); },
    storedState: () => saved.state,
    validateAuthorizationServerURL: (_server, issuer) => { if (new URL(issuer).origin !== "https://www.scrolltide.co") throw new Error("Unexpected Scrolltide authorization server."); },
  };
  return { provider, saved };
}
export async function startScrolltide(userId: string, originInput: string) {
  const origin = allowedScrolltideOrigin(originInput);
  const prior = await connectionFor(userId);
  const priorAuth: AuthData = prior ? JSON.parse(await decryptSecret(prior.encrypted_auth)) : {};
  // Explicit Connect/Reconnect starts a fresh state, never deletes saved account credentials on transport failures.
  const state = crypto.randomUUID();
  const { data: row, error } = await (await db()).from("runtime_mcp_connections").upsert({ user_id: userId, provider: "scrolltide", origin, state: "authenticating", oauth_state: state, oauth_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), encrypted_auth: await encryptSecret(JSON.stringify({ ...priorAuth, state })) }, { onConflict: "user_id,provider" }).select("*").single();
  if (error || !row) throw new Error("Could not start Scrolltide connection.");
  const { provider, saved } = await providerFor(row);
  const outcome = await auth(provider, { serverUrl: SCROLLTIDE_URL, scope: "mcp", fetchFn: mcpFetch });
  if (outcome === "AUTHORIZED") { await markReady(row); return { state: "ready", authUrl: null }; }
  if (!saved.authUrl) throw new Error("Scrolltide did not provide a sign-in link.");
  return { state: "authenticating", authUrl: saved.authUrl };
}
async function markReady(row: Connection) {
  const client = await createClient(row);
  try { await client.listTools(); } finally { await client.close(); }
  const { error } = await (await db()).from("runtime_mcp_connections").update({ state: "ready", oauth_state: null, oauth_expires_at: null }).eq("id", row.id);
  if (error) throw new Error("Could not finish saving the connection.");
}
export async function finishScrolltide(state: string, code: string, issuer?: string) {
  if (!/^[0-9a-f-]{36}$/i.test(state) || !code || code.length > 4096) throw new Error("Invalid authorization return.");
  const { data, error } = await (await db()).rpc("claim_scrolltide_oauth", { p_state: state });
  const row = data?.[0];
  if (error || !row) throw new Error("Authorization expired or was already used. Connect again.");
  if (!validOAuthReturn(state, code, row.oauth_expires_at)) throw new Error("Authorization expired.");
  const { data: owner } = await (await db()).auth.admin.getUserById(row.user_id);
  const { isOwner } = await import("@/lib/owner-policy");
  if (!isOwner(owner.user)) throw new Error("Not available");
  const { provider } = await providerFor(row);
  await auth(provider, { serverUrl: SCROLLTIDE_URL, authorizationCode: code, callbackState: state, callbackIssuer: issuer, fetchFn: mcpFetch });
  await markReady(row);
  return allowedScrolltideOrigin(row.origin);
}
async function createClient(row: Connection) {
  const fresh = await connectionFor(row.user_id);
  if (!fresh) throw new Error("Scrolltide connection is no longer available.");
  const { provider } = await providerFor(fresh);
  return createMCPClient({ transport: { type: "http", url: SCROLLTIDE_URL, authProvider: provider, redirect: "error", fetch: mcpFetch } });
}
export async function withScrolltide<T>(userId: string, work: (client: Awaited<ReturnType<typeof createClient>>) => Promise<T>) {
  const row = await connectionFor(userId);
  if (!row || row.state !== "ready") throw new Error("Connect Scrolltide in Admin → Integrations & API keys first.");
  let client: Awaited<ReturnType<typeof createClient>> | undefined;
  try { client = await createClient(row); return await work(client); }
  catch (error) {
    if (error instanceof UnauthorizedError) {
      await (await db()).from("runtime_mcp_connections").update({ state: "authenticating" }).eq("id", row.id);
      throw new Error("Scrolltide needs your sign-in approval again. Reconnect in Admin.");
    }
    // Never echo upstream responses: they can include authorization material.
    throw new Error("Scrolltide could not complete this request. Check your connection or plan and try again.");
  } finally { if (client) await client.close(); }
}
export async function disconnectScrolltide(userId: string) {
  const { error } = await (await db()).from("runtime_mcp_connections").delete().eq("user_id", userId).eq("provider", "scrolltide");
  if (error) throw new Error("Could not disconnect Scrolltide.");
}