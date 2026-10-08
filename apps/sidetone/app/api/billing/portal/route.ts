import { billingEnabled } from "../../../lib/config";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { getConvexAuthToken } from "../../../lib/clerk-convex";
import { billingReturnUrl, stripeClient } from "../../../lib/stripe";

export async function POST() {
  if (!billingEnabled()) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const token = await getConvexAuthToken();
  await fetchMutation(api.billing.ensureTrialForAuthenticatedOwner, { clerkUserId: userId }, { token });
  const billing = await fetchQuery(api.billing.billingCustomerForAuthenticatedOwner, {}, { token });
  const stripeCustomerId = billing.customer?.stripeCustomerId;
  if (!stripeCustomerId) {
    return NextResponse.json({ error: "Start a paid plan before opening billing settings." }, { status: 409 });
  }

  const session = await stripeClient().billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: billingReturnUrl("/subscriptions")
  });

  return NextResponse.json({ url: session.url });
}
