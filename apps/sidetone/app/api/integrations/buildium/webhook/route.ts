import { featureEnabled } from "../../../../lib/config";
import { NextResponse } from "next/server";
import { verifyBuildiumWebhookSignature } from "../../../../lib/buildium";

export async function POST(request: Request) {
  if (!featureEnabled("integrations")) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const body = await request.text();
  const secret = process.env.SIDETONE_BUILDIUM_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "Buildium webhook secret is not configured." }, { status: 503 });
  }
  const valid = verifyBuildiumWebhookSignature({
    body,
    timestamp: request.headers.get("buildium-webhook-timestamp"),
    signature: request.headers.get("buildium-webhook-signature"),
    secret
  });
  if (!valid) {
    return NextResponse.json({ error: "Invalid Buildium webhook signature." }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
