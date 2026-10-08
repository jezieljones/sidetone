import { featureEnabled } from "../../../../lib/config";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isIndustryProfileId } from "@sidetone/contracts";
import { fetchMutation } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import { inngest } from "../../../../inngest/client";
import { hasAdminAccess } from "../../../../lib/admin-access";
import { getConvexAuthToken } from "../../../../lib/clerk-convex";

type VexaPlatform = "google_meet" | "teams" | "zoom";

type ParsedMeeting = {
  platform: VexaPlatform;
  nativeMeetingId: string;
  passcode?: string;
  meetingUrl?: string;
};

const DEFAULT_VEXA_MAX_WAIT_FOR_ADMISSION_MS = 15 * 60 * 1000;
const DEFAULT_VEXA_NO_ONE_JOINED_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_VEXA_MAX_TIME_LEFT_ALONE_MS = 150 * 1000;
const DEFAULT_VEXA_MAX_BOT_TIME_MS = 2 * 60 * 60 * 1000;

function stringField(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim()
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : undefined;
}

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

function explicitPlatform(input?: string): VexaPlatform | null {
  if (input === "google_meet" || input === "teams" || input === "zoom") {
    return input;
  }
  return null;
}

function urlFromInput(input: string) {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return new URL(trimmed);
  }
  return new URL(`https://${trimmed}`);
}

function parseTeamsPasscode(url: URL) {
  const fromQuery = url.searchParams.get("p");
  if (fromQuery) {
    return fromQuery;
  }
  const hashQuery = url.hash.includes("?") ? url.hash.slice(url.hash.indexOf("?") + 1) : "";
  return hashQuery ? new URLSearchParams(hashQuery).get("p") ?? undefined : undefined;
}

