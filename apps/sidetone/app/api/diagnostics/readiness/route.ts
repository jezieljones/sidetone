import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getCallControlApplicationStatus, telnyxConfigSummary } from "../../../lib/telnyx";

type ReadinessStatus = "ready" | "warning" | "blocked";

function env(name: string) {
  return process.env[name]?.trim();
}

function statusFor(value: boolean, warning = false): ReadinessStatus {
  if (value) {
    return "ready";
  }
  return warning ? "warning" : "blocked";
}

async function realtimeHealth(): Promise<{
  key: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
}> {
  const realtimeUrl = env("SIDETONE_REALTIME_URL");
  if (!realtimeUrl) {
    return {
      key: "realtime",
      label: "Realtime listener",
      status: "warning",
      detail: "SIDETONE_REALTIME_URL is not set. Calls can be created, but live notes will not stream yet."
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${realtimeUrl.replace(/\/$/, "")}/health`, {
      cache: "no-store",
      signal: controller.signal
    });
    return {
      key: "realtime",
      label: "Realtime listener",
      status: response.ok ? "ready" : "warning",
      detail: response.ok
        ? "Realtime service health endpoint is reachable."
        : `Realtime service returned HTTP ${response.status}.`
    };
  } catch (error) {
    return {
      key: "realtime",
      label: "Realtime listener",
      status: "warning",
      detail: error instanceof Error ? error.message : "Realtime service health check failed."
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callControlOutboundHealth(): Promise<{
  key: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
}> {
  try {
    const application = await getCallControlApplicationStatus();
    if (!application) {
      return {
        key: "telnyx-outbound",
        label: "Outbound calling",
        status: "blocked",
        detail: "Set TELNYX_API_KEY and TELNYX_CALL_CONTROL_CONNECTION_ID before starting outbound calls."
      };
    }

    return {
      key: "telnyx-outbound",
      label: "Outbound calling",
      status: application.outboundVoiceProfileId ? "ready" : "blocked",
      detail: application.outboundVoiceProfileId
        ? `Call Control app ${application.name ?? application.id} has an outbound voice profile.`
        : `Call Control app ${application.name ?? application.id} is missing an outbound voice profile. Call-through will fail until one is attached.`
    };
  } catch (error) {
    return {
      key: "telnyx-outbound",
      label: "Outbound calling",
      status: "warning",
      detail: error instanceof Error ? error.message : "Unable to verify outbound calling setup."
    };
  }
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const telnyx = telnyxConfigSummary();
  const items = [
    {
      key: "clerk",
      label: "Owner auth",
      status: statusFor(Boolean(env("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") && env("CLERK_SECRET_KEY"))),
      detail: env("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") && env("CLERK_SECRET_KEY")
        ? "Owner auth is configured."
        : "Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY."
    },
    {
      key: "convex",
      label: "Convex",
      status: statusFor(Boolean(env("NEXT_PUBLIC_CONVEX_URL") && env("CLERK_JWT_ISSUER_DOMAIN"))),
      detail: env("NEXT_PUBLIC_CONVEX_URL") && env("CLERK_JWT_ISSUER_DOMAIN")
        ? "Convex URL and Clerk JWT issuer are configured."
        : "Set NEXT_PUBLIC_CONVEX_URL and CLERK_JWT_ISSUER_DOMAIN."
    },
    {
      key: "telnyx-api",
      label: "Telnyx API",
      status: statusFor(telnyx.hasApiKey),
      detail: telnyx.hasApiKey
        ? "Telnyx API key is present."
        : "Set TELNYX_API_KEY before searching or ordering numbers."
    },
    {
      key: "telnyx-connection",
      label: "Call Control connection",
      status: statusFor(Boolean(telnyx.callControlConnectionId)),
      detail: telnyx.callControlConnectionId
        ? "Calls can be attached to the configured Call Control application."
        : "Set TELNYX_CALL_CONTROL_CONNECTION_ID."
    },
    await callControlOutboundHealth(),
    {
      key: "public-url",
      label: "Public webhook URL",
      status: statusFor(Boolean(telnyx.callControlWebhookUrl), process.env.NODE_ENV !== "production"),
      detail: telnyx.callControlWebhookUrl
        ? `Call Control webhooks route to ${telnyx.callControlWebhookUrl}.`
        : "Set SIDETONE_PUBLIC_BASE_URL or TELNYX_CALL_CONTROL_WEBHOOK_URL for live Telnyx testing."
    },
    {
      key: "telnyx-signature",
      label: "Webhook signatures",
      status: statusFor(telnyx.publicKeyConfigured, process.env.NODE_ENV !== "production"),
      detail: telnyx.publicKeyConfigured
        ? "Telnyx webhook signature verification is enabled."
        : "Set TELNYX_PUBLIC_KEY before production webhooks."
    },
    await realtimeHealth()
  ];

  return NextResponse.json({ items, telnyx });
}
