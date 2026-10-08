import { fetchMutation } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import { stripeClient } from "./stripe";
import { billingEnabled } from "./config";

function workerToken() {
  const token = process.env.SIDETONE_WORKER_TOKEN?.trim();
  if (!token) {
    throw new Error("SIDETONE_WORKER_TOKEN is not configured.");
  }
  return token;
}

export function stripeMeterEventNameForPlan(plan: string) {
  if (plan === "premier_pro") {
    return "sidetone_premier_pro_phone_overage_minutes";
  }
  return "sidetone_smooth_operator_phone_overage_minutes";
}

export async function flushPendingStripeMeterEvents() {
  if (!billingEnabled()) return { processed: 0, results: [] };
  const token = workerToken();
  const stripe = stripeClient();
  const events = await fetchMutation(api.billing.pendingMeterEventsForWorker, {
    workerToken: token
  });

  const results = [];
  for (const event of events as any[]) {
    if (event.skipReason) {
      await fetchMutation(api.billing.markMeterEventFromWorker, {
        workerToken: token,
        usageEventId: event.usageEventId,
        status: "failed",
        error: event.skipReason
      });
      results.push({ usageEventId: event.usageEventId, status: "failed", error: event.skipReason });
      continue;
    }

    const eventName = stripeMeterEventNameForPlan(event.plan);
    try {
      const meterEvent = await stripe.billing.meterEvents.create({
        event_name: eventName,
        identifier: `sidetone-${event.usageEventId}`,
        timestamp: Math.floor((event.createdAt ?? Date.now()) / 1000),
        payload: {
          stripe_customer_id: event.stripeCustomerId,
          value: String(Math.max(0, event.overageMinutes ?? 0))
        }
      });

      await fetchMutation(api.billing.markMeterEventFromWorker, {
        workerToken: token,
        usageEventId: event.usageEventId,
        status: "sent",
        stripeMeterEventId: meterEvent.identifier ?? meterEvent.event_name,
        stripeMeterEventName: eventName
      });
      results.push({ usageEventId: event.usageEventId, status: "sent" });
    } catch (error) {
      await fetchMutation(api.billing.markMeterEventFromWorker, {
        workerToken: token,
        usageEventId: event.usageEventId,
        status: "failed",
        stripeMeterEventName: eventName,
        error: error instanceof Error ? error.message : "Unable to emit Stripe meter event."
      });
      results.push({
        usageEventId: event.usageEventId,
        status: "failed",
        error: error instanceof Error ? error.message : "Unable to emit Stripe meter event."
      });
    }
  }

  return { processed: results.length, results };
}
