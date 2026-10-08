import { isSelfHosted } from "./deployment";
import { v } from "convex/values";
import {
  sidetoneBillingPlans,
  sidetoneTrialDays,
  sidetoneTrialPlan,
  type SidetoneBillablePlanTier,
  type SidetoneSubscriptionStatus
} from "@sidetone/contracts";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireAuthenticatedIdentity, requireOwnedEntity } from "./auth";
import type { Doc, Id } from "./_generated/dataModel";

const billingPlan = v.union(
  v.literal("free"),
  v.literal("smooth_operator"),
  v.literal("premier_pro")
);

const billingSubscriptionStatus = v.union(
  v.literal("free"),
  v.literal("trialing"),
  v.literal("active"),
  v.literal("past_due"),
  v.literal("canceled"),
  v.literal("incomplete"),
  v.literal("incomplete_expired"),
  v.literal("unpaid"),
  v.literal("paused")
);

const stripeMeterStatus = v.union(
  v.literal("not_applicable"),
  v.literal("pending"),
  v.literal("sent"),
  v.literal("failed")
);

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

type BillingPlan = SidetoneBillablePlanTier;
type BillingStatus = SidetoneSubscriptionStatus;

function now() {
  return Date.now();
}

function requireWorkerToken(input: string) {
  if (!process.env.SIDETONE_WORKER_TOKEN || input !== process.env.SIDETONE_WORKER_TOKEN) {
    throw new Error("Unauthorized.");
  }
}

function allowanceSeconds(plan: BillingPlan) {
  if (isSelfHosted()) return Number.MAX_SAFE_INTEGER;
  return sidetoneBillingPlans[plan].monthlyPhoneMinutes * 60;
}

function isOverageEligible(plan: BillingPlan, status: BillingStatus) {
  if (isSelfHosted()) return false;
  return plan !== "free" && status === "active" && sidetoneBillingPlans[plan].overageEligible;
}

function periodEndFrom(start: number) {
  return start + MONTH_MS;
}

function trialEndFrom(start: number) {
  return start + sidetoneTrialDays * DAY_MS;
}

function effectivePlanStatus(subscription: Doc<"billingSubscriptions"> | null, timestamp: number) {
  if (isSelfHosted()) return { plan: "premier_pro" as BillingPlan, status: "active" as BillingStatus };
  if (!subscription) {
    return { plan: sidetoneTrialPlan as BillingPlan, status: "trialing" as BillingStatus };
  }
  if (subscription.status === "trialing" && subscription.trialEnd && subscription.trialEnd <= timestamp) {
    return { plan: "free" as BillingPlan, status: "free" as BillingStatus };
  }
  if (subscription.status === "active" || subscription.status === "trialing") {
    return { plan: subscription.plan as BillingPlan, status: subscription.status as BillingStatus };
  }
  return { plan: "free" as BillingPlan, status: "free" as BillingStatus };
}

async function latestSubscriptionForOwner(ctx: { db: any }, ownerTokenIdentifier: string) {
  return await ctx.db
    .query("billingSubscriptions")
    .withIndex("by_owner", (q: any) => q.eq("ownerTokenIdentifier", ownerTokenIdentifier))
    .order("desc")
    .first() as Doc<"billingSubscriptions"> | null;
}

async function currentUsagePeriodForOwner(ctx: { db: any }, ownerTokenIdentifier: string, timestamp: number) {
  const periods = await ctx.db
    .query("billingUsagePeriods")
    .withIndex("by_owner_period_end", (q: any) => q.eq("ownerTokenIdentifier", ownerTokenIdentifier).gte("periodEnd", timestamp))
    .take(12) as Doc<"billingUsagePeriods">[];
  return periods
    .filter((period) => period.periodStart <= timestamp && period.periodEnd > timestamp)
    .sort((left, right) => right.periodStart - left.periodStart)[0] ?? null;
}

