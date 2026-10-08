import { billingEnabled, featureEnabled } from "./app/lib/config";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/calls/live/demo",
  "/api/billing/sync-meter-events"
]);

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/sources(.*)",
  "/integrations(.*)",
  "/admin(.*)",
  "/settings(.*)",
  "/calls(.*)",
  "/subscriptions(.*)",
  "/intelligence(.*)",
  "/api/calls(.*)",
  "/api/meetings(.*)",
  "/api/billing(.*)",
  "/api/admin(.*)",
  "/api/diagnostics/readiness",
  "/api/integrations(.*)",
  "/api/sidetone/activation",
  "/api/sidetone/contact",
  "/api/sidetone/home",
  "/api/sidetone/preferences",
  "/api/telnyx/available-numbers",
  "/api/telnyx/call-through",
  "/api/telnyx/end-call",
  "/api/telnyx/provision-number",
  "/api/telnyx/start-session",
  "/api/telnyx/stop-notes"
]);

const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY
    && process.env.NEXT_PUBLIC_CONVEX_URL
);

const proxy = clerkConfigured
  ? clerkMiddleware(async (auth, req) => {
      const path = req.nextUrl.pathname;
      const disabled = (path.startsWith("/api/telnyx/") && !featureEnabled("phone"))
        || ((path.startsWith("/api/zoom/") || path.startsWith("/api/meetings/zoom")) && !featureEnabled("zoom"))
        || (path.startsWith("/api/meetings/vexa/") && !featureEnabled("vexa"))
        || (path.startsWith("/api/discord/") && !featureEnabled("discord"))
        || ((path.startsWith("/api/integrations/") || path.startsWith("/integrations") || path.startsWith("/api/service/")) && !featureEnabled("integrations"))
        || ((path.startsWith("/api/billing/") || path.startsWith("/api/stripe/")) && !billingEnabled());
      if (disabled) return NextResponse.json({ error: "This feature is disabled for this installation." }, { status: 404 });

      if (isPublicRoute(req) || !isProtectedRoute(req)) {
        return;
      }

      const { userId } = await auth();
      if (userId) {
        return;
      }

      if (req.nextUrl.pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
      }

      const signInUrl = new URL("/sign-in", req.url);
      signInUrl.searchParams.set("redirect_url", `${req.nextUrl.pathname}${req.nextUrl.search}`);
      return NextResponse.redirect(signInUrl);
    })
  : (req: import("next/server").NextRequest) => {
      if (req.nextUrl.pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Complete installation setup before using the API." }, { status: 503 });
      }
      if (isProtectedRoute(req) || req.nextUrl.pathname === "/sign-in") {
        return NextResponse.redirect(new URL("/setup", req.url));
      }
      return NextResponse.next();
    };

export default proxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/sign-in",
    "/admin/:path*",
    "/dashboard/:path*",
    "/sources/:path*",
    "/integrations/:path*",
    "/subscriptions/:path*",
    "/intelligence/:path*",
    "/api/calls/:path*",
    "/api/meetings/:path*",
    "/api/admin/:path*",
    "/api/billing/:path*",
    "/api/diagnostics/readiness",
    "/api/integrations/:path*",
    "/api/sidetone/activation",
    "/api/sidetone/contact",
    "/api/sidetone/home",
    "/api/sidetone/preferences",
    "/api/telnyx/available-numbers",
    "/api/telnyx/provision-number",
    "/api/telnyx/call-through",
    "/api/telnyx/end-call",
    "/api/telnyx/start-session",
    "/api/telnyx/stop-notes"
  ]
};
