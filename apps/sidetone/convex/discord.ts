import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireAuthenticatedIdentity } from "./auth";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

type DbCtx = Pick<MutationCtx, "db">;

const activeCaptureStatuses = new Set(["queued", "joining", "recording"]);

function discordCaptureStatusMessage(status: string) {
  if (status === "queued") {
    return "Sidetone is queued. Start the Discord worker, or wait for it to pick up this capture.";
  }
  if (status === "joining") {
    return "Sidetone is joining your voice channel.";
  }
  if (status === "recording") {
    return "Sidetone is recording this Discord voice channel. Use `/sidetone stop` to finish.";
  }
  if (status === "processing") {
    return "Sidetone is saving the Discord recording for notes.";
  }
  return `Sidetone Discord capture is ${status}.`;
}

function now() {
  return Date.now();
}

function normalizeName(value?: string) {
  return value?.replace(/\s+/g, " ").trim().slice(0, 160);
}

function normalizedKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function ensureOwnerWorkspace(ctx: DbCtx, input: {
  ownerTokenIdentifier: string;
  timestamp: number;
}) {
  const existing = await ctx.db
    .query("entityProfiles")
    .withIndex("by_owner", (q) => q.eq("ownerTokenIdentifier", input.ownerTokenIdentifier))
    .first() as Doc<"entityProfiles"> | null;
  if (existing) {
    return existing;
  }

  const entityId = await ctx.db.insert("entityProfiles", {
    ownerTokenIdentifier: input.ownerTokenIdentifier,
    name: "My Sidetone",
    entityType: "person",
    status: "draft",
    timezone: "America/Chicago",
    defaultIndustryProfile: "general",
    defaultConsentMode: "conference_disclosure",
    riskClass: "standard",
    activationContactStatus: "not_started",
    createdAt: input.timestamp,
    updatedAt: input.timestamp
  });

  return await ctx.db.get(entityId) as Doc<"entityProfiles">;
}

async function linkedInstallForGuildUser(ctx: DbCtx, input: {
  discordGuildId: string;
  discordUserId: string;
}) {
  return await ctx.db
    .query("discordInstallations")
    .withIndex("by_guild_user_status", (q) => q
      .eq("discordGuildId", input.discordGuildId)
      .eq("discordUserId", input.discordUserId).eq("status", "active"))
    .order("desc")
    .first() as Doc<"discordInstallations"> | null;
}

async function activeCaptureForOwner(ctx: DbCtx, ownerTokenIdentifier: string) {
  const captures = await ctx.db
    .query("discordVoiceCaptures")
    .withIndex("by_owner", (q) => q.eq("ownerTokenIdentifier", ownerTokenIdentifier))
    .order("desc")
    .take(20) as Doc<"discordVoiceCaptures">[];
  return captures.find((capture) => activeCaptureStatuses.has(capture.status)) ?? null;
}

async function activeCaptureForGuild(ctx: DbCtx, discordGuildId: string) {
  for (const status of activeCaptureStatuses) {
    const capture = await ctx.db.query("discordVoiceCaptures")
      .withIndex("by_guild_status", q => q.eq("discordGuildId", discordGuildId).eq("status", status as Doc<"discordVoiceCaptures">["status"])).first();
    if (capture) return capture;
  }
  return null;
}

async function ownerHasConversationCaptureAccess(ctx: DbCtx, ownerTokenIdentifier: string) {
  const subscription = await ctx.db
    .query("billingSubscriptions")
    .withIndex("by_owner", (q) => q.eq("ownerTokenIdentifier", ownerTokenIdentifier))
    .order("desc")
    .first() as Doc<"billingSubscriptions"> | null;

  if (!subscription) {
    return true;
  }
  if (subscription.status === "trialing") {
    return !subscription.trialEnd || subscription.trialEnd > now();
  }
  return subscription.status === "active" && subscription.plan !== "free";
}