async function ensureUsagePeriod(ctx: { db: any }, input: {
  ownerTokenIdentifier: string;
  subscription: Doc<"billingSubscriptions"> | null;
  timestamp: number;
}) {
  const existing = await currentUsagePeriodForOwner(ctx, input.ownerTokenIdentifier, input.timestamp);
  const effective = effectivePlanStatus(input.subscription, input.timestamp);
  if (existing && existing.plan === effective.plan && existing.status === effective.status) {
    return existing;
  }

  const subscriptionPeriodIsCurrent = Boolean(
    input.subscription
    && input.subscription.currentPeriodStart <= input.timestamp
    && input.subscription.currentPeriodEnd > input.timestamp
  );
  const periodStart = subscriptionPeriodIsCurrent && input.subscription
    ? input.subscription.currentPeriodStart
    : input.timestamp;
  const periodEnd = subscriptionPeriodIsCurrent && input.subscription
    ? input.subscription.currentPeriodEnd
    : effective.status === "trialing" && input.subscription?.trialEnd
      ? input.subscription.trialEnd
      : periodEndFrom(periodStart);

  const billingUsagePeriodId = await ctx.db.insert("billingUsagePeriods", {
    ownerTokenIdentifier: input.ownerTokenIdentifier,
    billingSubscriptionId: input.subscription?._id,
    plan: effective.plan,
    status: effective.status,
    periodStart,
    periodEnd,
    allowanceSeconds: allowanceSeconds(effective.plan),
    finalizedUsageSeconds: 0,
    createdAt: input.timestamp,
    updatedAt: input.timestamp
  });

  return await ctx.db.get(billingUsagePeriodId) as Doc<"billingUsagePeriods">;
}

export const ensureTrialForAuthenticatedOwner = mutation({
  args: {
    clerkUserId: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    if (isSelfHosted()) return { subscriptionId: null };
    const timestamp = now();

    const existingCustomer = await ctx.db
      .query("billingCustomers")
      .withIndex("by_owner", (q) => q.eq("ownerTokenIdentifier", identity.tokenIdentifier))
      .first();

    if (existingCustomer) {
      await ctx.db.patch(existingCustomer._id, {
        clerkUserId: args.clerkUserId ?? existingCustomer.clerkUserId,
        updatedAt: timestamp
      });
    } else {
      await ctx.db.insert("billingCustomers", {
        ownerTokenIdentifier: identity.tokenIdentifier,
        clerkUserId: args.clerkUserId,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }

    const existingSubscription = await latestSubscriptionForOwner(ctx, identity.tokenIdentifier);
    if (existingSubscription) {
      await ensureUsagePeriod(ctx, {
        ownerTokenIdentifier: identity.tokenIdentifier,
        subscription: existingSubscription,
        timestamp
      });
      return { subscriptionId: existingSubscription._id };
    }

    const trialEnd = trialEndFrom(timestamp);
    const subscriptionId = await ctx.db.insert("billingSubscriptions", {
      ownerTokenIdentifier: identity.tokenIdentifier,
      plan: sidetoneTrialPlan,
      status: "trialing",
      cancelAtPeriodEnd: false,
      currentPeriodStart: timestamp,
      currentPeriodEnd: trialEnd,
      trialStart: timestamp,
      trialEnd,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const subscription = await ctx.db.get(subscriptionId);
    await ensureUsagePeriod(ctx, {
      ownerTokenIdentifier: identity.tokenIdentifier,
      subscription,
      timestamp
    });

    await ctx.db.insert("auditEvents", {
      actor: "system",
      type: "billing.trial_started",
      message: "Sidetone started a Smooth Operator trial.",
      metadata: {
        plan: sidetoneTrialPlan,
        trialEnd
      },
      createdAt: timestamp
    });

    return { subscriptionId };
  }
});

export const billingCustomerForAuthenticatedOwner = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const customer = await ctx.db
      .query("billingCustomers")
      .withIndex("by_owner", (q) => q.eq("ownerTokenIdentifier", identity.tokenIdentifier))
      .first();
    const subscription = await latestSubscriptionForOwner(ctx, identity.tokenIdentifier);
    return { customer, subscription, ownerTokenIdentifier: identity.tokenIdentifier };
  }
});

export const setStripeCustomerForAuthenticatedOwner = mutation({
  args: {
    clerkUserId: v.optional(v.string()),
    stripeCustomerId: v.string()
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const timestamp = now();
    const existing = await ctx.db
      .query("billingCustomers")
      .withIndex("by_owner", (q) => q.eq("ownerTokenIdentifier", identity.tokenIdentifier))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        clerkUserId: args.clerkUserId ?? existing.clerkUserId,
        stripeCustomerId: args.stripeCustomerId,
        updatedAt: timestamp
      });
      return { customerId: existing._id };
    }

    const customerId = await ctx.db.insert("billingCustomers", {
      ownerTokenIdentifier: identity.tokenIdentifier,
      clerkUserId: args.clerkUserId,
      stripeCustomerId: args.stripeCustomerId,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    return { customerId };
  }
});

