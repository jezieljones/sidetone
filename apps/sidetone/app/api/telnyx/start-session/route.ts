import { featureEnabled } from "../../../lib/config";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isCoachMode, isIndustryProfileId, normalizeIndustryProfileId, normalizeTuningMode } from "@sidetone/contracts";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { getConvexAuthToken } from "../../../lib/clerk-convex";
import {
  friendlyCallThroughFailure,
  startCallThrough,
  telnyxConfigSummary,
  TelnyxConfigurationError,
  TelnyxRequestError
} from "../../../lib/telnyx";

function normalizePhone(input?: string | null) {
  if (!input) {
    return "";
  }

  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  return input.trim();
}

export async function POST(request: Request) {
  if (!featureEnabled("phone")) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const entityId = String(body?.entityId ?? "");
  const rawCoachMode = typeof body?.coachMode === "string" ? body.coachMode : undefined;
  const tuningMode = normalizeTuningMode(rawCoachMode);
  const rawIndustryProfile = typeof body?.industryProfile === "string" ? body.industryProfile : undefined;
  const industryProfile = rawIndustryProfile ? normalizeIndustryProfileId(rawIndustryProfile) : undefined;
  const consentMode = body?.playDisclosure === false ? "owner_acknowledgment" : "conference_disclosure";
  const callFocusText = typeof body?.callFocusText === "string"
    ? body.callFocusText.replace(/\s+/g, " ").trim().slice(0, 500)
    : undefined;

  if (!entityId) {
    return NextResponse.json({ error: "Missing Sidetone workspace." }, { status: 400 });
  }

  if (rawCoachMode && !isCoachMode(rawCoachMode)) {
    return NextResponse.json({ error: "Unsupported conversation intelligence setting." }, { status: 400 });
  }

  if (rawIndustryProfile && !isIndustryProfileId(rawIndustryProfile)) {
    return NextResponse.json({ error: "Unsupported Sidetone profile." }, { status: 400 });
  }

  let token: string | null = null;
  let createdCallSessionId: Id<"callSessions"> | null = null;

  try {
    token = await getConvexAuthToken();
    const user = await currentUser();
    const ownerPhoneNumber = normalizePhone(user?.primaryPhoneNumber?.phoneNumber);
    await fetchMutation(api.billing.ensureTrialForAuthenticatedOwner, { clerkUserId: userId }, { token });
    const access = await fetchQuery(api.entities.ownedEntityAccess, { entityId: entityId as any }, { token });
    const fromPhoneNumber = access?.numberAssignment?.e164 ?? access?.numberAssignment?.phoneNumber;

    if (!access || !fromPhoneNumber || access.numberAssignment?.status !== "active") {
      return NextResponse.json(
        { error: "Set up your Sidetone number before starting notes." },
        { status: 409 }
      );
    }

    if (!ownerPhoneNumber) {
      return NextResponse.json(
        { error: "Add a phone number to your Sidetone account before starting notes." },
        { status: 409 }
      );
    }

    const billing = await fetchQuery(api.billing.phoneCallStartAuthorization, { entityId: entityId as any }, { token });
    if (!billing.canStart) {
      return NextResponse.json(
        {
          error: "Your included Sidetone phone minutes are used for this month.",
          reason: billing.reason,
          upgradeUrl: "/subscriptions"
        },
        { status: 402 }
      );
    }

    const created = await fetchMutation(
      api.calls.createSidetoneSession,
      {
        entityId: entityId as any,
        fromPhoneNumber,
        ownerPhoneNumber,
        industryProfile: industryProfile as any,
        coachMode: (tuningMode ?? null) as any,
        consentMode: consentMode as any,
        callFocusText
      },
      { token }
    );
    createdCallSessionId = created.callSessionId;

    const telnyxCall = await startCallThrough({
      fromPhoneNumber,
      toPhoneNumber: ownerPhoneNumber,
      callSessionId: String(created.callSessionId),
      legRole: "owner",
      answeringMachineDetection: "premium"
    });

    await fetchMutation(
      api.calls.attachTelnyxCallIds,
      {
        callSessionId: created.callSessionId,
        telnyxCallControlId: telnyxCall.callControlId,
        telnyxCallSessionId: telnyxCall.callSessionId,
        status: "connecting"
      },
      { token }
    );

    return NextResponse.json({
      callSessionId: created.callSessionId,
      telnyxCall,
      telnyx: telnyxConfigSummary()
    });
  } catch (error) {
    const failureReason = friendlyCallThroughFailure(error);
    if (token && createdCallSessionId) {
      await fetchMutation(
        api.calls.attachTelnyxCallIds,
        {
          callSessionId: createdCallSessionId,
          status: "failed",
          failureReason
        },
        { token }
      ).catch((patchError) => {
        console.warn("Failed to mark Sidetone session failed", patchError);
      });
    }

    if (error instanceof TelnyxConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    if (error instanceof TelnyxRequestError) {
      return NextResponse.json(
        {
          error: failureReason === error.message
            ? "Sidetone could not start notes. Try again in a moment."
            : failureReason,
          ...(process.env.NODE_ENV !== "production"
            ? {
                technicalMessage: error.message,
                details: error.responseBody ?? null
              }
            : {})
        },
        { status: error.status ?? 502 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start Sidetone." },
      { status: 500 }
    );
  }
}
