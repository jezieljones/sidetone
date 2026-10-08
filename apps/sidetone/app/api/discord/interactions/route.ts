import { featureEnabled } from "../../../lib/config";
import {
  discordEnv,
  discordJson,
  interactionResponse,
  optionString,
  runDiscordConvexStep,
  topSubcommand,
  type DiscordInteraction
} from "../../../lib/discord";

function userFromInteraction(interaction: DiscordInteraction) {
  return interaction.member?.user ?? interaction.user ?? null;
}

function displayName(user: { username?: string; global_name?: string | null } | null) {
  return user?.global_name ?? user?.username ?? undefined;
}

export async function POST(request: Request) {
  if (!featureEnabled("discord")) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const env = discordEnv();
  const bodyText = await request.text();
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");

  const { verifyDiscordInteractionSignature } = await import("../../../lib/discord");
  if (!verifyDiscordInteractionSignature({
    bodyText,
    signature,
    timestamp,
    publicKey: env.publicKey
  })) {
    return discordJson({ error: "Invalid Discord signature." }, { status: 401 });
  }

  const interaction = JSON.parse(bodyText) as DiscordInteraction;
  if (interaction.type === 1) {
    return discordJson({ type: 1 });
  }

  if (!env.enabled) {
    return interactionResponse("Discord voice capture is not enabled for this Sidetone deployment yet.");
  }

  if (interaction.type !== 2 || interaction.data?.name !== "sidetone") {
    return interactionResponse("Unknown Sidetone command.");
  }

  const subcommand = topSubcommand(interaction.data.options);
  const user = userFromInteraction(interaction);
  const discordGuildId = interaction.guild_id ?? interaction.guild?.id;
  const discordUserId = user?.id;
  if (!discordGuildId || !discordUserId) {
    return interactionResponse("Use Sidetone commands inside a Discord server.");
  }

  try {
    if (subcommand?.name === "link") {
      return interactionResponse(`Link Sidetone here: ${env.appUrl}/api/discord/oauth/start`);
    }

    if (subcommand?.name === "status") {
      const result = await runDiscordConvexStep("discord-command-status", {
        discordGuildId,
        discordUserId
      });
      return interactionResponse(result?.message ?? "Sidetone checked Discord voice capture.");
    }

    if (subcommand?.name === "stop") {
      const result = await runDiscordConvexStep("discord-command-stop", {
        discordGuildId,
        discordUserId
      });
      return interactionResponse(result?.message ?? "Sidetone stopped Discord voice capture.", false);
    }

    if (subcommand?.name === "start") {
      const result = await runDiscordConvexStep("discord-command-start", {
        discordApplicationId: interaction.application_id,
        discordGuildId,
        discordGuildName: interaction.guild?.name,
        discordUserId,
        discordUsername: displayName(user),
        entityName: optionString(subcommand.options, "entity"),
        listenFor: optionString(subcommand.options, "listen_for")
      });
      return interactionResponse(
        result?.message ?? "Sidetone is checking your voice channel.",
        !result?.ok
      );
    }

    return interactionResponse("Use `/sidetone start`, `/sidetone stop`, `/sidetone status`, or `/sidetone link`.");
  } catch (error) {
    return interactionResponse(error instanceof Error ? error.message : "Sidetone could not process that Discord command.");
  }
}