export const subscriptionOverview = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const timestamp = now();
    const subscription = await latestSubscriptionForOwner(ctx, identity.tokenIdentifier);
    const effective = effectivePlanStatus(subscription, timestamp);
    const period = await currentUsagePeriodForOwner(ctx, identity.tokenIdentifier, timestamp);
    const allowance = allowanceSeconds(effective.plan);
    const finalizedUsageSeconds = period?.finalizedUsageSeconds ?? 0;
    const remainingSeconds = Math.max(0, allowance - finalizedUsageSeconds);

    return {
      plan: effective.plan,
      status: effective.status,
      planLabel: sidetoneBillingPlans[effective.plan].label,
      callIntelligence: effective.status === "trialing" || sidetoneBillingPlans[effective.plan].callIntelligence,
      overageEligible: isOverageEligible(effective.plan, effective.status),
      monthlyPhoneMinutes: sidetoneBillingPlans[effective.plan].monthlyPhoneMinutes,
      overageCents: sidetoneBillingPlans[effective.plan].phoneOverageCents,
      periodStart: period?.periodStart ?? subscription?.currentPeriodStart ?? timestamp,
      periodEnd: period?.periodEnd ?? subscription?.currentPeriodEnd ?? periodEndFrom(timestamp),
      trialEnd: subscription?.status === "trialing" ? subscription.trialEnd : undefined,
      finalizedUsageSeconds,
      remainingSeconds,
      warningSmsSentAt: period?.warningSmsSentAt,
      graceStartedAt: period?.graceStartedAt,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      stripeSubscriptionId: subscription?.stripeSubscriptionId,
      stripeCustomerId: subscription?.stripeCustomerId
    };
  }
});

export const phoneCallStartAuthorization = query({
  args: {
    entityId: v.id("entityProfiles")
  },
  handler: async (ctx, args) => {
    const entity = await requireOwnedEntity(ctx, args.entityId);
    const timestamp = now();
    const subscription = await latestSubscriptionForOwner(ctx, entity.ownerTokenIdentifier);
    const effective = effectivePlanStatus(subscription, timestamp);
    const period = await currentUsagePeriodForOwner(ctx, entity.ownerTokenIdentifier, timestamp);
    const allowance = allowanceSeconds(effective.plan);
    const finalizedUsageSeconds = period?.finalizedUsageSeconds ?? 0;
    const overageEligible = isOverageEligible(effective.plan, effective.status);
    const canStart = overageEligible || finalizedUsageSeconds < allowance;

    return {
      canStart,
      reason: canStart ? null : "monthly_phone_minutes_exhausted",
      plan: effective.plan,
      status: effective.status,
      overageEligible,
      allowanceSeconds: allowance,
      finalizedUsageSeconds,
      remainingSeconds: Math.max(0, allowance - finalizedUsageSeconds)
    };
  }
});

export const phoneCallStartAuthorizationForWorker = mutation({
  args: {
    workerToken: v.string(),
    entityId: v.id("entityProfiles")
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new Error("Workspace not found.");
    }
    const timestamp = now();
    const subscription = await latestSubscriptionForOwner(ctx, entity.ownerTokenIdentifier);
    const effective = effectivePlanStatus(subscription, timestamp);
    const period = await currentUsagePeriodForOwner(ctx, entity.ownerTokenIdentifier, timestamp);
    const allowance = allowanceSeconds(effective.plan);
    const finalizedUsageSeconds = period?.finalizedUsageSeconds ?? 0;
    const overageEligible = isOverageEligible(effective.plan, effective.status);
    const canStart = overageEligible || finalizedUsageSeconds < allowance;

    return {
      canStart,
      reason: canStart ? null : "monthly_phone_minutes_exhausted",
      plan: effective.plan,
      status: effective.status,
      overageEligible,
      allowanceSeconds: allowance,
      finalizedUsageSeconds,
      remainingSeconds: Math.max(0, allowance - finalizedUsageSeconds)
    };
  }
});

export const entitlementsForAuthenticatedOwner = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    return await entitlementsForOwnerToken(ctx, identity.tokenIdentifier);
  }
});

async function entitlementsForOwnerToken(ctx: { db: any }, ownerTokenIdentifier: string) {
  const timestamp = now();
  const subscription = await latestSubscriptionForOwner(ctx, ownerTokenIdentifier);
  const effective = effectivePlanStatus(subscription, timestamp);
  return {
    plan: effective.plan,
    status: effective.status,
    callIntelligence: effective.status === "trialing" || sidetoneBillingPlans[effective.plan].callIntelligence,
    overageEligible: isOverageEligible(effective.plan, effective.status)
  };
}

