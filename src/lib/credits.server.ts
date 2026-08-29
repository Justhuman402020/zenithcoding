import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const DEFAULT_MESSAGE_COST = 1;

export async function getBalance(userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("get_credit_balance", { _user: userId });
  if (error) {
    console.error("[credits] balance error", error);
    return 0;
  }
  return typeof data === "number" ? data : Number(data ?? 0);
}

export async function debit(userId: string, amount: number, ref?: string) {
  const balance = await getBalance(userId);
  if (balance < amount) return { ok: false as const, balance };
  const { error } = await supabaseAdmin.from("credit_ledger").insert({
    user_id: userId,
    delta: -Math.abs(amount),
    reason: "debit",
    ref: ref ?? null,
  });
  if (error) {
    console.error("[credits] debit error", error);
    return { ok: false as const, balance };
  }
  return { ok: true as const, balance: balance - amount };
}

export async function grant(userId: string, amount: number, reason: string, ref?: string) {
  const { error } = await supabaseAdmin.from("credit_ledger").insert({
    user_id: userId,
    delta: Math.abs(amount),
    reason,
    ref: ref ?? null,
  });
  if (error) console.error("[credits] grant error", error);
}

export async function ensureWelcomeGrant(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("credit_ledger")
    .select("id")
    .eq("user_id", userId)
    .eq("reason", "welcome")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[credits] welcome check error", error);
    return;
  }
  if (data) return;
  await grant(userId, 30, "welcome");
}
/** Admins (Samsung admin) never run out of credits — their builds must not stall. */
export async function hasUnlimitedCredits(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) return false;
  return !!data;
}