async function upsertExternalEntity(ctx: DbCtx, input: {
  entityId: Id<"entityProfiles">;
  ownerTokenIdentifier: string;
  callSessionId: Id<"callSessions">;
  name?: string;
  timestamp: number;
}) {
  const name = normalizeName(input.name);
  if (!name) {
    return undefined;
  }
  const normalizedName = normalizedKey(name);
  if (!normalizedName) {
    return undefined;
  }

  const existing = await ctx.db
    .query("externalEntities")
    .withIndex("by_workspace_name", (q) => q
      .eq("entityId", input.entityId)
      .eq("normalizedName", normalizedName))
    .first() as Doc<"externalEntities"> | null;

  const externalEntityId = existing?._id ?? await ctx.db.insert("externalEntities", {
    entityId: input.entityId,
    ownerTokenIdentifier: input.ownerTokenIdentifier,
    name,
    normalizedName,
    type: "other",
    lastInteractionAt: input.timestamp,
    createdAt: input.timestamp,
    updatedAt: input.timestamp
  });

  if (existing) {
    await ctx.db.patch(existing._id, {
      name,
      lastInteractionAt: input.timestamp,
      updatedAt: input.timestamp
    });
  }

  await ctx.db.patch(input.callSessionId, {
    primaryExternalEntityId: externalEntityId,
    updatedAt: input.timestamp
  });

  await ctx.db.insert("callParticipants", {
    callSessionId: input.callSessionId,
    entityId: input.entityId,
    ownerTokenIdentifier: input.ownerTokenIdentifier,
    externalEntityId,
    role: "primary",
    externalEntityNameSnapshot: name,
    createdAt: input.timestamp,
    updatedAt: input.timestamp
  });

  return externalEntityId;
}

export const linkDiscordInstallation = mutation({
  args: {
    discordApplicationId: v.optional(v.string()),
    discordGuildId: v.string(),
    discordGuildName: v.optional(v.string()),
    discordUserId: v.string(),
    discordUsername: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const timestamp = now();
    const entity = await ensureOwnerWorkspace(ctx, {
      ownerTokenIdentifier: identity.tokenIdentifier,
      timestamp
    });

    const existing = await ctx.db
      .query("discordInstallations")
      .withIndex("by_guild_user", (q) => q
        .eq("discordGuildId", args.discordGuildId)
        .eq("discordUserId", args.discordUserId))
      .order("desc")
      .first();

    const patch = {
      entityId: entity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      discordApplicationId: args.discordApplicationId,
      discordGuildName: normalizeName(args.discordGuildName),
      discordUsername: normalizeName(args.discordUsername),
      status: "active" as const,
      linkedAt: timestamp,
      updatedAt: timestamp
    };

    const installationId = existing
      ? existing._id
      : await ctx.db.insert("discordInstallations", {
        ...patch,
        discordGuildId: args.discordGuildId,
        discordUserId: args.discordUserId,
        installedAt: timestamp,
        createdAt: timestamp
      });

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    }

    await ctx.db.insert("auditEvents", {
      entityId: entity._id,
      actor: "owner",
      type: "discord.linked",
      message: "Owner linked a Discord server for Sidetone voice capture.",
      metadata: {
        discordGuildId: args.discordGuildId,
        discordGuildName: args.discordGuildName,
        discordUserId: args.discordUserId
      },
      createdAt: timestamp
    });

    return { installationId };
  }
});

export const discordOverview = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const installations = await ctx.db
      .query("discordInstallations")
      .withIndex("by_owner", (q) => q.eq("ownerTokenIdentifier", identity.tokenIdentifier))
      .order("desc")
      .take(20);
    const activeCaptures = await ctx.db
      .query("discordVoiceCaptures")
      .withIndex("by_owner", (q) => q.eq("ownerTokenIdentifier", identity.tokenIdentifier))
      .order("desc")
      .take(20);

    return {
      installations,
      activeCaptures: activeCaptures.filter((capture) => activeCaptureStatuses.has(capture.status))
    };
  }
});

