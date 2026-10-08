import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "sidetone-web",
    convex: Boolean(process.env.NEXT_PUBLIC_CONVEX_URL),
    clerk: Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY),
    telnyx: Boolean(process.env.TELNYX_API_KEY && process.env.TELNYX_CALL_CONTROL_CONNECTION_ID),
    realtime: Boolean(process.env.SIDETONE_REALTIME_URL || process.env.TELNYX_MEDIA_STREAM_URL),
    assemblyai: Boolean(process.env.ASSEMBLYAI_API_KEY),
    postCallAi: Boolean(process.env.OPENAI_API_KEY)
  });
}
