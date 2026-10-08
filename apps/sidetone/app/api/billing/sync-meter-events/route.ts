import { billingEnabled } from "../../../lib/config";
import { NextResponse } from "next/server";
import { flushPendingStripeMeterEvents } from "../../../lib/billing-meter-events";

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
}

export async function POST(request: Request) {
  if (!billingEnabled()) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const expectedToken = process.env.SIDETONE_WORKER_TOKEN?.trim();
  if (!expectedToken || bearerToken(request) !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await flushPendingStripeMeterEvents();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sync Stripe meter events." },
      { status: 500 }
    );
  }
}
