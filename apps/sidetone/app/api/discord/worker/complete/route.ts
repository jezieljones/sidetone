import { featureEnabled } from "../../../../lib/config";
import { NextResponse } from "next/server";
import { inngest } from "../../../../inngest/client";
import { discordEnv, runDiscordConvexStep } from "../../../../lib/discord";

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
}

export async function POST(request: Request) {
  if (!featureEnabled("discord")) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const env = discordEnv();
  if (!env.workerToken || bearerToken(request) !== env.workerToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.captureId || !body?.workerSessionId || !body?.storageId) {
    return NextResponse.json({ error: "Missing Discord capture completion payload." }, { status: 400 });
  }

  try {
    const result = await runDiscordConvexStep("discord-complete-capture", {
      captureId: body.captureId,
      workerSessionId: body.workerSessionId,
      storageId: body.storageId,
      fileName: typeof body.fileName === "string" ? body.fileName : "discord-voice.webm",
      mimeType: typeof body.mimeType === "string" ? body.mimeType : "audio/webm",
      sizeBytes: typeof body.sizeBytes === "number" ? body.sizeBytes : 0,
      durationMs: typeof body.durationMs === "number" ? body.durationMs : undefined,
      participantCount: typeof body.participantCount === "number" ? body.participantCount : undefined
    });

    if (result?.callSessionId) {
      await inngest.send({
        name: "sidetone/recording-upload.requested",
        data: {
          callSessionId: String(result.callSessionId)
        }
      });
    }

    return NextResponse.json({ ok: true, callSessionId: result?.callSessionId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to complete Discord capture." },
      { status: 500 }
    );
  }
}
