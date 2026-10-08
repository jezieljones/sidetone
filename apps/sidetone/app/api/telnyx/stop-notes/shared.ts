import { getWorkerToken } from "../../../lib/config";
import { auth } from "@clerk/nextjs/server";
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { flushPendingStripeMeterEvents } from "../../../lib/billing-meter-events";
import { getConvexAuthToken } from "../../../lib/clerk-convex";
import { hangupCall, stopMediaStreaming, TelnyxRequestError } from "../../../lib/telnyx";

export async function stopNotesPost(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const callSessionId = String(body?.callSessionId ?? "");
  if (!callSessionId) {
    return NextResponse.json({ error: "Missing call session." }, { status: 400 });
  }

  try {
    const token = await getConvexAuthToken();
    const record = await fetchQuery(api.calls.callRecordView, { callSessionId: callSessionId as any }, { token });
    const callControlIds = Array.from(new Set([
      record?.callSession.telnyxCallControlId,
      ...(record?.legs ?? []).map((leg: { telnyxCallControlId?: string }) => leg.telnyxCallControlId)
    ].filter(Boolean)));

    if (record?.callSession.status !== "ready" && record?.callSession.status !== "processing") {
      if (record?.callSession.mode === "conference_in" || record?.callSession.mode === "sidetone_session") {
        await Promise.allSettled(
          callControlIds.map((callControlId) => hangupCall({ callControlId: String(callControlId) }))
        );
      } else {
        await Promise.allSettled(
          callControlIds.map((callControlId) => stopMediaStreaming({ callControlId: String(callControlId) }))
        );
      }
    }

    await fetchMutation(api.calls.patchCallFromWebhook, {
      workerToken: getWorkerToken(),
      callSessionId: callSessionId as any,
      status: "processing",
      endedAt: Date.now()
    });
    await fetchMutation(api.calls.finalizeCallArtifactFromTranscript, {
      workerToken: getWorkerToken(),
      callSessionId: callSessionId as any
    });
    await fetchAction(api.calls.generateCallArtifactFromTranscript, {
      workerToken: getWorkerToken(),
      callSessionId: callSessionId as any
    });
    await flushPendingStripeMeterEvents().catch((error) => {
      console.warn("Unable to sync Sidetone Stripe meter events.", error);
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof TelnyxRequestError) {
      return NextResponse.json(
        { error: error.message, details: error.responseBody ?? null },
        { status: error.status ?? 502 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to stop notes." },
      { status: 500 }
    );
  }
}
