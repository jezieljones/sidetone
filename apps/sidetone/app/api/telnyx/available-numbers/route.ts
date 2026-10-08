import { getWorkerToken } from "../../../lib/config";
import { featureEnabled } from "../../../lib/config";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { getConvexAuthToken } from "../../../lib/clerk-convex";
import {
  searchAvailableLocalNumbers,
  telnyxConfigSummary,
  TelnyxConfigurationError,
  TelnyxRequestError
} from "../../../lib/telnyx";

export async function GET(request: Request) {
  if (!featureEnabled("phone")) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId");
  const areaCode = url.searchParams.get("areaCode") ?? "";

  if (!entityId) {
    return NextResponse.json({ error: "Missing workspace id." }, { status: 400 });
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
        status: "searching",
        voiceRoutingStatus: "missing",
        smsRoutingStatus: "missing"
      },
      { token }
    );

    const numbers = await searchAvailableLocalNumbers(areaCode);

    return NextResponse.json({
      numbers,
      telnyx: telnyxConfigSummary()
    });
  } catch (error) {
    const token = await getConvexAuthToken().catch(() => null);
    if (token && entityId) {
      await fetchMutation(
        api.entities.upsertPhoneNumberAssignment, {
        workerToken: getWorkerToken(),
          entityId: entityId as any,
          areaCode,
          status: "failed",
          voiceRoutingStatus: "failed",
          failureReason: error instanceof Error ? error.message : "Unable to search numbers."
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
      { error: error instanceof Error ? error.message : "Unable to search numbers." },
      { status: 500 }
    );
  }
}
