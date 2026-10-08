import { featureEnabled } from "../../../../lib/config";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import { getConvexAuthToken } from "../../../../lib/clerk-convex";
import { zoomOauthRedirectUri, zoomRtmsClientId, zoomRtmsClientSecret } from "../../../../lib/zoom-rtms";

function htmlResponse(title: string, body: string, status = 200) {
  return new NextResponse(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { background: #071422; color: #f8fafc; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; }
      main { display: grid; min-height: 100vh; place-items: center; padding: 24px; }
      section { max-width: 560px; border: 1px solid rgba(148, 163, 184, 0.28); background: rgba(15, 23, 42, 0.82); padding: 28px; }
      h1 { font-size: 28px; line-height: 1.15; margin: 0 0 12px; }
      p { color: #cbd5e1; font-size: 16px; line-height: 1.65; margin: 0 0 18px; }
      a { color: #7dd3fc; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>${title}</h1>
        ${body}
      </section>
    </main>
  </body>
</html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8"
    }
  });
}

function clearZoomOauthCookies(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  cookieStore.delete("sidetone_zoom_oauth_state");
  cookieStore.delete("sidetone_zoom_oauth_origin");
}

function zoomTokenExchangeError(payload: { error?: string; reason?: string } | null) {
  const message = payload?.reason ?? payload?.error ?? "Zoom token exchange failed.";
  if (/invalid authorization code/i.test(message)) {
    return "That Zoom authorization code was already used, expired, or was issued for a different Zoom app client. Start the Zoom connection again from Sidetone Sources and do not refresh or reuse the callback tab.";
  }
  return message;
}

export async function GET(request: Request) {
  if (!featureEnabled("zoom")) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return htmlResponse(
      "Zoom authorization was cancelled.",
      `<p>Zoom returned: ${error}</p><p><a href="/dashboard">Back to Sidetone</a></p>`,
      400
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("sidetone_zoom_oauth_state")?.value;
  const oauthOrigin = cookieStore.get("sidetone_zoom_oauth_origin")?.value ?? url.origin;
  if (!code) {
    clearZoomOauthCookies(cookieStore);
    return htmlResponse(
      "Zoom did not return an authorization code.",
      `<p>Start the Zoom install flow again from the Zoom Marketplace app page.</p><p><a href="/dashboard">Back to Sidetone</a></p>`,
      400
    );
  }
  if (state || expectedState) {
    if (!state || !expectedState || state !== expectedState) {
      clearZoomOauthCookies(cookieStore);
      return htmlResponse(
        "Zoom connection failed.",
        `<p>The Zoom authorization state did not match. Start the Zoom connection again from Sidetone Sources.</p><p><a href="/sources">Back to Sources</a></p>`,
        400
      );
    }
  }

  try {
    const { userId } = await auth();
    if (!userId) {
      const signInUrl = new URL("/sign-in", url.origin);
      signInUrl.searchParams.set("redirect_url", `/api/zoom/oauth/callback?${url.searchParams.toString()}`);
      return NextResponse.redirect(signInUrl);
    }
    clearZoomOauthCookies(cookieStore);

    const clientId = zoomRtmsClientId();
    const clientSecret = zoomRtmsClientSecret();
    const redirectUri = zoomOauthRedirectUri(oauthOrigin);
    const tokenUrl = new URL("https://zoom.us/oauth/token");
    tokenUrl.searchParams.set("grant_type", "authorization_code");
    tokenUrl.searchParams.set("code", code);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
      },
      cache: "no-store"
    });
    const payload = await tokenResponse.json().catch(() => null) as {
      access_token?: string;
      refresh_token?: string;
      token_type?: string;
      scope?: string;
      expires_in?: number;
      error?: string;
      reason?: string;
    } | null;
    if (!tokenResponse.ok) {
      throw new Error(zoomTokenExchangeError(payload));
    }
    if (!payload?.access_token || !payload.refresh_token) {
      throw new Error("Zoom did not return the OAuth tokens Sidetone needs. Start the Zoom connection again from Sources.");
    }

    const convexToken = await getConvexAuthToken();
    await fetchMutation(api.entities.linkZoomInstallation, {
      zoomClientId: clientId,
      accessToken: payload?.access_token,
      refreshToken: payload?.refresh_token,
      tokenType: payload?.token_type,
      scopes: payload?.scope?.split(/\s+/).filter(Boolean),
      expiresInSeconds: payload?.expires_in
    }, { token: convexToken });

    return htmlResponse(
      "Zoom is connected.",
      `<p>Sidetone can now receive authorized Zoom RTMS streams for this Zoom user. You can close this tab and return to Sidetone.</p><p><a href="${oauthOrigin}/sources">Open Sidetone sources</a></p>`
    );
  } catch (err) {
    return htmlResponse(
      "Zoom connection failed.",
      `<p>${err instanceof Error ? err.message : "Sidetone could not finish the Zoom OAuth callback."}</p><p><a href="/dashboard">Back to Sidetone</a></p>`,
      500
    );
  }
}
