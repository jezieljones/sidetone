const REQUIRED_ZOOM_RTMS_START_SCOPE = "meeting:update:participant_rtms_app_status";
const ZOOM_RTMS_START_SCOPE_ALIASES = new Set([
  REQUIRED_ZOOM_RTMS_START_SCOPE,
  `${REQUIRED_ZOOM_RTMS_START_SCOPE}:admin`,
  "meeting:write",
  "meeting:write:admin"
]);

type WorkerResponse<T> = {
  ok?: boolean;
  result?: T;
  error?: string;
};

type ZoomOauthForCall = {
  installationId: string;
  zoomClientId?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scopes: string[];
  expiresAt?: number;
} | null;

type ZoomTokenPayload = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  reason?: string;
  message?: string;
  code?: number;
};

function env(name: string, ...fallbackNames: string[]) {
  const value = [name, ...fallbackNames]
    .map((candidate) => process.env[candidate]?.trim())
    .find(Boolean);
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

function optionalEnv(name: string, ...fallbackNames: string[]) {
  return [name, ...fallbackNames]
    .map((candidate) => process.env[candidate]?.trim())
    .find(Boolean);
}

function convexSiteUrl() {
  return env(
    "CONVEX_SITE_URL",
    "NEXT_PUBLIC_CONVEX_SITE_URL",
    "CONVEX_URL",
    "NEXT_PUBLIC_CONVEX_URL"
  )
    .replace(".convex.cloud", ".convex.site")
    .replace(/\/+$/, "");
}

export function zoomRtmsClientId() {
  return env(
    "ZOOM_RTMS_CLIENT_ID",
    "ZM_RTMS_CLIENT",
    "ZOOM_RTMS_CLIENT_ID_DEV",
    "ZOOM_RTMS_CLIENT_ID_PROD"
  );
}

export function zoomRtmsClientSecret() {
  return env(
    "ZOOM_RTMS_CLIENT_SECRET",
    "ZM_RTMS_SECRET",
    "ZOOM_RTMS_CLIENT_SECRET_DEV",
    "ZOOM_RTMS_CLIENT_SECRET_PROD"
  );
}

export function zoomOauthRedirectUri(origin: string) {
  return optionalEnv("ZOOM_OAUTH_REDIRECT_URI") || `${origin}/api/zoom/oauth/callback`;
}

function zoomOauthAuthorizeTemplate(clientId: string) {
  const explicit = optionalEnv("ZOOM_AUTH_URL");
  if (explicit) return explicit;

  const devClientId = optionalEnv("ZOOM_RTMS_CLIENT_ID_DEV");
  if (devClientId && clientId === devClientId) {
    return optionalEnv("ZOOM_DEV_AUTH_URL");
  }

  const prodClientId = optionalEnv("ZOOM_RTMS_CLIENT_ID_PROD");
  if (prodClientId && clientId === prodClientId) {
    return optionalEnv("ZOOM_PROD_AUTH_URL");
  }

  return optionalEnv("ZOOM_DEV_AUTH_URL", "ZOOM_PROD_AUTH_URL");
}

export function zoomOauthAuthorizeUrl(origin: string, state: string) {
  const clientId = zoomRtmsClientId();
  const template = zoomOauthAuthorizeTemplate(clientId);
  const authorizeUrl = new URL(template || "https://zoom.us/oauth/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", zoomOauthRedirectUri(origin));
  authorizeUrl.searchParams.set("state", state);
  return authorizeUrl;
}

function zoomBasicAuth() {
  return `Basic ${Buffer.from(`${zoomRtmsClientId()}:${zoomRtmsClientSecret()}`).toString("base64")}`;
}

async function workerStep<T>(operation: string, body: Record<string, unknown>) {
  const response = await fetch(`${convexSiteUrl()}/call-intelligence/run-step`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env("SIDETONE_WORKER_TOKEN")}`
    },
    body: JSON.stringify({ operation, ...body }),
    cache: "no-store"
  });
  const payload = await response.json().catch(() => null) as WorkerResponse<T> | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? `Unable to run ${operation}.`);
  }
  return payload.result as T;
}

function hasZoomRtmsStartScope(scopes: string[]) {
  return scopes.some((scope) => ZOOM_RTMS_START_SCOPE_ALIASES.has(scope));
}

function normalizeScopes(scope?: string) {
  return scope?.split(/\s+/).map((value) => value.trim()).filter(Boolean);
}

async function refreshZoomAccessToken(installation: NonNullable<ZoomOauthForCall>) {
  if (!installation.refreshToken) {
    throw new Error("Reconnect Zoom from Sources so Sidetone can refresh the Zoom RTMS token.");
  }

  const tokenUrl = new URL("https://zoom.us/oauth/token");
  tokenUrl.searchParams.set("grant_type", "refresh_token");
  tokenUrl.searchParams.set("refresh_token", installation.refreshToken);
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: zoomBasicAuth()
    },
    cache: "no-store"
  });
  const payload = await response.json().catch(() => null) as ZoomTokenPayload | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.reason ?? payload?.error ?? payload?.message ?? "Zoom token refresh failed.");
  }

  await workerStep("zoom-rtms-update-oauth", {
    installationId: installation.installationId,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenType: payload.token_type,
    scopes: normalizeScopes(payload.scope),
    expiresInSeconds: payload.expires_in
  });

  return {
    ...installation,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? installation.refreshToken,
    tokenType: payload.token_type ?? installation.tokenType,
    scopes: normalizeScopes(payload.scope) ?? installation.scopes,
    expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : installation.expiresAt
  };
}

function zoomErrorMessage(status: number, payload: ZoomTokenPayload | null, clientId?: string) {
  const code = payload?.code;
  const message = payload?.message ?? payload?.reason ?? payload?.error;
  if (code === 3000) return "Zoom says that meeting has not started yet.";
  if (code === 2308) {
    return "Zoom only allows the meeting host or an alternative host to start RTMS. Start a meeting hosted by the Zoom account connected in Sidetone, or make that Zoom user an alternative host before the meeting starts.";
  }
  if (code === 13267) return "Zoom RTMS is disabled for this account. Enable Share realtime meeting content with apps in Zoom settings.";
  if (code === 13262) {
    const appHint = clientId ? ` Add the Sidetone app whose client ID starts with ${clientId.slice(0, 8)}.` : "";
    return `Zoom has not authorized this app to access meeting content. In the Zoom web portal, go to Settings > Zoom Apps > Meeting, enable Share realtime meeting content with apps, then choose Sidetone in the apps that can access shared realtime meeting content.${appHint}`;
  }
  if (code === 13273) return "Zoom says this meeting does not support RTMS.";
  if (code === 3001) return "Zoom could not find that meeting.";
  return message ? `Zoom RTMS start failed: ${message}` : `Zoom RTMS start failed with HTTP ${status}.`;
}

async function failZoomRtms(callSessionId: string, error: string) {
  await workerStep("zoom-rtms-failed", { callSessionId, error }).catch(() => null);
}

export async function requestZoomRtmsStart(input: {
  callSessionId: string;
  zoomMeetingId: string;
}) {
  let installation = await workerStep<ZoomOauthForCall>("zoom-rtms-oauth-for-call", {
    callSessionId: input.callSessionId
  });
  if (!installation?.accessToken) {
    const error = "Reconnect Zoom from Sources. Sidetone does not have a stored Zoom token for RTMS.";
    await failZoomRtms(input.callSessionId, error);
    throw new Error(error);
  }
  if (!hasZoomRtmsStartScope(installation.scopes)) {
    const error = `The Zoom app install is missing ${REQUIRED_ZOOM_RTMS_START_SCOPE}. Add that scope in Zoom, then reconnect Zoom from Sources.`;
    await failZoomRtms(input.callSessionId, error);
    throw new Error(error);
  }
  if (installation.expiresAt && installation.expiresAt < Date.now() + 60_000) {
    installation = await refreshZoomAccessToken(installation);
  }

  const clientId = installation.zoomClientId ?? zoomRtmsClientId();
  const response = await fetch(
    `https://api.zoom.us/v2/live_meetings/${encodeURIComponent(input.zoomMeetingId)}/rtms_app/status`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${installation.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "start",
        settings: { client_id: clientId }
      }),
      cache: "no-store"
    }
  );

  if (response.status !== 204) {
    const payload = await response.json().catch(() => null) as ZoomTokenPayload | null;
    const error = zoomErrorMessage(response.status, payload, clientId);
    await failZoomRtms(input.callSessionId, error);
    throw new Error(error);
  }

  await workerStep("zoom-rtms-start-requested", {
    callSessionId: input.callSessionId
  });

  return { status: "rtms_start_requested" as const };
}
