import { billingEnabled } from "../../../lib/config";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { getConvexAuthToken } from "../../../lib/clerk-convex";

export async function GET() {
  if (!billingEnabled()) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    const token = await getConvexAuthToken();
    await fetchMutation(api.billing.ensureTrialForAuthenticatedOwner, { clerkUserId: userId }, { token });
    const overview = await fetchQuery(api.billing.subscriptionOverview, {}, { token });
    return NextResponse.json({ overview });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load subscription." },
      { status: 500 }
    );
  }
}
