import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

function requireWorkerToken(input: string) {
  if (!process.env.SIDETONE_WORKER_TOKEN || input !== process.env.SIDETONE_WORKER_TOKEN) {
    throw new Error("Unauthorized.");
  }
}

async function latestSubscriptionForOwner(ctx: Pick<QueryCtx, "db">, ownerTokenIdentifier: string) {
  return await ctx.db
    .query("billingSubscriptions")
    .withIndex("by_owner", (q) => q.eq("ownerTokenIdentifier", ownerTokenIdentifier))
    .order("desc")
    .first() as Doc<"billingSubscriptions"> | null;
}

async function latestUsagePeriodForOwner(ctx: Pick<QueryCtx, "db">, ownerTokenIdentifier: string) {
  return await ctx.db
    .query("billingUsagePeriods")
    .withIndex("by_owner_period", (q) => q.eq("ownerTokenIdentifier", ownerTokenIdentifier))
    .order("desc")
    .first() as Doc<"billingUsagePeriods"> | null;
}

export const usersOverviewForWorker = query({
  args: {
    workerToken: v.string(),
    limit: v.optional(v.float64())
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);

    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 100), 1), 200);
    const customers = await ctx.db
      .query("billingCustomers")
      .order("desc")
      .take(limit) as Doc<"billingCustomers">[];

    const rows = [];
    for (const customer of customers) {
      const subscription = await latestSubscriptionForOwner(ctx, customer.ownerTokenIdentifier);
      const usagePeriod = await latestUsagePeriodForOwner(ctx, customer.ownerTokenIdentifier);
      const calls = await ctx.db
        .query("callSessions")
        .withIndex("by_owner", (q) => q.eq("ownerTokenIdentifier", customer.ownerTokenIdentifier))
        .order("desc")
        .take(501) as Doc<"callSessions">[];
      const lastCall = calls[0] ?? null;

      rows.push({
        ownerTokenIdentifier: customer.ownerTokenIdentifier,
        clerkUserId: customer.clerkUserId,
        stripeCustomerAttached: Boolean(customer.stripeCustomerId),
        plan: subscription?.plan ?? null,
        status: subscription?.status ?? null,
        trialEnd: subscription?.trialEnd ?? null,
        periodEnd: usagePeriod?.periodEnd ?? subscription?.currentPeriodEnd ?? null,
        finalizedUsageSeconds: usagePeriod?.finalizedUsageSeconds ?? 0,
        allowanceSeconds: usagePeriod?.allowanceSeconds ?? 0,
        callCount: Math.min(calls.length, 500),
        callCountIsTruncated: calls.length > 500,
        lastCallAt: lastCall?.startedAt ?? lastCall?.createdAt ?? null,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt
      });
    }

    return rows;
  }
});