function parseTeamsInviteText(input: string): ParsedMeeting | null {
  const idMatch = input.match(/meeting\s*id\s*[:#]?\s*([0-9][0-9\s-]{8,30}[0-9])/i);
  const passcodeMatch = input.match(/passcode\s*[:#]?\s*([A-Za-z0-9._~!$&'()*+,;=:@%-]{3,120})/i);
  const nativeMeetingId = idMatch?.[1]?.replace(/\D/g, "");
  const passcode = passcodeMatch?.[1];
  if (!nativeMeetingId || !passcode) {
    return null;
  }
  return {
    platform: "teams",
    nativeMeetingId,
    passcode
  };
}

function parseMeetingUrl(input: string): ParsedMeeting {
  const embeddedUrl = input.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  const teamsInvite = parseTeamsInviteText(input);
  if (teamsInvite && (!embeddedUrl || embeddedUrl.includes("teams."))) {
    return teamsInvite;
  }

  if (embeddedUrl) {
    input = embeddedUrl;
  }

  const url = urlFromInput(input);
  const host = url.hostname.toLowerCase();
  const path = decodeURIComponent(url.pathname);

  if (host === "meet.google.com") {
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "lookup") {
      throw new Error("Use the standard Google Meet link, not a /lookup/ redirect.");
    }
    const nativeMeetingId = parts[0];
    if (!nativeMeetingId) {
      throw new Error("Google Meet link is missing a meeting code.");
    }
    return {
      platform: "google_meet",
      nativeMeetingId,
      meetingUrl: url.toString()
    };
  }

  if (
    host.endsWith("teams.live.com")
    || host.endsWith("teams.microsoft.com")
    || host.endsWith("teams.microsoft.us")
    || host.endsWith("teams.cloud.microsoft")
  ) {
    if (path.includes("/l/meetup-join/")) {
      throw new Error("Use a Teams link with a numeric meeting ID and p= passcode, or paste the invite text with Meeting ID and Passcode.");
    }
    const source = `${path}${url.search}${decodeURIComponent(url.hash)}`;
    const meetingMatch = source.match(/\/meet\/(\d{10,15})/);
    const nativeMeetingId = meetingMatch?.[1];
    if (!nativeMeetingId) {
      throw new Error("Teams link is missing the numeric meeting ID.");
    }
    const passcode = parseTeamsPasscode(url);
    if (!passcode) {
      throw new Error("Teams links need the p= passcode.");
    }
    return {
      platform: "teams",
      nativeMeetingId,
      passcode,
      meetingUrl: url.toString()
    };
  }

  if (host.includes("zoom.us") || host.includes("zoomgov.com")) {
    const meetingMatch = path.match(/\/(?:j|wc\/join)\/(\d{9,11})/);
    const nativeMeetingId = meetingMatch?.[1];
    if (!nativeMeetingId) {
      throw new Error("Zoom link is missing the numeric meeting ID.");
    }
    return {
      platform: "zoom",
      nativeMeetingId,
      passcode: url.searchParams.get("pwd") ?? undefined,
      meetingUrl: url.toString()
    };
  }

  throw new Error("Use a Google Meet or Microsoft Teams meeting link.");
}

function parseBody(body: any): ParsedMeeting {
  const platform = explicitPlatform(body?.platform);
  const nativeMeetingId = stringField(body?.nativeMeetingId, 240);
  if (platform && nativeMeetingId) {
    return {
      platform,
      nativeMeetingId,
      passcode: stringField(body?.passcode, 120),
      meetingUrl: stringField(body?.meetingUrl, 500)
    };
  }

  const meetingUrl = stringField(body?.meetingUrl, 500);
  if (!meetingUrl) {
    throw new Error("Paste a meeting link.");
  }
  return parseMeetingUrl(meetingUrl);
}

function numericId(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function positiveIntegerEnv(name: string, fallback: number) {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
}

function vexaAutomaticLeaveConfig() {
  return {
    max_wait_for_admission: positiveIntegerEnv(
      "VEXA_MAX_WAIT_FOR_ADMISSION_MS",
      DEFAULT_VEXA_MAX_WAIT_FOR_ADMISSION_MS
    ),
    no_one_joined_timeout: positiveIntegerEnv(
      "VEXA_NO_ONE_JOINED_TIMEOUT_MS",
      DEFAULT_VEXA_NO_ONE_JOINED_TIMEOUT_MS
    ),
    max_time_left_alone: positiveIntegerEnv(
      "VEXA_MAX_TIME_LEFT_ALONE_MS",
      DEFAULT_VEXA_MAX_TIME_LEFT_ALONE_MS
    ),
    max_bot_time: positiveIntegerEnv(
      "VEXA_MAX_BOT_TIME_MS",
      DEFAULT_VEXA_MAX_BOT_TIME_MS
    )
  };
}

export async function POST(request: Request) {
  if (!featureEnabled("vexa")) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const user = await currentUser();
  if (!hasAdminAccess(user)) {
    return NextResponse.json({ error: "Meeting sources are in admin testing." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  let parsed: ParsedMeeting;
  try {
    parsed = parseBody(body);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid meeting link." },
      { status: 400 }
    );
  }

  const requestedIndustryProfile = stringField(body?.industryProfile, 80);
  const botName = stringField(body?.botName, 120) ?? process.env.VEXA_BOT_NAME?.trim() ?? "Sidetone Notes";
  const language = stringField(body?.language, 24);

  const token = await getConvexAuthToken();
  const created = await fetchMutation(api.calls.createVexaMeetingCall, {
    platform: parsed.platform,
    nativeMeetingId: parsed.nativeMeetingId,
    meetingUrl: parsed.meetingUrl,
    botName,
    language,
    entityName: stringField(body?.entityName, 160),
    callFocusText: stringField(body?.listenFor, 500),
    industryProfile: isIndustryProfileId(requestedIndustryProfile)
      ? requestedIndustryProfile
      : undefined
  } as any, { token });

  try {
    const response = await fetch(`${vexaApiBase()}/bots`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": vexaApiKey()
      },
      body: JSON.stringify({
        platform: parsed.platform,
        native_meeting_id: parsed.nativeMeetingId,
        ...(parsed.meetingUrl ? { meeting_url: parsed.meetingUrl } : {}),
        ...(parsed.passcode ? { passcode: parsed.passcode } : {}),
        bot_name: botName,
        ...(language ? { language } : {}),
        recording_enabled: true,
        transcribe_enabled: true,
        transcription_tier: "realtime",
        voice_agent_enabled: false,
        automatic_leave: vexaAutomaticLeaveConfig()
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.detail ?? payload?.error ?? `Vexa bot request failed (${response.status}).`);
    }

    await fetchMutation(api.calls.markVexaMeetingBotRequested, {
      callSessionId: created.callSessionId,
      vexaMeetingId: numericId(payload?.id),
      vexaStatus: stringField(payload?.status, 120)
    }, { token });

    await inngest.send({
      name: "sidetone/vexa-meeting.requested",
      data: {
        callSessionId: String(created.callSessionId)
      }
    });

    return NextResponse.json({
      ok: true,
      callSessionId: created.callSessionId,
      platform: parsed.platform,
      nativeMeetingId: parsed.nativeMeetingId
    });
  } catch (error) {
    await fetchMutation(api.calls.markVexaMeetingRequestFailed, {
      callSessionId: created.callSessionId,
      error: error instanceof Error ? error.message : "Unable to start the meeting bot."
    }, { token }).catch(() => null);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start the meeting bot." },
      { status: 502 }
    );
  }
}