export const enqueueDiscordStartInternal = internalMutation({
  args: {
    discordApplicationId: v.optional(v.string()),
    discordGuildId: v.string(),
    discordGuildName: v.optional(v.string()),
    discordStartedByUserId: v.string(),
    discordStartedByUsername: v.optional(v.string()),
    entityName: v.optional(v.string()),
    listenFor: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const timestamp = now();
    const installation = await linkedInstallForGuildUser(ctx, {
      discordGuildId: args.discordGuildId,
      discordUserId: args.discordStartedByUserId
    });
    if (!installation) {
      return {
        ok: false,
        code: "not_linked",
        message: "Link Sidetone first, then run `/sidetone start` again."
      };
    }

    if (!await ownerHasConversationCaptureAccess(ctx, installation.ownerTokenIdentifier)) {
      return {
        ok: false,
        code: "upgrade_required",
        message: "Discord voice capture is available on an active Sidetone trial or paid plan."
      };
    }

    const ownerActive = await activeCaptureForOwner(ctx, installation.ownerTokenIdentifier);
    if (ownerActive) {
      return {
        ok: false,
        code: "owner_capture_active",
        message: "Sidetone is already recording a Discord voice channel for this account."
      };
    }

    const guildActive = await activeCaptureForGuild(ctx, args.discordGuildId);
    if (guildActive) {
      return {
        ok: false,
        code: "guild_capture_active",
        message: "Sidetone is already recording a voice channel in this server."
      };
    }

    const workspace = await ctx.db.get(installation.entityId) as Doc<"entityProfiles"> | null;
    if (!workspace) {
      return {
        ok: false,
        code: "workspace_missing",
        message: "The linked Sidetone workspace could not be found."
      };
    }

    const callSessionId = await ctx.db.insert("callSessions", {
      entityId: workspace._id,
      ownerTokenIdentifier: installation.ownerTokenIdentifier,
      mode: "discord_voice",
      status: "connecting",
      industryProfile: workspace.defaultIndustryProfile ?? "general",
      consentMode: "owner_acknowledgment",
      callFocusText: normalizeName(args.listenFor),
      callFocusInputMethod: args.listenFor ? "typed" : undefined,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const externalEntityId = await upsertExternalEntity(ctx, {
      entityId: workspace._id,
      ownerTokenIdentifier: installation.ownerTokenIdentifier,
      callSessionId,
      name: args.entityName,
      timestamp
    });

    const captureId = await ctx.db.insert("discordVoiceCaptures", {
      entityId: workspace._id,
      ownerTokenIdentifier: installation.ownerTokenIdentifier,
      callSessionId,
      discordInstallationId: installation._id,
      discordGuildId: args.discordGuildId,
      discordGuildName: normalizeName(args.discordGuildName ?? installation.discordGuildName),
      discordStartedByUserId: args.discordStartedByUserId,
      discordStartedByUsername: normalizeName(args.discordStartedByUsername),
      status: "queued",
      callFocusText: normalizeName(args.listenFor),
      industryProfile: workspace.defaultIndustryProfile ?? "general",
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: workspace._id,
      callSessionId,
      actor: "discord",
      type: "discord.capture_queued",
      message: "Discord voice capture was queued.",
      metadata: {
        captureId,
        discordGuildId: args.discordGuildId,
        discordStartedByUserId: args.discordStartedByUserId,
        externalEntityId
      },
      createdAt: timestamp
    });

    return {
      ok: true,
      captureId,
      callSessionId,
      message: "Sidetone queued this Discord capture. Keep your voice channel open; the worker will join when it picks this up."
    };
  }
});

export const discordStatusInternal = internalMutation({
  args: {
    discordGuildId: v.string(),
    discordUserId: v.string()
  },
  handler: async (ctx, args) => {
    const installation = await linkedInstallForGuildUser(ctx, {
      discordGuildId: args.discordGuildId,
      discordUserId: args.discordUserId
    });
    if (!installation) {
      return {
        ok: false,
        code: "not_linked",
        message: "Link Sidetone before checking Discord voice capture."
      };
    }
    const active = await activeCaptureForOwner(ctx, installation.ownerTokenIdentifier);
    if (!active) {
      return {
        ok: true,
        status: "idle",
        message: "Sidetone is not recording a Discord voice channel right now."
      };
    }
    return {
      ok: true,
      status: active.status,
      captureId: active._id,
      callSessionId: active.callSessionId,
      message: discordCaptureStatusMessage(active.status)
    };
  }
});

export const requestDiscordStopInternal = internalMutation({
  args: {
    discordGuildId: v.string(),
    discordUserId: v.string()
  },
  handler: async (ctx, args) => {
    const installation = await linkedInstallForGuildUser(ctx, {
      discordGuildId: args.discordGuildId,
      discordUserId: args.discordUserId
    });
    if (!installation) {
      return {
        ok: false,
        code: "not_linked",
        message: "Link Sidetone before stopping Discord voice capture."
      };
    }
    const active = await activeCaptureForOwner(ctx, installation.ownerTokenIdentifier);
    if (!active) {
      return {
        ok: true,
        status: "idle",
        message: "Sidetone is not recording a Discord voice channel right now."
      };
    }
    const timestamp = now();
    await ctx.db.patch(active._id, {
      status: "stopped",
      stoppedAt: timestamp,
      updatedAt: timestamp
    });
    if (active.callSessionId && active.status !== "recording") {
      await ctx.db.patch(active.callSessionId, {
        status: "cancelled",
        endedAt: timestamp,
        updatedAt: timestamp
      });
    }
    return {
      ok: true,
      status: "stopped",
      captureId: active._id,
      message: active.status === "recording"
        ? "Sidetone is finishing this Discord recording."
        : "Sidetone cancelled the queued Discord capture before recording started."
    };
  }
});

export const discordCaptureStateInternal = internalQuery({
  args: {
    captureId: v.id("discordVoiceCaptures"),
    workerSessionId: v.string()
  },
  handler: async (ctx, args) => {
    const capture = await ctx.db.get(args.captureId);
    if (!capture || capture.workerSessionId !== args.workerSessionId) {
      throw new Error("Discord capture not claimed by this worker.");
    }
    return {
      status: capture.status,
      stoppedAt: capture.stoppedAt,
      updatedAt: capture.updatedAt
    };
  }
});

export const claimDiscordCaptureInternal = internalMutation({
  args: {
    workerSessionId: v.string()
  },
  handler: async (ctx, args) => {
    const capture = await ctx.db
      .query("discordVoiceCaptures")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .order("asc")
      .first() as Doc<"discordVoiceCaptures"> | null;
    if (!capture) {
      return null;
    }
    const timestamp = now();
    await ctx.db.patch(capture._id, {
      status: "joining",
      workerSessionId: args.workerSessionId,
      updatedAt: timestamp
    });
    return {
      ...capture,
      status: "joining" as const,
      workerSessionId: args.workerSessionId
    };
  }
});

export const markDiscordCaptureRecordingInternal = internalMutation({
  args: {
    captureId: v.id("discordVoiceCaptures"),
    workerSessionId: v.string(),
    discordChannelId: v.string(),
    discordChannelName: v.optional(v.string()),
    participantCount: v.optional(v.float64())
  },
  handler: async (ctx, args) => {
    const capture = await ctx.db.get(args.captureId);
    if (!capture || capture.workerSessionId !== args.workerSessionId) {
      throw new Error("Discord capture not claimed by this worker.");
    }
    const timestamp = now();
    await ctx.db.patch(args.captureId, {
      status: "recording",
      discordChannelId: args.discordChannelId,
      discordChannelName: normalizeName(args.discordChannelName),
      participantCount: args.participantCount,
      startedAt: timestamp,
      updatedAt: timestamp
    });
    if (capture.callSessionId) {
      await ctx.db.patch(capture.callSessionId, {
        status: "live",
        startedAt: timestamp,
        updatedAt: timestamp
      });
    }
    return { captureId: args.captureId };
  }
});

export const completeDiscordCaptureInternal = internalMutation({
  args: {
    captureId: v.id("discordVoiceCaptures"),
    workerSessionId: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.float64(),
    durationMs: v.optional(v.float64()),
    participantCount: v.optional(v.float64())
  },
  handler: async (ctx, args) => {
    const capture = await ctx.db.get(args.captureId);
    if (!capture || capture.workerSessionId !== args.workerSessionId || !capture.callSessionId) {
      throw new Error("Discord capture not claimed by this worker.");
    }
    const timestamp = now();
    await ctx.db.patch(args.captureId, {
      status: "processing",
      storageId: args.storageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      durationMs: args.durationMs,
      participantCount: args.participantCount ?? capture.participantCount,
      stoppedAt: timestamp,
      updatedAt: timestamp
    });
    await ctx.db.patch(capture.callSessionId, {
      status: "processing",
      endedAt: timestamp,
      updatedAt: timestamp
    });
    await ctx.db.insert("uploadedRecordings", {
      callSessionId: capture.callSessionId,
      entityId: capture.entityId,
      ownerTokenIdentifier: capture.ownerTokenIdentifier,
      storageId: args.storageId,
      fileName: args.fileName,
      mimeType: args.mimeType || "audio/webm",
      sizeBytes: args.sizeBytes,
      status: "uploaded",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await ctx.db.insert("callRecordings", {
      callSessionId: capture.callSessionId,
      entityId: capture.entityId,
      ownerTokenIdentifier: capture.ownerTokenIdentifier,
      provider: "convex_storage",
      recordingId: String(args.storageId),
      storageId: args.storageId,
      status: "ready",
      source: "discord_voice",
      format: args.mimeType.includes("wav") ? "wav" : args.mimeType.includes("ogg") ? "ogg" : "webm",
      fileName: args.fileName,
      mimeType: args.mimeType || "audio/webm",
      sizeBytes: args.sizeBytes,
      durationMs: args.durationMs,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await ctx.db.insert("auditEvents", {
      entityId: capture.entityId,
      callSessionId: capture.callSessionId,
      actor: "discord",
      type: "discord.capture_uploaded",
      message: "Discord voice recording was saved for transcription and notes.",
      metadata: {
        captureId: args.captureId,
        discordGuildId: capture.discordGuildId,
        discordChannelId: capture.discordChannelId,
        storageId: args.storageId
      },
      createdAt: timestamp
    });
    return { callSessionId: capture.callSessionId };
  }
});

export const markDiscordCaptureReadyInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const capture = await ctx.db
      .query("discordVoiceCaptures")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    if (capture && capture.status !== "failed") {
      await ctx.db.patch(capture._id, {
        status: "ready",
        updatedAt: now()
      });
    }
    return { updated: Boolean(capture) };
  }
});

export const failDiscordCaptureInternal = internalMutation({
  args: {
    captureId: v.id("discordVoiceCaptures"),
    workerSessionId: v.optional(v.string()),
    error: v.string()
  },
  handler: async (ctx, args) => {
    const capture = await ctx.db.get(args.captureId);
    if (!capture) {
      return { updated: false };
    }
    if (args.workerSessionId && capture.workerSessionId && capture.workerSessionId !== args.workerSessionId) {
      throw new Error("Discord capture not claimed by this worker.");
    }
    const timestamp = now();
    await ctx.db.patch(args.captureId, {
      status: "failed",
      error: args.error,
      stoppedAt: timestamp,
      updatedAt: timestamp
    });
    if (capture.callSessionId) {
      await ctx.db.patch(capture.callSessionId, {
        status: "failed",
        failureReason: args.error,
        endedAt: timestamp,
        updatedAt: timestamp
      });
    }
    await ctx.db.insert("auditEvents", {
      entityId: capture.entityId,
      callSessionId: capture.callSessionId,
      actor: "discord",
      type: "discord.capture_failed",
      message: "Discord voice capture failed.",
      metadata: {
        captureId: args.captureId,
        error: args.error
      },
      createdAt: timestamp
    });
    return { updated: true };
  }
});
