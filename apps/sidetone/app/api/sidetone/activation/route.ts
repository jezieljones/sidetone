import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { getConvexAuthToken } from "../../../lib/clerk-convex";

const contactStatuses = new Set(["not_started", "saved", "skipped"]);

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const entityId = String(body?.entityId ?? "");
  const contactStatus = body?.contactStatus === undefined ? undefined : String(body.contactStatus);

  if (!entityId) {
    return NextResponse.json({ error: "Missing Sidetone workspace." }, { status: 400 });
  }

  if (contactStatus !== undefined && !contactStatuses.has(contactStatus)) {
    return NextResponse.json({ error: "Unsupported contact setup state." }, { status: 400 });
  }

  const token = await getConvexAuthToken();
  await fetchMutation(
    api.entities.updateActivationProgress,
    {
      entityId: entityId as any,
      contactStatus: contactStatus as any,
      mergeGuideViewed: body?.mergeGuideViewed === true ? true : undefined
    },
    { token }
  );

  return NextResponse.json({ ok: true });
}
