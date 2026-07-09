import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyBilling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getBalance, ensureWelcomeGrant } = await import("./credits.server");
    await ensureWelcomeGrant(userId);
    const balance = await getBalance(userId);
    const [{ data: ledger }, { data: sub }, { data: plans }] = await Promise.all([
      supabase.from("credit_ledger").select("id,delta,reason,ref,created_at").order("created_at", { ascending: false }).limit(30),
      supabaseAdmin.from("subscriptions").select("status,current_period_end,plan_id,stripe_customer_id,plans:plan_id(slug,name,monthly_credits,price_cents)").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("plans").select("id,slug,name,price_cents,monthly_credits,stripe_price_id").eq("active", true).order("price_cents"),
    ]);
    return { balance, ledger: ledger ?? [], subscription: sub ?? null, plans: plans ?? [] };
  });

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { planSlug: string }) => z.object({ planSlug: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) throw new Error("Stripe is not configured. Ask an admin to add STRIPE_SECRET_KEY.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: plan } = await supabaseAdmin
      .from("plans")
      .select("id,stripe_price_id,name,slug")
      .eq("slug", data.planSlug)
      .maybeSingle();
    if (!plan) throw new Error("Plan not found");
    if (!plan.stripe_price_id) throw new Error(`Plan "${plan.name}" is missing a Stripe price ID. Set it in the plans table.`);

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" as never });
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    const origin = req?.headers.get("origin") ?? new URL(req?.url ?? "http://localhost").origin;

    const { data: existing } = await supabaseAdmin.from("subscriptions").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
    let customerId = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: (claims.email as string | undefined) ?? undefined,
        metadata: { user_id: userId },
      });
      customerId = customer.id;
      await supabaseAdmin.from("subscriptions").upsert({
        user_id: userId,
        stripe_customer_id: customerId,
        status: "inactive",
      }, { onConflict: "user_id" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: `${origin}/account/billing?success=1`,
      cancel_url: `${origin}/account/billing?canceled=1`,
      metadata: { user_id: userId, plan_id: plan.id, plan_slug: plan.slug },
      subscription_data: { metadata: { user_id: userId, plan_id: plan.id, plan_slug: plan.slug } },
    });
    return { url: session.url };
  });

export const createBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) throw new Error("Stripe is not configured.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sub } = await supabaseAdmin.from("subscriptions").select("stripe_customer_id").eq("user_id", context.userId).maybeSingle();
    if (!sub?.stripe_customer_id) throw new Error("No Stripe customer yet. Upgrade first.");
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" as never });
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    const origin = req?.headers.get("origin") ?? new URL(req?.url ?? "http://localhost").origin;
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${origin}/account/billing`,
    });
    return { url: portal.url };
  });