import crypto from "node:crypto";

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_PUBLIC_KEY_DER_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const DISCORD_BOT_PERMISSIONS = "2184186880";

function trimTrailingSlash(value?: string | null) {
  return value?.trim().replace(/\/+$/, "") || null;
}

export type DiscordInteractionOption = {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordInteractionOption[];
};

export type DiscordInteraction = {
  id: string;
  application_id?: string;
  type: number;
  token?: string;
  guild_id?: string;
  guild?: {
    id?: string;
    name?: string;
  };
  member?: {
    user?: {
      id?: string;
      username?: string;
      global_name?: string | null;
    };
  };
  user?: {
    id?: string;
    username?: string;
    global_name?: string | null;
  };
  data?: {
    name?: string;
    options?: DiscordInteractionOption[];
  };
};

export function discordEnv() {
  return {
    applicationId: process.env.DISCORD_APPLICATION_ID?.trim() || null,
    publicKey: process.env.DISCORD_PUBLIC_KEY?.trim() || null,
    clientSecret: process.env.DISCORD_CLIENT_SECRET?.trim() || null,
    botToken: process.env.DISCORD_BOT_TOKEN?.trim() || null,
    appUrl: trimTrailingSlash(process.env.NEXT_PUBLIC_APP_URL) ?? trimTrailingSlash(process.env.SIDETONE_APP_URL) ?? "http://localhost:3000",
    convexSiteUrl: trimTrailingSlash(process.env.CONVEX_SITE_URL) ?? trimTrailingSlash(process.env.NEXT_PUBLIC_CONVEX_SITE_URL),
    workerToken: process.env.SIDETONE_WORKER_TOKEN?.trim() || null,
    enabled: process.env.SIDETONE_DISCORD_ENABLED === "true"
  };
}

export function discordJson(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
}

export function interactionResponse(content: string, ephemeral = true) {
  return discordJson({
    type: 4,
    data: {
      content,
      flags: ephemeral ? 64 : undefined
    }
  });
}

export function verifyDiscordInteractionSignature(input: {
  bodyText: string;
  signature: string | null;
  timestamp: string | null;
  publicKey: string | null;
}) {
  if (!input.publicKey || !input.signature || !input.timestamp) {
    return false;
  }

  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([
        DISCORD_PUBLIC_KEY_DER_PREFIX,
        Buffer.from(input.publicKey, "hex")
      ]),
      format: "der",
      type: "spki"
    });
    return crypto.verify(
      null,
      Buffer.from(`${input.timestamp}${input.bodyText}`),
      key,
      Buffer.from(input.signature, "hex")
    );
  } catch {
    return false;
  }
}

export function topSubcommand(options?: DiscordInteractionOption[]) {
  return options?.find((option) => option.type === 1) ?? null;
}

export function optionString(options: DiscordInteractionOption[] | undefined, name: string) {
  const value = options?.find((option) => option.name === name)?.value;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function runDiscordConvexStep(operation: string, body: Record<string, unknown>) {
  const env = discordEnv();
  if (!env.convexSiteUrl || !env.workerToken) {
    throw new Error("Discord worker bridge is not configured.");
  }

  const response = await fetch(`${env.convexSiteUrl}/call-intelligence/run-step`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.workerToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      operation,
      ...body
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? "Discord worker bridge failed.");
  }
  return payload?.result;
}

export async function discordApiFetch<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(init.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error_description ?? payload?.message ?? "Discord API request failed.");
  }
  return payload as T;
}

export function discordInstallUrl(state: string, appUrl = discordEnv().appUrl) {
  const env = discordEnv();
  if (!env.applicationId) {
    throw new Error("Discord application is not configured.");
  }
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", env.applicationId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", `${appUrl}/api/discord/oauth/callback`);
  url.searchParams.set("scope", "bot applications.commands identify guilds");
  url.searchParams.set("permissions", DISCORD_BOT_PERMISSIONS);
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");
  return url;
}
