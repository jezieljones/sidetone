import { featureEnabled } from "../../../../lib/config";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import { inngest } from "../../../../inngest/client";
import { getConvexAuthToken } from "../../../../lib/clerk-convex";

function vexaApiBase() {
  return (process.env.VEXA_API_BASE?.trim() || "https://api.cloud.vexa.ai").replace(/\/+$/, "");
}

function vexaApiKey() {
  const key = process.env.VEXA_API_KEY?.trim() || process.env.VEXA_BOT_KEY?.trim();
  if (!key) {
    throw new Error("VEXA_API_KEY or VEXA_BOT_KEY is not configured.");
  }
  return key;
}

function stringField(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim()
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : undefined;
}

export async function POST(request: Request) {
  if (!featureEnabled("vexa")) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const callSessionId = stringField(body?.callSessionId, 80);
  if (!callSessionId) {
    return NextResponse.json({ error: "Missing meeting notes session." }, { status: 400 });
  }

  try {
    const token = await getConvexAuthToken();
    const target = await fetchQuery(api.calls.vexaMeetingStopTarget, {
      callSessionId: callSessionId as any
    }, { token });

    if (target.callStatus === "ready" || target.callStatus === "failed") {
      return NextResponse.json({ ok: true, status: target.callStatus });
    }

    const response = await fetch(
      `${vexaApiBase()}/bots/${encodeURIComponent(target.platform)}/${encodeURIComponent(target.nativeMeetingId)}`,
      {
        method: "DELETE",
        headers: {
          "X-API-Key": vexaApiKey()
        }
      }
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.detail ?? payload?.error ?? `Vexa stop request failed (${response.status}).`);
    }

    await fetchMutation(api.calls.markVexaMeetingStopRequested, {
      callSessionId: callSessionId as any,
      vexaStatus: stringField(payload?.status, 120) ?? "stopping"
    }, { token });

    await inngest.send({
      name: "sidetone/vexa-meeting.requested",
      data: { callSessionId }
    });

    return NextResponse.json({
      ok: true,
      callSessionId,
      platform: target.platform,
      nativeMeetingId: target.nativeMeetingId
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to end meeting notes." },
      { status: 500 }
    );
  }
}
