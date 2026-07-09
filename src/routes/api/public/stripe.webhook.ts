import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const stripeKey = process.env.STRIPE_SECRET_KEY;
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!stripeKey || !webhookSecret) return new Response("Stripe not configured", { status: 500 });
        const signature = request.headers.get("stripe-signature");
        if (!signature) return new Response("missing signature", { status: 400 });
        const body = await request.text();

        const { default: Stripe } = await import("stripe");
        const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" as never });
        let event: import("stripe").Stripe.Event;
        try {
          event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
        } catch (err) {
          console.error("[stripe] signature check failed", err);
          return new Response("bad signature", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        async function grantForSubscription(subId: string) {
          const sub = await stripe.subscriptions.retrieve(subId);
          const userId = (sub.metadata?.user_id as string | undefined) ?? null;
          const planSlug = (sub.metadata?.plan_slug as string | undefined) ?? null;
          if (!userId || !planSlug) return;
          const { data: plan } = await supabaseAdmin.from("plans").select("id,monthly_credits").eq("slug", planSlug).maybeSingle();
          if (!plan) return;
          await supabaseAdmin.from("subscriptions").upsert({
            user_id: userId,
            plan_id: plan.id,
            stripe_customer_id: sub.customer as string,
            stripe_subscription_id: sub.id,
            status: sub.status,
            current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id" });
          if (plan.monthly_credits > 0 && (sub.status === "active" || sub.status === "trialing")) {
            await supabaseAdmin.from("credit_ledger").insert({
              user_id: userId,
              delta: plan.monthly_credits,
              reason: "subscription_grant",
              ref: `sub:${sub.id}:${sub.current_period_end}`,
            });
          }
        }

        try {
          switch (event.type) {
            case "checkout.session.completed": {
              const session = event.data.object as import("stripe").Stripe.Checkout.Session;
              if (session.subscription) await grantForSubscription(session.subscription as string);
              break;
            }
            case "invoice.paid": {
              const inv = event.data.object as import("stripe").Stripe.Invoice;
              if (inv.subscription) await grantForSubscription(inv.subscription as string);
              break;
            }
            case "customer.subscription.updated":
            case "customer.subscription.created": {
              const sub = event.data.object as import("stripe").Stripe.Subscription;
              await grantForSubscription(sub.id);
              break;
            }
            case "customer.subscription.deleted": {
              const sub = event.data.object as import("stripe").Stripe.Subscription;
              const userId = (sub.metadata?.user_id as string | undefined) ?? null;
              if (userId) {
                await supabaseAdmin.from("subscriptions").update({
                  status: "canceled",
                  updated_at: new Date().toISOString(),
                }).eq("user_id", userId);
              }
              break;
            }
          }
        } catch (err) {
          console.error("[stripe] handler error", err);
          return new Response("handler failed", { status: 500 });
        }
        return new Response("ok");
      },
    },
  },
});