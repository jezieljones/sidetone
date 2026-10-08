import { auth } from "@clerk/nextjs/server";
import { fetchAction, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { flushPendingStripeMeterEvents } from "../../../lib/billing-meter-events";
import { getConvexAuthToken } from "../../../lib/clerk-convex";

export async function POST(request: Request) {
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
    const transcript = record.segments.map((segment: { text: string }) => segment.text).join("\n");
    if (!transcript.trim()) {
      return NextResponse.json(
        { error: "Sidetone has not captured transcript for this call yet." },
        { status: 409 }
      );
    }

    const result = await fetchAction(api.calls.generateCallArtifactFromTranscript, {
      callSessionId: callSessionId as any
    }, { token });
    await flushPendingStripeMeterEvents().catch((error) => {
      console.warn("Unable to sync Sidetone Stripe meter events.", error);
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to generate notes." },
      { status: 500 }
    );
  }
}
