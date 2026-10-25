import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { isOwner } from "./owner-policy";

// Managed authentication still rejects missing tokens on protected functions.
// Revalidate any supplied session before any app function can run.
export const ownerFunctionMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const header = getRequest().headers.get("authorization");
  if (header) {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) throw new Error("Sign-in unavailable");
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(header.replace(/^Bearer\s+/i, ""));
    if (error || !isOwner(data.user)) throw new Error("Not available");
  }
  return next();
});