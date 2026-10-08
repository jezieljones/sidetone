import { auth } from "@clerk/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import { getConvexAuthToken } from "../../../../lib/clerk-convex";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { id } = await params;
  const token = await getConvexAuthToken();
  const result = await fetchAction(
    api.calls.sendMergeReminderSms,
    { callSessionId: id as any },
    { token }
  );

  return NextResponse.json(result);
}
