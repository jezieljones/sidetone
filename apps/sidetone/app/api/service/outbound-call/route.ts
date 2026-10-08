import { featureEnabled } from "../../../lib/config";
import { getWorkerToken } from "../../../lib/config";
import { timingSafeEqual } from "node:crypto";
import { fetchMutation } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import {
  friendlyCallThroughFailure,
  startCallThrough,
  TelnyxConfigurationError,
  TelnyxRequestError
} from "../../../lib/telnyx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePhone(input?: string | null) {
  if (!input) return "";
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return input.trim();
}

function authorized(request: Request) {
  const expected = process.env.SIDETONE_SERVICE_TOKEN?.trim();
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!provided || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export async function POST(request: Request) {
  if (!featureEnabled("integrations")) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const toPhoneNumber = normalizePhone(String(body?.toPhoneNumber ?? ""));
  const operatorPhoneNumber = body?.operatorPhoneNumber ? normalizePhone(String(body.operatorPhoneNumber)) : undefined;
  const contactName = typeof body?.contactName === "string" ? body.contactName.slice(0, 120) : undefined;
  const callFocusText = typeof body?.callFocusText === "string"
    ? body.callFocusText.replace(/\s+/g, " ").trim().slice(0, 500)
    : undefined;
  const externalRef = body?.externalRef ?? {};
  const externalSource = typeof externalRef?.source === "string" ? externalRef.source : "";
  const externalId = typeof externalRef?.externalId === "string" ? externalRef.externalId : "";
  const callbackUrl = typeof externalRef?.callbackUrl === "string" ? externalRef.callbackUrl : "";

  if (!toPhoneNumber || !externalSource || !externalId || !callbackUrl) {
    return NextResponse.json(
      { error: "Missing toPhoneNumber or externalRef {source, externalId, callbackUrl}." },
      { status: 400 }
    );
  }
  if (!/^https:\/\//.test(callbackUrl) && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "callbackUrl must be https." }, { status: 400 });
  }

  try {
    const created = await fetchMutation(api.calls.createServiceCallThroughSession, {
      serviceToken: process.env.SIDETONE_SERVICE_TOKEN!.trim(),
      toPhoneNumber,
      operatorPhoneNumber: operatorPhoneNumber || undefined,
      contactName,
      callFocusText,
      externalSource,
      externalId,
      callbackUrl,
      externalMetadata: externalRef?.metadata
    });

    const telnyxCall = await startCallThrough({
      fromPhoneNumber: created.fromPhoneNumber,
      toPhoneNumber: created.ownerPhoneNumber,
      callSessionId: String(created.callSessionId),
      legRole: "owner",
      answeringMachineDetection: "premium"
    });

    await fetchMutation(api.calls.patchCallFromWebhook, {
      workerToken: getWorkerToken(),
      callSessionId: created.callSessionId,
      status: "connecting",
      telnyxCallControlId: telnyxCall.callControlId,
      telnyxCallSessionId: telnyxCall.callSessionId
    });

    return NextResponse.json({
      callSessionId: created.callSessionId,
      ownerPhoneNumber: created.ownerPhoneNumber,
      status: "connecting"
    });
  } catch (error) {
    if (error instanceof TelnyxConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof TelnyxRequestError) {
      return NextResponse.json({ error: friendlyCallThroughFailure(error) }, { status: error.status ?? 502 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start service call." },
      { status: 500 }
    );
  }
}
