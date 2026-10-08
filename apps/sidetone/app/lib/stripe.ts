import Stripe from "stripe";
import {
  sidetoneBillingPlans,
  sidetonePlanFromPricingSlug,
  sidetonePricingSlug,
  type SidetoneBillablePlanTier,
  type SidetoneSubscriptionStatus
} from "@sidetone/contracts";

export function stripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  return new Stripe(secretKey);
}

export function appUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim()
    || process.env.SIDETONE_PUBLIC_BASE_URL?.trim()
    || "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function stripePriceIdsForPlan(plan: SidetoneBillablePlanTier) {
  if (plan === "smooth_operator") {
    return {
      basePriceId: process.env.STRIPE_SMOOTH_BASE_PRICE_ID?.trim(),
      overagePriceId: process.env.STRIPE_SMOOTH_OVERAGE_PRICE_ID?.trim()
    };
  }
  if (plan === "premier_pro") {
    return {
      basePriceId: process.env.STRIPE_PREMIER_BASE_PRICE_ID?.trim(),
      overagePriceId: process.env.STRIPE_PREMIER_OVERAGE_PRICE_ID?.trim()
    };
  }
  return { basePriceId: undefined, overagePriceId: undefined };
}

export function planFromCheckoutSlug(slug?: string | null): "smooth_operator" | "premier_pro" | null {
  const plan = sidetonePlanFromPricingSlug(slug);
  return plan === "smooth_operator" || plan === "premier_pro" ? plan : null;
}

export function planFromStripePriceId(priceId?: string | null): "smooth_operator" | "premier_pro" | null {
  if (!priceId) {
    return null;
  }
  if (priceId === process.env.STRIPE_SMOOTH_BASE_PRICE_ID || priceId === process.env.STRIPE_SMOOTH_OVERAGE_PRICE_ID) {
    return "smooth_operator";
  }
  if (priceId === process.env.STRIPE_PREMIER_BASE_PRICE_ID || priceId === process.env.STRIPE_PREMIER_OVERAGE_PRICE_ID) {
    return "premier_pro";
  }
  return null;
}

export function checkoutLineItemsForPlan(plan: "smooth_operator" | "premier_pro") {
  const { basePriceId, overagePriceId } = stripePriceIdsForPlan(plan);
  if (!basePriceId || !overagePriceId) {
    throw new Error(`${sidetoneBillingPlans[plan].label} Stripe prices are not configured.`);
  }
  return [
    { price: basePriceId, quantity: 1 },
    { price: overagePriceId }
  ];
}

export function normalizeStripeStatus(status?: string | null): SidetoneSubscriptionStatus {
  if (
    status === "trialing"
    || status === "active"
    || status === "past_due"
    || status === "canceled"
    || status === "incomplete"
    || status === "incomplete_expired"
    || status === "unpaid"
    || status === "paused"
  ) {
    return status;
  }
  return "free";
}

export function subscriptionPlan(subscription: Stripe.Subscription): "smooth_operator" | "premier_pro" | null {
  const items = subscription.items?.data ?? [];
  for (const item of items) {
    const plan = planFromStripePriceId(item.price?.id);
    if (plan) {
      return plan;
    }
  }
  return null;
}

export function subscriptionPeriod(subscription: Stripe.Subscription) {
  const sub = subscription as Stripe.Subscription & {
    current_period_start?: number;
    current_period_end?: number;
  };
  const firstItem = subscription.items?.data?.[0] as Stripe.SubscriptionItem | undefined;
  const itemWithPeriod = firstItem as Stripe.SubscriptionItem & {
    current_period_start?: number;
    current_period_end?: number;
  };
  const periodStartSeconds = sub.current_period_start ?? itemWithPeriod?.current_period_start ?? Math.floor(Date.now() / 1000);
  const periodEndSeconds = sub.current_period_end ?? itemWithPeriod?.current_period_end ?? periodStartSeconds + 30 * 24 * 60 * 60;

  return {
    currentPeriodStart: periodStartSeconds * 1000,
    currentPeriodEnd: periodEndSeconds * 1000,
    trialStart: subscription.trial_start ? subscription.trial_start * 1000 : undefined,
    trialEnd: subscription.trial_end ? subscription.trial_end * 1000 : undefined
  };
}

export function billingReturnUrl(path = "/subscriptions") {
  return `${appUrl()}${path}`;
}

export function pricingSlugForPlan(plan: "smooth_operator" | "premier_pro") {
  return sidetonePricingSlug(plan);
}
