import { featureEnabled } from "../../../../lib/config";
import crypto from "node:crypto";
import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminAccess } from "../../../../lib/admin-access";
import { zoomOauthAuthorizeUrl } from "../../../../lib/zoom-rtms";

export async function GET(request: Request) {
  if (!featureEnabled("zoom")) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const { userId } = await auth();
  if (!userId) {
    const redirect = new URL("/sign-in", request.url);
    redirect.searchParams.set("redirect_url", "/api/zoom/oauth/start");
    return NextResponse.redirect(redirect);
  }
  const user = await currentUser();
  if (!hasAdminAccess(user)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const origin = new URL(request.url).origin;
  const state = crypto.randomBytes(24).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set("sidetone_zoom_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    maxAge: 10 * 60,
    path: "/"
  });
  cookieStore.set("sidetone_zoom_oauth_origin", origin, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    maxAge: 10 * 60,
    path: "/"
  });

  return NextResponse.redirect(zoomOauthAuthorizeUrl(origin, state));
}
