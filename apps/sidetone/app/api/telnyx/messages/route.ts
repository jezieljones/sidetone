import { featureEnabled } from "../../../lib/config";
import { getWorkerToken } from "../../../lib/config";
import { NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { verifyTelnyxWebhookSignature } from "../../../lib/telnyx";

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function deliveryErrorText(errors: unknown) {
  if (!Array.isArray(errors)) {
    return undefined;
  }

  return errors
    .map((error: any) => error?.detail ?? error?.title ?? error?.code)
    .filter(Boolean)
    .join("; ") || undefined;
}

export async function POST(request: Request) {
  if (!featureEnabled("phone")) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const rawBody = await request.text();

  if (!verifyTelnyxWebhookSignature({ headers: request.headers, rawBody })) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const payload = rawBody ? JSON.parse(rawBody) : null;
  const eventType = payload?.data?.event_type ?? payload?.event_type ?? "message.event";

  console.log("Sidetone Telnyx messaging webhook received.", {
    eventType,
    eventId: payload?.data?.id ?? payload?.id
  });

  const event = payload?.data ?? payload ?? {};
  const message = event?.payload ?? event;
  const to = Array.isArray(message?.to) ? message.to[0] : undefined;
  const providerMessageId = firstString(message?.id, message?.message_id);
  const recipientStatus = firstString(to?.status, message?.status);
  const error = deliveryErrorText(message?.errors) ?? deliveryErrorText(to?.errors);

  if (providerMessageId && message?.direction === "outbound") {
    await fetchMutation(api.calls.recordOwnerSummarySmsDeliveryEvent, {
      workerToken: getWorkerToken(),
      providerMessageId,
      eventType,
      recipientStatus,
      error
    });
  }

  return NextResponse.json({ ok: true });
}
