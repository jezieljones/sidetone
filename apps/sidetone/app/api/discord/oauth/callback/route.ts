import { featureEnabled } from "../../../../lib/config";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import { getConvexAuthToken } from "../../../../lib/clerk-convex";
import { discordApiFetch, discordEnv } from "../../../../lib/discord";

type DiscordTokenResponse = {
  access_token: string;
  token_type: string;
};

type DiscordUser = {
  id: string;
  username?: string;
  global_name?: string | null;
};

async function fetchGuildName(guildId: string, botToken: string | null) {
  if (!botToken) {
    return undefined;
  }
  const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
    headers: {
      Authorization: `Bot ${botToken}`
    }
  });
  const payload = await response.json().catch(() => null);
  return response.ok && typeof payload?.name === "string" ? payload.name : undefined;
}

export async function GET(request: Request) {
  if (!featureEnabled("discord")) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const env = discordEnv();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const guildId = url.searchParams.get("guild_id");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("sidetone_discord_oauth_state")?.value;
  const oauthOrigin = cookieStore.get("sidetone_discord_oauth_origin")?.value ?? env.appUrl;
  cookieStore.delete("sidetone_discord_oauth_state");
  cookieStore.delete("sidetone_discord_oauth_origin");
  const sourcesUrl = (status: string) => new URL(`/sources?discord=${status}`, oauthOrigin);

  if (!env.enabled) {
    return NextResponse.redirect(sourcesUrl("disabled"));
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(sourcesUrl("invalid-state"));
  }
  if (!guildId) {
    return NextResponse.redirect(sourcesUrl("missing-guild"));
  }

  const { userId } = await auth();
  if (!userId) {
    const redirect = new URL("/sign-in", request.url);
    redirect.searchParams.set("redirect_url", `/api/discord/oauth/callback?${url.searchParams.toString()}`);
    return NextResponse.redirect(redirect);
  }
  if (!env.applicationId || !env.clientSecret) {
    return NextResponse.redirect(sourcesUrl("not-configured"));
  }

  try {
    const redirectUri = `${oauthOrigin}/api/discord/oauth/callback`;
    const token = await discordApiFetch<DiscordTokenResponse>("/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: env.applicationId,
        client_secret: env.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      })
    });

    const discordUser = await discordApiFetch<DiscordUser>("/users/@me", {
      method: "GET",
      headers: {
        Authorization: `${token.token_type} ${token.access_token}`
      }
    });

    const guildName = await fetchGuildName(guildId, env.botToken);
    const convexToken = await getConvexAuthToken();
    await fetchMutation(api.discord.linkDiscordInstallation, {
      discordApplicationId: env.applicationId,
      discordGuildId: guildId,
      discordGuildName: guildName,
      discordUserId: discordUser.id,
      discordUsername: discordUser.global_name ?? discordUser.username
    }, { token: convexToken });

    return NextResponse.redirect(sourcesUrl("connected"));
  } catch {
    return NextResponse.redirect(sourcesUrl("failed"));
  }
}
