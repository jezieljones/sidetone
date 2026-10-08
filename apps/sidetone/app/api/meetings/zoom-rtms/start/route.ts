import { featureEnabled } from "../../../../lib/config";
import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { isIndustryProfileId } from "@sidetone/contracts";
import { api } from "../../../../../convex/_generated/api";
import { hasAdminAccess } from "../../../../lib/admin-access";
import { getConvexAuthToken } from "../../../../lib/clerk-convex";
import { requestZoomRtmsStart } from "../../../../lib/zoom-rtms";

function stringField(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim()
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : undefined;
}

function parseZoomMeeting(input: unknown) {
  const raw = stringField(input, 1000);
  if (!raw) {
    throw new Error("Enter a Zoom meeting link or meeting ID.");
  }

  const directId = raw.replace(/\s+/g, "").match(/^\d{9,15}$/)?.[0];
  if (directId) {
    return { zoomMeetingId: directId, meetingUrl: undefined };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter a valid Zoom meeting link or numeric meeting ID.");
  }

  const host = url.hostname.toLowerCase();
  const zoomHost = host.endsWith("zoom.us")
    || host.endsWith(".zoom.us")
    || host.endsWith("zoomgov.com")
    || host.endsWith(".zoomgov.com");
  if (!zoomHost) {
    throw new Error("Zoom RTMS currently needs a Zoom meeting link.");
  }

  const idFromPath = url.pathname.match(/\/(?:j|wc)\/(\d{9,15})/)?.[1]
    ?? url.pathname.match(/\/(\d{9,15})(?:\/|$)/)?.[1];
  const idFromQuery = url.searchParams.get("confno")?.match(/\d{9,15}/)?.[0]
    ?? url.searchParams.get("meeting_id")?.match(/\d{9,15}/)?.[0];
  const zoomMeetingId = idFromPath ?? idFromQuery;
  if (!zoomMeetingId) {
    throw new Error("Unable to find the Zoom meeting ID in that link.");
  }

  return { zoomMeetingId, meetingUrl: raw };
}

function industryProfileField(value: unknown) {
  const profile = stringField(value, 80);
  return isIndustryProfileId(profile) ? profile : undefined;
}

export async function POST(request: Request) {
  if (!featureEnabled("zoom")) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to add a Zoom meeting." }, { status: 401 });
  }
  const user = await currentUser();
  if (!hasAdminAccess(user)) {
    return NextResponse.json({ error: "Meeting sources are in admin testing." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  try {
    const parsed = parseZoomMeeting(body?.meetingUrl);
    const token = await getConvexAuthToken();
    const authorization = await fetchQuery(api.calls.zoomRtmsStartAuthorization, {}, { token });
    if (!authorization.ok) {
      return NextResponse.json(
        { error: authorization.error, code: authorization.code },
        { status: 400 }
      );
    }

    const result = await fetchMutation(api.calls.createZoomRtmsMeetingCall, {
      zoomMeetingId: parsed.zoomMeetingId,
      meetingUrl: parsed.meetingUrl,
      industryProfile: industryProfileField(body?.industryProfile),
      callFocusText: stringField(body?.listenFor, 500)
    }, { token });
    const zoomStart = await requestZoomRtmsStart({
      callSessionId: result.callSessionId,
      zoomMeetingId: parsed.zoomMeetingId
    });

    return NextResponse.json({
      ok: true,
      callSessionId: result.callSessionId,
      captureId: result.captureId,
      zoomMeetingId: parsed.zoomMeetingId,
      status: zoomStart.status
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to add this Zoom meeting." },
      { status: 400 }
    );
  }
}
