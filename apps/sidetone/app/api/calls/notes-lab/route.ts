import { auth, currentUser } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { getConvexAuthToken } from "../../../lib/clerk-convex";
import { hasNotesLabAccess } from "../../../lib/notes-lab-access";

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const user = await currentUser();
  if (!hasNotesLabAccess(user)) {
    return NextResponse.json({ error: "Notes lab is not enabled for this user." }, { status: 403 });
  }

  const url = new URL(request.url);
  const callSessionId = url.searchParams.get("callSessionId")?.trim();
  if (!callSessionId) {
    return NextResponse.json({ error: "Missing call session." }, { status: 400 });
  }

  try {
    const token = await getConvexAuthToken();
    const runs = await fetchQuery(
      api.calls.callArtifactRunsForCall,
      { callSessionId: callSessionId as any },
      { token }
    );
    return NextResponse.json({ runs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load lab notes." },
      { status: 500 }
    );
  }
}