export const entitlementsForOwnerTokenInternal = internalQuery({
  args: {
    ownerTokenIdentifier: v.string()
  },
  handler: async (ctx, args) => {
    return await entitlementsForOwnerToken(ctx, args.ownerTokenIdentifier);
  }
});

export const recordStripeWebhookReceived = mutation({
  args: {
    workerToken: v.string(),
    stripeEventId: v.string(),
    eventType: v.string()
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);

    const existing = await ctx.db
      .query("stripeWebhookEvents")
      .withIndex("by_stripe_event", (q) => q.eq("stripeEventId", args.stripeEventId))
      .first();
    if (existing) {
      return { duplicate: existing.status === "processed", eventId: existing._id };
    }

    const timestamp = now();
    const eventId = await ctx.db.insert("stripeWebhookEvents", {
      stripeEventId: args.stripeEventId,
      eventType: args.eventType,
      status: "received",
      receivedAt: timestamp
    });
    return { duplicate: false, eventId };
  }
});

export const markStripeWebhookProcessed = mutation({
  args: {
    workerToken: v.string(),
    stripeEventId: v.string(),
    status: v.union(v.literal("processed"), v.literal("failed")),
    error: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    const event = await ctx.db
      .query("stripeWebhookEvents")
      .withIndex("by_stripe_event", (q) => q.eq("stripeEventId", args.stripeEventId))
      .first();
    if (!event) {
      throw new Error("Stripe event not found.");
    }
    await ctx.db.patch(event._id, {
      status: args.status,
      error: args.error,
      processedAt: now()
    });
    return { eventId: event._id };
  }
});

export const syncSubscriptionFromStripe = mutation({
  args: {
    workerToken: v.string(),
    ownerTokenIdentifier: v.optional(v.string()),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.optional(v.string()),
    plan: billingPlan,
    status: billingSubscriptionStatus,
    cancelAtPeriodEnd: v.optional(v.boolean()),
    currentPeriodStart: v.float64(),
    currentPeriodEnd: v.float64(),
    trialStart: v.optional(v.float64()),
    trialEnd: v.optional(v.float64())
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);

    const customer = await ctx.db
      .query("billingCustomers")
      .withIndex("by_stripe_customer", (q) => q.eq("stripeCustomerId", args.stripeCustomerId))
      .first();
    const ownerTokenIdentifier = args.ownerTokenIdentifier ?? customer?.ownerTokenIdentifier;
    if (!ownerTokenIdentifier) {
      throw new Error("Billing owner not found for Stripe customer.");
    }

    const timestamp = now();
    if (customer) {
      await ctx.db.patch(customer._id, {
        stripeCustomerId: args.stripeCustomerId,
        updatedAt: timestamp
      });
    } else {
      await ctx.db.insert("billingCustomers", {
        ownerTokenIdentifier,
        stripeCustomerId: args.stripeCustomerId,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }

    const existing = args.stripeSubscriptionId
      ? await ctx.db
        .query("billingSubscriptions")
        .withIndex("by_stripe_subscription", (q) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId))
        .first()
      : await latestSubscriptionForOwner(ctx, ownerTokenIdentifier);

    const patch = {
      ownerTokenIdentifier,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      plan: args.plan,
      status: args.status,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
      trialStart: args.trialStart,
      trialEnd: args.trialEnd,
      updatedAt: timestamp
    };

    let subscriptionId: Id<"billingSubscriptions">;
    if (existing) {
      subscriptionId = existing._id;
      await ctx.db.patch(existing._id, patch);
    } else {
      subscriptionId = await ctx.db.insert("billingSubscriptions", {
        ...patch,
        createdAt: timestamp
      });
    }

    const subscription = await ctx.db.get(subscriptionId);
    await ensureUsagePeriod(ctx, {
      ownerTokenIdentifier,
      subscription,
      timestamp
    });

    await ctx.db.insert("auditEvents", {
      actor: "stripe",
      type: "billing.subscription_synced",
      message: "Sidetone synced Stripe subscription state.",
      metadata: {
        stripeCustomerId: args.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        plan: args.plan,
        status: args.status
      },
      createdAt: timestamp
    });

    return { subscriptionId };
  }
});

