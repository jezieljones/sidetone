import { billingEnabled } from "../../../lib/config";
import { auth, currentUser } from "@clerk/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { getConvexAuthToken } from "../../../lib/clerk-convex";
import {
  appUrl,
  checkoutLineItemsForPlan,
  planFromCheckoutSlug,
  pricingSlugForPlan,
  stripeClient
} from "../../../lib/stripe";

export async function POST(request: Request) {
  if (!billingEnabled()) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const plan = planFromCheckoutSlug(typeof body?.plan === "string" ? body.plan : undefined);
  if (!plan) {
    return NextResponse.json({ error: "Choose a paid plan." }, { status: 400 });
  }

  const token = await getConvexAuthToken();
  await fetchMutation(api.billing.ensureTrialForAuthenticatedOwner, { clerkUserId: userId }, { token });
  const billing = await fetchQuery(api.billing.billingCustomerForAuthenticatedOwner, {}, { token });
  const user = await currentUser();
  const stripe = stripeClient();
  let stripeCustomerId = billing.customer?.stripeCustomerId;

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      phone: user?.primaryPhoneNumber?.phoneNumber,
      email: user?.primaryEmailAddress?.emailAddress,
      metadata: {
        clerkUserId: userId,
        ownerTokenIdentifier: billing.ownerTokenIdentifier
      }
    });
    stripeCustomerId = customer.id;
    await fetchMutation(
      api.billing.setStripeCustomerForAuthenticatedOwner,
      { clerkUserId: userId, stripeCustomerId },
      { token }
    );
  }

  const successUrl = `${appUrl()}/subscriptions?checkout=success&plan=${pricingSlugForPlan(plan)}`;
  const cancelUrl = `${appUrl()}/subscriptions?checkout=cancelled&plan=${pricingSlugForPlan(plan)}`;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    allow_promotion_codes: true,
    line_items: checkoutLineItemsForPlan(plan),
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: userId,
    metadata: {
      clerkUserId: userId,
      ownerTokenIdentifier: billing.ownerTokenIdentifier,
      plan
    },
    subscription_data: {
      metadata: {
        clerkUserId: userId,
        ownerTokenIdentifier: billing.ownerTokenIdentifier,
        plan
      }
    }
  });

  return NextResponse.json({ url: session.url });
}
