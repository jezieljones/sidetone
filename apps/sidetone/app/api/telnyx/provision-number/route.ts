import { getWorkerToken } from "../../../lib/config";
import { featureEnabled } from "../../../lib/config";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { getConvexAuthToken } from "../../../lib/clerk-convex";
import {
  provisionTelnyxLocalNumber,
  telnyxConfigSummary,
  TelnyxConfigurationError,
  TelnyxRequestError
} from "../../../lib/telnyx";

export async function POST(request: Request) {
  if (!featureEnabled("phone")) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const entityId = String(body?.entityId ?? "");
  const areaCode = String(body?.areaCode ?? "");
  const phoneNumber = String(body?.phoneNumber ?? "");

  if (!entityId || !areaCode || !phoneNumber) {
    return NextResponse.json({ error: "Missing number setup fields." }, { status: 400 });
  }

  try {
    const token = await getConvexAuthToken();
    const access = await fetchQuery(api.entities.ownedEntityAccess, { entityId: entityId as any }, { token });
    if (!access) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    await fetchMutation(
      api.entities.upsertPhoneNumberAssignment, {
        workerToken: getWorkerToken(),
        entityId: entityId as any,
        areaCode,
        phoneNumber,
        e164: phoneNumber,
        status: "ordering",
        voiceRoutingStatus: "configuring"
      },
      { token }
    );

    const provisioned = await provisionTelnyxLocalNumber({ areaCode, phoneNumber });

    await fetchMutation(
      api.entities.upsertPhoneNumberAssignment, {
        workerToken: getWorkerToken(),
        entityId: entityId as any,
        areaCode: provisioned.areaCode,
        phoneNumber: provisioned.phoneNumber,
        e164: provisioned.phoneNumber,
        status: "active",
        telnyxPhoneNumberId: provisioned.telnyxPhoneNumberId,
        telnyxConnectionId: provisioned.connectionId,
        telnyxMessagingProfileId: provisioned.messagingProfileId,
        voiceRoutingStatus: "attached",
        smsRoutingStatus: provisioned.messagingProfileId ? "attached" : "missing"
      },
      { token }
    );

    return NextResponse.json({
      provisioned,
      telnyx: telnyxConfigSummary(),
      statusLabel: "Sidetone number is ready for Call Control."
    });
  } catch (error) {
    const token = await getConvexAuthToken().catch(() => null);
    if (token && entityId) {
      await fetchMutation(
        api.entities.upsertPhoneNumberAssignment, {
        workerToken: getWorkerToken(),
          entityId: entityId as any,
          areaCode,
          phoneNumber,
          e164: phoneNumber,
          status: "failed",
          voiceRoutingStatus: "failed",
          failureReason: error instanceof Error ? error.message : "Unable to provision number."
        },
        { token }
      ).catch(() => undefined);
    }

    if (error instanceof TelnyxConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    if (error instanceof TelnyxRequestError) {
      return NextResponse.json(
        { error: error.message, details: error.responseBody ?? null },
        { status: error.status ?? 502 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to provision number." },
      { status: 500 }
    );
  }
}
