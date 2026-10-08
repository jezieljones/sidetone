import { billingEnabled } from "../../../lib/config";
import { fetchMutation } from "convex/nextjs";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { api } from "../../../../convex/_generated/api";
import {
  normalizeStripeStatus,
  stripeClient,
  subscriptionPeriod,
  subscriptionPlan
} from "../../../lib/stripe";

function workerToken() {
  const token = process.env.SIDETONE_WORKER_TOKEN?.trim();
  if (!token) {
    throw new Error("SIDETONE_WORKER_TOKEN is not configured.");
  }
  return token;
}

async function expandedSubscription(stripe: Stripe, id: string) {
  return await stripe.subscriptions.retrieve(id, {
    expand: ["items.data.price"]
  });
}

async function syncSubscription(stripe: Stripe, subscription: Stripe.Subscription, ownerTokenIdentifier?: string) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const plan = subscriptionPlan(subscription);
  if (!plan) {
    return;
  }
  const period = subscriptionPeriod(subscription);
  await fetchMutation(api.billing.syncSubscriptionFromStripe, {
    workerToken: workerToken(),
    ownerTokenIdentifier,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    plan,
    status: normalizeStripeStatus(subscription.status),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    ...period
  });
}

async function handleStripeEvent(event: Stripe.Event) {
  const stripe = stripeClient();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode === "subscription" && typeof session.subscription === "string") {
      const subscription = await expandedSubscription(stripe, session.subscription);
      await syncSubscription(stripe, subscription, session.metadata?.ownerTokenIdentifier ?? undefined);
    }
    return;
  }

  if (
    event.type === "customer.subscription.created"
    || event.type === "customer.subscription.updated"
    || event.type === "customer.subscription.deleted"
  ) {
    await syncSubscription(stripe, event.data.object as Stripe.Subscription);
    return;
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };
    const subscriptionId = typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id;
    if (subscriptionId) {
      const subscription = await expandedSubscription(stripe, subscriptionId);
      await syncSubscription(stripe, subscription);
    }
  }
}

export async function POST(request: Request) {
  if (!billingEnabled()) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET is not configured." }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid Stripe webhook." },
      { status: 400 }
    );
  }

  const recorded = await fetchMutation(api.billing.recordStripeWebhookReceived, {
    workerToken: workerToken(),
    stripeEventId: event.id,
    eventType: event.type
  });
  if (recorded.duplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    await handleStripeEvent(event);
    await fetchMutation(api.billing.markStripeWebhookProcessed, {
      workerToken: workerToken(),
      stripeEventId: event.id,
      status: "processed"
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await fetchMutation(api.billing.markStripeWebhookProcessed, {
      workerToken: workerToken(),
      stripeEventId: event.id,
      status: "failed",
      error: error instanceof Error ? error.message : "Stripe webhook failed."
    }).catch(() => null);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Stripe webhook failed." },
      { status: 500 }
    );
  }
}
