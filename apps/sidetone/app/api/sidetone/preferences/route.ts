import { auth, currentUser } from "@clerk/nextjs/server";
import { isCoachMode, isIndustryProfileId, normalizeIndustryProfileId, normalizeTuningMode } from "@sidetone/contracts";
import { fetchMutation } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { getConvexAuthToken } from "../../../lib/clerk-convex";

function normalizePhone(input?: string | null) {
  if (!input) {
    return undefined;
  }

  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  return input.trim() || undefined;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const entityId = String(body?.entityId ?? "");
  const rawCoachMode = typeof body?.coachMode === "string" ? body.coachMode : undefined;
  const tuningMode = normalizeTuningMode(rawCoachMode);
  const rawIndustryProfile = typeof body?.industryProfile === "string" ? body.industryProfile : undefined;
  const industryProfile = normalizeIndustryProfileId(rawIndustryProfile);
  const consentMode = body?.playDisclosure === false ? "owner_acknowledgment" : "conference_disclosure";

  if (!entityId) {
    return NextResponse.json({ error: "Missing Sidetone workspace." }, { status: 400 });
  }

  if (rawCoachMode && !isCoachMode(rawCoachMode)) {
    return NextResponse.json({ error: "Unsupported conversation intelligence setting." }, { status: 400 });
  }

  if (rawIndustryProfile && !isIndustryProfileId(rawIndustryProfile)) {
    return NextResponse.json({ error: "Unsupported Sidetone profile." }, { status: 400 });
  }

  const token = await getConvexAuthToken();
  const user = await currentUser();
  await fetchMutation(
    api.entities.updateCallPreferences,
    {
      entityId: entityId as any,
      defaultIndustryProfile: industryProfile as any,
      defaultCoachMode: (tuningMode ?? null) as any,
      defaultConsentMode: consentMode as any,
      ownerPhoneNumber: normalizePhone(user?.primaryPhoneNumber?.phoneNumber)
    },
    { token }
  );

  return NextResponse.json({ ok: true });
}