export const recordPhoneCallUsageInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      throw new Error("Call session not found.");
    }

    const existing = await ctx.db
      .query("phoneCallUsageEvents")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    if (existing) {
      return { usageEventId: existing._id, duplicate: true, overageMinutes: existing.overageMinutes };
    }

    const timestamp = now();
    const startedAt = callSession.startedAt ?? callSession.createdAt;
    const endedAt = callSession.endedAt ?? timestamp;
    const durationSeconds = Math.max(0, Math.ceil((endedAt - startedAt) / 1000));
    const subscription = await latestSubscriptionForOwner(ctx, callSession.ownerTokenIdentifier);
    const period = await ensureUsagePeriod(ctx, {
      ownerTokenIdentifier: callSession.ownerTokenIdentifier,
      subscription,
      timestamp: endedAt
    });
    const effective = effectivePlanStatus(subscription, endedAt);
    const previousUsageSeconds = period.finalizedUsageSeconds;
    const includedRemainingSeconds = Math.max(0, period.allowanceSeconds - previousUsageSeconds);
    const includedSecondsApplied = Math.min(includedRemainingSeconds, durationSeconds);
    const overageSeconds = Math.max(0, durationSeconds - includedSecondsApplied);
    const overageMinutes = isOverageEligible(effective.plan, effective.status)
      ? Math.ceil(overageSeconds / 60)
      : 0;

    const usageEventId = await ctx.db.insert("phoneCallUsageEvents", {
      ownerTokenIdentifier: callSession.ownerTokenIdentifier,
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      billingUsagePeriodId: period._id,
      planAtUsage: effective.plan,
      statusAtUsage: effective.status,
      durationSeconds,
      includedSecondsApplied,
      overageMinutes,
      stripeMeterStatus: overageMinutes > 0 ? "pending" : "not_applicable",
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.patch(period._id, {
      finalizedUsageSeconds: previousUsageSeconds + durationSeconds,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "system",
      type: "billing.phone_usage_recorded",
      message: "Sidetone recorded phone-call usage.",
      metadata: {
        durationSeconds,
        overageMinutes,
        plan: effective.plan,
        status: effective.status
      },
      createdAt: timestamp
    });

    return { usageEventId, duplicate: false, overageMinutes };
  }
});

export const pendingMeterEvents = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    return await ctx.db
      .query("phoneCallUsageEvents")
      .withIndex("by_owner_meter_status", (q) => q.eq("ownerTokenIdentifier", identity.tokenIdentifier).eq("stripeMeterStatus", "pending"))
      .take(50);
  }
});

export const pendingMeterEventsForWorker = mutation({
  args: {
    workerToken: v.string()
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    const events = await ctx.db
      .query("phoneCallUsageEvents")
      .withIndex("by_meter_status", (q) => q.eq("stripeMeterStatus", "pending"))
      .take(50);

    const results = [];
    for (const event of events) {
      const customer = await ctx.db
        .query("billingCustomers")
        .withIndex("by_owner", (q) => q.eq("ownerTokenIdentifier", event.ownerTokenIdentifier))
        .first();
      if (!customer?.stripeCustomerId) {
        results.push({
          usageEventId: event._id,
          skipReason: "missing_stripe_customer"
        });
        continue;
      }

      results.push({
        usageEventId: event._id,
        ownerTokenIdentifier: event.ownerTokenIdentifier,
        stripeCustomerId: customer.stripeCustomerId,
        plan: event.planAtUsage,
        overageMinutes: event.overageMinutes,
        createdAt: event.createdAt
      });
    }

    return results;
  }
});

export const markMeterEventInternal = internalMutation({
  args: {
    usageEventId: v.id("phoneCallUsageEvents"),
    status: stripeMeterStatus,
    stripeMeterEventId: v.optional(v.string()),
    stripeMeterEventName: v.optional(v.string()),
    error: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.usageEventId, {
      stripeMeterStatus: args.status,
      stripeMeterEventId: args.stripeMeterEventId,
      stripeMeterEventName: args.stripeMeterEventName,
      error: args.error,
      updatedAt: now()
    });
    return { usageEventId: args.usageEventId };
  }
});

