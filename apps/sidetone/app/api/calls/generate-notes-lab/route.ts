import { auth, currentUser } from "@clerk/nextjs/server";
import { normalizeTuningMode } from "@sidetone/contracts";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { getConvexAuthToken } from "../../../lib/clerk-convex";
import { generateNotesLabArtifact } from "../../../lib/notes-lab-generation";
import { notesLabModelFor } from "../../../lib/notes-lab-models";
import { hasNotesLabAccess } from "../../../lib/notes-lab-access";

const PROMPT_VERSION = "post-call-lab-v1";

function latestSegmentCreatedAt(segments: Array<{ createdAt?: number; endMs?: number }>) {
  return segments.at(-1)?.createdAt ?? segments.at(-1)?.endMs;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const user = await currentUser();
  if (!hasNotesLabAccess(user)) {
    return NextResponse.json({ error: "Notes lab is not enabled for this user." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const callSessionId = String(body?.callSessionId ?? "").trim();
  const provider = String(body?.provider ?? "").trim();
  const modelId = String(body?.modelId ?? "").trim();
  const model = notesLabModelFor(provider, modelId);

  if (!callSessionId) {
    return NextResponse.json({ error: "Missing call session." }, { status: 400 });
  }
  if (!model) {
    return NextResponse.json({ error: "That notes lab model is not available." }, { status: 400 });
  }

  try {
    const token = await getConvexAuthToken();
    const record = await fetchQuery(
      api.calls.callRecordView,
      { callSessionId: callSessionId as any },
      { token }
    );
    const transcript = record.segments.map((segment: { text: string }) => segment.text).join("\n");
    if (!transcript.trim()) {
      return NextResponse.json(
        { error: "Sidetone has not captured transcript for this call yet." },
        { status: 409 }
      );
    }

    const segmentCount = record.segments.length;
    const transcriptLatestSegmentCreatedAt = latestSegmentCreatedAt(record.segments);

    try {
      const artifact = await generateNotesLabArtifact(model, {
        transcript,
        industryProfile: record.callSession.industryProfile ?? "general",
        coachMode: normalizeTuningMode(record.callSession.coachMode),
        startedAt: record.callSession.startedAt
      });
      const saveToken = await getConvexAuthToken();
      const result = await fetchMutation(
        api.calls.recordCallArtifactRun,
        {
          callSessionId: callSessionId as any,
          provider: model.provider,
          modelId: model.modelId,
          modelLabel: `${model.providerLabel} ${model.modelLabel}`,
          artifact,
          promptVersion: PROMPT_VERSION,
          segmentCount,
          latestSegmentCreatedAt: transcriptLatestSegmentCreatedAt,
          status: "ready"
        },
        { token: saveToken }
      );
      const listToken = await getConvexAuthToken();
      const runs = await fetchQuery(
        api.calls.callArtifactRunsForCall,
        { callSessionId: callSessionId as any },
        { token: listToken }
      );
      const run = runs.find((item: any) => item._id === result.runId);
      return NextResponse.json({ ok: true, run });
    } catch (generationError) {
      const error = generationError instanceof Error
        ? generationError.message
        : "Unable to generate lab notes.";
      const saveToken = await getConvexAuthToken();
      const result = await fetchMutation(
        api.calls.recordCallArtifactRun,
        {
          callSessionId: callSessionId as any,
          provider: model.provider,
          modelId: model.modelId,
          modelLabel: `${model.providerLabel} ${model.modelLabel}`,
          promptVersion: PROMPT_VERSION,
          segmentCount,
          latestSegmentCreatedAt: transcriptLatestSegmentCreatedAt,
          error,
          status: "failed"
        },
        { token: saveToken }
      );
      const listToken = await getConvexAuthToken();
      const runs = await fetchQuery(
        api.calls.callArtifactRunsForCall,
        { callSessionId: callSessionId as any },
        { token: listToken }
      );
      const run = runs.find((item: any) => item._id === result.runId);
      return NextResponse.json({ error, run }, { status: 502 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to generate lab notes." },
      { status: 500 }
    );
  }
}