export const markMeterEventFromWorker = mutation({
  args: {
    workerToken: v.string(),
    usageEventId: v.id("phoneCallUsageEvents"),
    status: stripeMeterStatus,
    stripeMeterEventId: v.optional(v.string()),
    stripeMeterEventName: v.optional(v.string()),
    error: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    await ctx.db.patch(args.usageEventId, {
      stripeMeterStatus: args.status,
      stripeMeterEventId: args.stripeMeterEventId,
      stripeMeterEventName: args.stripeMeterEventName,
      error: args.error,
      updatedAt: now()
    });
    return { usageEventId: args.usageEventId };
  }
});

export const monitorLiveCallInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || !["connecting", "live"].includes(callSession.status)) {
      return { continueMonitoring: false, shouldEndCall: false };
    }

    if (isSelfHosted()) {
      const configuredMax = Number(process.env.SIDETONE_MAX_CALL_MINUTES ?? 120);
      const maxMinutes = Number.isFinite(configuredMax) && configuredMax >= 1 && configuredMax <= 360 ? configuredMax : 120;
      const activeSeconds = Math.max(0, Math.ceil((now() - (callSession.startedAt ?? callSession.createdAt)) / 1000));
      const shouldEndCall = activeSeconds >= maxMinutes * 60;
      const legs = await ctx.db.query("callLegs").withIndex("by_call_session", q => q.eq("callSessionId", args.callSessionId)).take(16);
      return {
        continueMonitoring: !shouldEndCall,
        shouldEndCall,
        shouldSendWarningSms: false,
        shouldSendGraceSms: false,
        callControlIds: Array.from(new Set([callSession.telnyxCallControlId, ...legs.map(leg => leg.telnyxCallControlId)].filter((id): id is string => Boolean(id))))
      };
    }

    const timestamp = now();
    const subscription = await latestSubscriptionForOwner(ctx, callSession.ownerTokenIdentifier);
    const period = await ensureUsagePeriod(ctx, {
      ownerTokenIdentifier: callSession.ownerTokenIdentifier,
      subscription,
      timestamp
    });
    const effective = effectivePlanStatus(subscription, timestamp);
    const startedAt = callSession.startedAt ?? callSession.createdAt;
    const activeSeconds = Math.max(0, Math.ceil((timestamp - startedAt) / 1000));
    const projectedUsageSeconds = period.finalizedUsageSeconds + activeSeconds;
    const remainingSeconds = period.allowanceSeconds - projectedUsageSeconds;
    const warningThresholdSeconds = 30 * 60;
    const callLegs = await ctx.db
      .query("callLegs")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .take(16) as Doc<"callLegs">[];
    const callControlIds = Array.from(new Set([
      callSession.telnyxCallControlId,
      ...callLegs.map((leg) => leg.telnyxCallControlId)
    ].filter(Boolean)));
    const entity = await ctx.db.get(callSession.entityId);
    const numberAssignment = await ctx.db
      .query("phoneNumberAssignments")
      .withIndex("by_entity", (q) => q.eq("entityId", callSession.entityId))
      .first();
    const ownerLeg = callLegs.find((leg) => leg.role === "owner");

    let shouldSendWarningSms = false;
    let shouldSendGraceSms = false;
    let shouldEndCall = false;

    if (remainingSeconds <= warningThresholdSeconds && !period.warningSmsSentAt) {
      shouldSendWarningSms = true;
      await ctx.db.patch(period._id, {
        warningSmsSentAt: timestamp,
        updatedAt: timestamp
      });
    }

    if (remainingSeconds <= 0 && !isOverageEligible(effective.plan, effective.status)) {
      if (!period.graceStartedAt) {
        shouldSendGraceSms = true;
        await ctx.db.patch(period._id, {
          graceStartedAt: timestamp,
          updatedAt: timestamp
        });
      } else if (timestamp - period.graceStartedAt >= 30 * 60 * 1000) {
        shouldEndCall = true;
        await ctx.db.patch(period._id, {
          cutoffAt: timestamp,
          updatedAt: timestamp
        });
      }
    }

    return {
      continueMonitoring: !shouldEndCall,
      shouldEndCall,
      shouldSendWarningSms,
      shouldSendGraceSms,
      callControlIds,
      ownerPhoneNumber: entity?.ownerPhoneNumber ?? ownerLeg?.phoneNumber,
      sidetonePhoneNumber: numberAssignment?.e164 ?? numberAssignment?.phoneNumber,
      ownerTokenIdentifier: callSession.ownerTokenIdentifier,
      entityId: callSession.entityId,
      plan: effective.plan,
      status: effective.status,
      remainingSeconds,
      activeSeconds,
      allowanceSeconds: period.allowanceSeconds
    };
  }
});
