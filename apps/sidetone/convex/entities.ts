import { requireWorkerToken, requireFeature } from "./deployment";
import { v } from "convex/values";
import { integrationDescriptorFor, sidetoneIntegrationDescriptors } from "@sidetone/contracts";
import { mutation, query } from "./_generated/server";
import { requireAuthenticatedIdentity, requireOwnedEntity } from "./auth";
import type { MutationCtx } from "./_generated/server";

const coachMode = v.union(
  v.literal("close_the_deal"),
  v.literal("support"),
  v.literal("negotiate"),
  v.literal("sense_check"),
  v.literal("charm"),
  v.literal("just_notes")
);

const industryProfile = v.union(
  v.literal("general"),
  v.literal("real_estate_mortgage"),
  v.literal("recruiting_sourcing"),
  v.literal("sales_founders_operators"),
  v.literal("legal_client_services"),
  v.literal("insurance_financial_services"),
  v.literal("healthcare_sensitive"),
  v.literal("athletics_recruiting"),
  v.literal("oil_and_gas_landmen"),
  v.literal("freight_brokerage")
);

const consentMode = v.union(
  v.literal("conference_disclosure"),
  v.literal("owner_acknowledgment"),
  v.literal("workspace_setting")
);

const integrationIdArg = v.union(
  v.literal("buildium"),
  v.literal("rentvine"),
  v.literal("doorloop"),
  v.literal("appfolio"),
  v.literal("rent_manager"),
  v.literal("property_meld"),
  v.literal("yardi_breeze")
);

const integrationConnectionStatusArg = v.union(
  v.literal("active"),
  v.literal("needs_attention"),
  v.literal("failed"),
  v.literal("revoked")
);

const integrationActionStatusArg = v.union(
  v.literal("draft"),
  v.literal("approved"),
  v.literal("sent"),
  v.literal("blocked"),
  v.literal("failed"),
  v.literal("cancelled")
);

function now() {
  return Date.now();
}

async function ensureOwnerEntity(ctx: MutationCtx, input: {
  ownerTokenIdentifier: string;
  timestamp: number;
}) {
  const existing = await ctx.db
    .query("entityProfiles")
    .withIndex("by_owner", (q) => q.eq("ownerTokenIdentifier", input.ownerTokenIdentifier))
    .first();

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

  await ctx.db.insert("phoneNumberAssignments", {
    entityId,
    ownerTokenIdentifier: input.ownerTokenIdentifier,
    status: "searching",
    voiceRoutingStatus: "missing",
    smsRoutingStatus: "missing",
    createdAt: input.timestamp,
    updatedAt: input.timestamp
  });

  return await ctx.db.get(entityId);
}

function titleFromSummary(text?: string) {
  const words = (text ?? "")
    .replace(/[^a-zA-Z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 1)
    .slice(0, 3);

  if (!words.length) {
    return undefined;
  }

  return words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function comparablePhone(value?: string | null) {
  const raw = value?.replace(/\D/g, "") ?? "";
  if (raw.length === 10) {
    return `1${raw}`;
  }
  return raw || undefined;
}

function phoneMatches(left?: string | null, right?: string | null) {
  const normalizedLeft = comparablePhone(left);
  const normalizedRight = comparablePhone(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function isInfrastructurePhone(
  phoneNumber: string | undefined,
  entity: { ownerPhoneNumber?: string },
  numberAssignment: { e164?: string; phoneNumber?: string } | null
) {
  return Boolean(
    phoneNumber
    && (
      phoneMatches(phoneNumber, entity.ownerPhoneNumber)
      || phoneMatches(phoneNumber, numberAssignment?.e164)
      || phoneMatches(phoneNumber, numberAssignment?.phoneNumber)
    )
  );
}

function identityPhone(
  phoneNumber: string | undefined,
  entity: { ownerPhoneNumber?: string },
  numberAssignment: { e164?: string; phoneNumber?: string } | null
) {
  return phoneNumber && !isInfrastructurePhone(phoneNumber, entity, numberAssignment)
    ? phoneNumber
    : undefined;
}

function callLegIdentityPhone(
  phoneNumber: string | undefined,
  callMode: string,
  entity: { ownerPhoneNumber?: string },
  numberAssignment: { e164?: string; phoneNumber?: string } | null
) {
  return callMode === "call_through"
    ? identityPhone(phoneNumber, entity, numberAssignment)
    : undefined;
}

export const ensureDefaultEntity = mutation({
  args: {
    name: v.optional(v.string()),
    areaCode: v.optional(v.string()),
    ownerPhoneNumber: v.optional(v.string()),
    timezone: v.optional(v.string()),
    defaultIndustryProfile: v.optional(industryProfile),
    defaultCoachMode: v.optional(coachMode)
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const existing = await ctx.db
      .query("entityProfiles")
      .withIndex("by_owner", (q) => q.eq("ownerTokenIdentifier", identity.tokenIdentifier))
      .first();

    if (existing) {
      return { entityId: existing._id };
    }

    const timestamp = now();
    const entityId = await ctx.db.insert("entityProfiles", {
      ownerTokenIdentifier: identity.tokenIdentifier,
      name: args.name?.trim() || "My Sidetone",
      ownerPhoneNumber: args.ownerPhoneNumber,
      entityType: "person",
      status: "draft",
      timezone: args.timezone?.trim() || "America/Chicago",
      defaultIndustryProfile: args.defaultIndustryProfile ?? "general",
      ...(args.defaultCoachMode ? { defaultCoachMode: args.defaultCoachMode } : {}),
      defaultConsentMode: "conference_disclosure",
      riskClass: "standard",
      activationContactStatus: "not_started",
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("phoneNumberAssignments", {
      entityId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      areaCode: args.areaCode,
      status: "searching",
      voiceRoutingStatus: "missing",
      smsRoutingStatus: "missing",
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId,
      actor: "owner",
      type: "entity.created",
      message: "Sidetone workspace created.",
      createdAt: timestamp
    });

    return { entityId };
  }
});

export const ownerHome = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const timestamp = now();
    const entities = await ctx.db
      .query("entityProfiles")
      .withIndex("by_owner", (q) => q.eq("ownerTokenIdentifier", identity.tokenIdentifier))
      .take(5);

    const workspaces = await Promise.all(
      entities.map(async (entity) => {
        const numberAssignment = await ctx.db
          .query("phoneNumberAssignments")
          .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
          .first();
        const recentCalls = await ctx.db
          .query("callSessions")
          .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
          .order("desc")
          .take(50);
        const enrichedRecentCalls = await Promise.all(
          recentCalls.map(async (call) => {
            const artifact = await ctx.db
              .query("callArtifacts")
              .withIndex("by_call_session", (q) => q.eq("callSessionId", call._id))
              .first();
            const externalLeg = await ctx.db
              .query("callLegs")
              .withIndex("by_call_session_role", (q) => q.eq("callSessionId", call._id).eq("role", "external"))
              .first();
            const externalPhone = callLegIdentityPhone(externalLeg?.phoneNumber, call.mode, entity, numberAssignment);
            const primaryParticipant = await ctx.db
              .query("callParticipants")
              .withIndex("by_call_role", (q) => q.eq("callSessionId", call._id).eq("role", "primary"))
              .first();
            const participantContact = primaryParticipant?.contactId
              ? await ctx.db.get(primaryParticipant.contactId)
              : null;
            const participantExternalEntity = primaryParticipant?.externalEntityId
              ? await ctx.db.get(primaryParticipant.externalEntityId)
              : call.primaryExternalEntityId
                ? await ctx.db.get(call.primaryExternalEntityId)
                : null;
            const participantRawPhone = participantContact?.phoneNumber ?? primaryParticipant?.phoneNumberSnapshot;
            const participantHasInfrastructurePhone = isInfrastructurePhone(
              participantRawPhone,
              entity,
              numberAssignment
            );
            const participantDisplayName = participantHasInfrastructurePhone
              ? undefined
              : participantContact?.displayName ?? primaryParticipant?.displayNameSnapshot;
            const participantPhone = identityPhone(
              participantRawPhone,
              entity,
              numberAssignment
            );
            const contact = externalPhone
              ? await ctx.db
                .query("contacts")
                .withIndex("by_phone_entity", (q) => q.eq("phoneNumber", externalPhone).eq("entityId", entity._id))
                .order("desc")
                .first()
              : null;
            const callTagLinks = await ctx.db
              .query("callTags")
              .withIndex("by_call", (q) => q.eq("callSessionId", call._id))
              .take(12);
            const latestRecording = await ctx.db
              .query("callRecordings")
              .withIndex("by_call_session", (q) => q.eq("callSessionId", call._id))
              .order("desc")
              .first();
            const tags = (
              await Promise.all(callTagLinks.map((link) => ctx.db.get(link.tagId)))
            ).filter((tag): tag is NonNullable<typeof tag> => Boolean(tag && tag.status === "active"));
            const identityTitle = participantExternalEntity?.name
              ?? primaryParticipant?.externalEntityNameSnapshot
              ?? participantDisplayName
              ?? contact?.displayName;

            return {
              ...call,
              displayTimestamp: call.startedAt ?? call.createdAt,
              status: call.status === "connecting" && timestamp - call.createdAt > 2 * 60 * 1000
                ? "failed"
                : call.status,
              failureReason: call.status === "connecting" && timestamp - call.createdAt > 2 * 60 * 1000
                ? call.failureReason ?? "This call did not connect. Try again when you are ready."
                : call.failureReason,
              summaryTitle: artifact?.status === "ready"
                ? artifact.title ?? titleFromSummary(artifact.summary)
                : undefined,
              callBasis: artifact?.callBasis,
              identityTitle,
              contactName: participantDisplayName ?? contact?.displayName,
              externalEntityName: participantExternalEntity?.name ?? primaryParticipant?.externalEntityNameSnapshot,
              phoneNumber: externalPhone ?? participantPhone ?? contact?.phoneNumber,
              latestRecording: latestRecording
                ? {
                  _id: latestRecording._id,
                  status: latestRecording.status,
                  durationMs: latestRecording.durationMs,
                  format: latestRecording.format
                }
                : null,
              tags: tags.map((tag) => ({
                _id: tag._id,
                label: tag.label,
                color: tag.color
              }))
            };
          })
        );
        const savedEntities = await ctx.db
          .query("externalEntities")
          .withIndex("by_workspace", (q) => q.eq("entityId", entity._id))
          .order("desc")
          .take(100);
        const discordInstallations = await ctx.db
          .query("discordInstallations")
      .withIndex("by_owner_entity", (q) => q.eq("ownerTokenIdentifier", identity.tokenIdentifier).eq("entityId", entity._id))
          .order("desc")
          .take(20);
        const discordCaptures = await ctx.db
          .query("discordVoiceCaptures")
      .withIndex("by_owner_entity", (q) => q.eq("ownerTokenIdentifier", identity.tokenIdentifier).eq("entityId", entity._id))
          .order("desc")
          .take(20);
        const zoomInstallations = await ctx.db
          .query("zoomInstallations")
      .withIndex("by_owner_entity_status", (q) => q.eq("ownerTokenIdentifier", identity.tokenIdentifier).eq("entityId", entity._id))
          .order("desc")
          .take(20);

        return {
          entity,
          numberAssignment,
          zoomInstallations: zoomInstallations.map((installation) => ({
            _id: installation._id,
            status: installation.status,
            authorizedAt: installation.authorizedAt,
            zoomClientId: installation.zoomClientId,
            scopes: installation.scopes ?? [],
            hasAccessToken: Boolean(installation.accessToken),
            hasRefreshToken: Boolean(installation.refreshToken)
          })),
          discordInstallations: discordInstallations.map((installation) => ({
            _id: installation._id,
            discordGuildId: installation.discordGuildId,
            discordGuildName: installation.discordGuildName,
            status: installation.status,
            linkedAt: installation.linkedAt
          })),
          discordCaptures: discordCaptures.map((capture) => ({
            _id: capture._id,
            callSessionId: capture.callSessionId,
            discordGuildName: capture.discordGuildName,
            discordChannelName: capture.discordChannelName,
            status: capture.status,
            error: capture.error,
            createdAt: capture.createdAt,
            updatedAt: capture.updatedAt
          })),
          savedEntities: savedEntities.map((item) => ({
            _id: item._id,
            name: item.name,
            lastInteractionAt: item.lastInteractionAt
          })),
          recentCalls: enrichedRecentCalls
        };
      })
    );

    return { workspaces };
  }
});

function safeIntegrationConnection(connection: any) {
  return {
    _id: connection._id,
    entityId: connection.entityId,
    integrationId: connection.integrationId,
    status: connection.status,
    environment: connection.environment,
    displayName: connection.displayName,
    capabilities: connection.capabilities ?? [],
    failureReason: connection.failureReason,
    lastTestedAt: connection.lastTestedAt,
    connectedAt: connection.connectedAt,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    hasCredentials: Boolean(connection.encryptedCredentials)
  };
}

function safeIntegrationActionDraft(draft: any) {
  return {
    _id: draft._id,
    entityId: draft.entityId,
    callSessionId: draft.callSessionId,
    conversationCardId: draft.conversationCardId,
    integrationId: draft.integrationId,
    integrationConnectionId: draft.integrationConnectionId,
    actionType: draft.actionType,
    title: draft.title,
    summary: draft.summary,
    payloadJson: draft.payloadJson,
    status: draft.status,
    approvalRequired: draft.approvalRequired,
    error: draft.error,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    approvedAt: draft.approvedAt,
    sentAt: draft.sentAt
  };
}

export const integrationConnectionSummaries = query({
  args: {
    entityId: v.id("entityProfiles")
  },
  handler: async (ctx, args) => {
    await requireOwnedEntity(ctx, args.entityId);
    const connections = await ctx.db
      .query("integrationConnections")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .take(32);
    return connections.map(safeIntegrationConnection);
  }
});

export const upsertIntegrationConnection = mutation({
  args: {
    entityId: v.id("entityProfiles"),
    integrationId: integrationIdArg,
    status: integrationConnectionStatusArg,
    environment: v.optional(v.union(v.literal("production"), v.literal("sandbox"))),
    displayName: v.optional(v.string()),
    encryptedCredentials: v.optional(v.string()),
    capabilities: v.optional(v.array(v.string())),
    failureReason: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const entity = await requireOwnedEntity(ctx, args.entityId);
    const descriptor = integrationDescriptorFor(args.integrationId);
    if (!descriptor) {
      throw new Error("Unsupported integration.");
    }
    const timestamp = now();
    const existing = await ctx.db
      .query("integrationConnections")
      .withIndex("by_entity_integration", (q) => q.eq("entityId", entity._id).eq("integrationId", args.integrationId))
      .first();
    const patch = {
      entityId: entity._id,
      ownerTokenIdentifier: entity.ownerTokenIdentifier,
      integrationId: args.integrationId,
      status: args.status,
      environment: args.environment ?? existing?.environment,
      displayName: args.displayName ?? descriptor.label,
      capabilities: args.capabilities ?? existing?.capabilities ?? [...descriptor.capabilities],
      encryptedCredentials: args.encryptedCredentials ?? existing?.encryptedCredentials,
      failureReason: args.status === "active" ? undefined : args.failureReason,
      lastTestedAt: timestamp,
      connectedAt: args.status === "active" ? existing?.connectedAt ?? timestamp : existing?.connectedAt,
      updatedAt: timestamp
    };

    const connectionId = existing
      ? existing._id
      : await ctx.db.insert("integrationConnections", {
        ...patch,
        createdAt: timestamp
      });

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    }

    await ctx.db.insert("auditEvents", {
      entityId: entity._id,
      actor: "owner",
      type: "integration.connection_upserted",
      message: `${descriptor.label} integration connection updated.`,
      metadata: {
        integrationId: args.integrationId,
        status: args.status,
        environment: args.environment
      },
      createdAt: timestamp
    });

    return { connectionId };
  }
});

export const integrationCatalog = query({
  args: {
    entityId: v.id("entityProfiles")
  },
  handler: async (ctx, args) => {
    const entity = await requireOwnedEntity(ctx, args.entityId);
    const connections = await ctx.db
      .query("integrationConnections")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(32);
    return {
      personaId: entity.defaultIndustryProfile ?? "general",
      descriptors: sidetoneIntegrationDescriptors,
      connections: connections.map(safeIntegrationConnection)
    };
  }
});

export const integrationActionDraftsForEntity = query({
  args: {
    entityId: v.id("entityProfiles")
  },
  handler: async (ctx, args) => {
    await requireOwnedEntity(ctx, args.entityId);
    const drafts = await ctx.db
      .query("integrationActionDrafts")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .order("desc")
      .take(50);
    return drafts.map(safeIntegrationActionDraft);
  }
});

export const integrationActionDraft = query({
  args: {
    draftId: v.id("integrationActionDrafts")
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      return null;
    }
    await requireOwnedEntity(ctx, draft.entityId);
    return safeIntegrationActionDraft(draft);
  }
});

export const integrationActionExecutionPayload = query({
  args: {
    draftId: v.id("integrationActionDrafts")
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      return null;
    }
    await requireOwnedEntity(ctx, draft.entityId);
    const connection = draft.integrationConnectionId
      ? await ctx.db.get(draft.integrationConnectionId)
      : await ctx.db
        .query("integrationConnections")
        .withIndex("by_entity_integration", (q) => q.eq("entityId", draft.entityId).eq("integrationId", draft.integrationId))
        .first();
    if (!connection || connection.ownerTokenIdentifier !== draft.ownerTokenIdentifier) {
      return { draft: safeIntegrationActionDraft(draft), connection: null };
    }
    return {
      draft: safeIntegrationActionDraft(draft),
      connection: {
        _id: connection._id,
        integrationId: connection.integrationId,
        status: connection.status,
        environment: connection.environment,
        encryptedCredentials: connection.encryptedCredentials
      }
    };
  }
});

export const markIntegrationActionDraftStatus = mutation({
  args: {
    draftId: v.id("integrationActionDrafts"),
    status: integrationActionStatusArg,
    externalResultJson: v.optional(v.string()),
    error: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      throw new Error("Integration action draft not found.");
    }
    await requireOwnedEntity(ctx, draft.entityId);
    const timestamp = now();
    await ctx.db.patch(args.draftId, {
      status: args.status,
      externalResultJson: args.externalResultJson,
      error: args.error,
      approvedAt: args.status === "approved" ? timestamp : draft.approvedAt,
      sentAt: args.status === "sent" ? timestamp : draft.sentAt,
      updatedAt: timestamp
    });
    return { draftId: args.draftId };
  }
});

export const linkZoomInstallation = mutation({
  args: {
    zoomClientId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    tokenType: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
    expiresInSeconds: v.optional(v.float64())
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const timestamp = now();
    const entity = await ensureOwnerEntity(ctx, {
      ownerTokenIdentifier: identity.tokenIdentifier,
      timestamp
    });

    if (!entity) {
      throw new Error("Unable to create Sidetone workspace.");
    }

    const existing = await ctx.db
      .query("zoomInstallations")
      .withIndex("by_owner_entity_status", (q) => q.eq("ownerTokenIdentifier", identity.tokenIdentifier).eq("entityId", entity._id))
      .order("desc")
      .first();
    const patch = {
      entityId: entity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      zoomClientId: args.zoomClientId ?? existing?.zoomClientId,
      accessToken: args.accessToken ?? existing?.accessToken,
      refreshToken: args.refreshToken ?? existing?.refreshToken,
      tokenType: args.tokenType ?? existing?.tokenType,
      scopes: args.scopes ?? existing?.scopes,
      status: "active" as const,
      authorizedAt: timestamp,
      ...(args.expiresInSeconds ? { expiresAt: timestamp + args.expiresInSeconds * 1000 } : {}),
      updatedAt: timestamp
    };
    const installationId = existing
      ? existing._id
      : await ctx.db.insert("zoomInstallations", {
        ...patch,
        createdAt: timestamp
      });

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    }

    await ctx.db.insert("auditEvents", {
      entityId: entity._id,
      actor: "owner",
      type: "zoom.linked",
      message: "Owner authorized Zoom RTMS for Sidetone.",
      metadata: {
        scopes: args.scopes ?? []
      },
      createdAt: timestamp
    });

    return { installationId };
  }
});

export const ownedEntityAccess = query({
  args: {
    entityId: v.id("entityProfiles")
  },
  handler: async (ctx, args) => {
    const entity = await requireOwnedEntity(ctx, args.entityId);
    const numberAssignment = await ctx.db
      .query("phoneNumberAssignments")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .first();

    return { entity, numberAssignment };
  }
});

export const updateCallPreferences = mutation({
  args: {
    entityId: v.id("entityProfiles"),
    defaultIndustryProfile: industryProfile,
    defaultCoachMode: v.optional(v.union(coachMode, v.null())),
    defaultConsentMode: consentMode,
    ownerPhoneNumber: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const entity = await requireOwnedEntity(ctx, args.entityId);
    const timestamp = now();

    await ctx.db.patch(entity._id, {
      defaultCoachMode: args.defaultCoachMode ?? undefined,
      defaultIndustryProfile: args.defaultIndustryProfile,
      defaultConsentMode: args.defaultConsentMode,
      ownerPhoneNumber: args.ownerPhoneNumber ?? entity.ownerPhoneNumber,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: entity._id,
      actor: "owner",
      type: "entity.call_preferences_updated",
      message: "Sidetone call preferences updated.",
      metadata: {
        defaultIndustryProfile: args.defaultIndustryProfile,
        ...(args.defaultCoachMode ? { defaultCoachMode: args.defaultCoachMode } : {}),
        defaultConsentMode: args.defaultConsentMode
      },
      createdAt: timestamp
    });

    return { entityId: entity._id };
  }
});

export const updateActivationProgress = mutation({
  args: {
    entityId: v.id("entityProfiles"),
    contactStatus: v.optional(v.union(v.literal("not_started"), v.literal("saved"), v.literal("skipped"))),
    mergeGuideViewed: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    const entity = await requireOwnedEntity(ctx, args.entityId);
    const timestamp = now();

    await ctx.db.patch(entity._id, {
      activationContactStatus: args.contactStatus ?? entity.activationContactStatus ?? "not_started",
      activationMergeGuideViewedAt: args.mergeGuideViewed
        ? timestamp
        : entity.activationMergeGuideViewedAt,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: entity._id,
      actor: "owner",
      type: "entity.activation_progress_updated",
      message: "Owner updated Sidetone activation progress.",
      metadata: {
        contactStatus: args.contactStatus,
        mergeGuideViewed: args.mergeGuideViewed
      },
      createdAt: timestamp
    });

    return { entityId: entity._id };
  }
});

export const syncOwnerPhoneNumber = mutation({
  args: {
    entityId: v.id("entityProfiles"),
    ownerPhoneNumber: v.optional(v.string()),
    timezone: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const entity = await requireOwnedEntity(ctx, args.entityId);
    const timezone = args.timezone?.trim();

    if (entity.ownerPhoneNumber === args.ownerPhoneNumber && (!timezone || entity.timezone === timezone)) {
      return { entityId: entity._id, changed: false };
    }

    await ctx.db.patch(entity._id, {
      ownerPhoneNumber: args.ownerPhoneNumber ?? entity.ownerPhoneNumber,
      timezone: timezone || entity.timezone,
      updatedAt: now()
    });

    return { entityId: entity._id, changed: true };
  }
});

export const entityByPhoneNumber = query({
  args: {
    workerToken: v.string(),
    phoneNumber: v.string()
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    const assignment = await ctx.db
      .query("phoneNumberAssignments")
      .withIndex("by_e164", (q) => q.eq("e164", args.phoneNumber))
      .first();

    if (!assignment) {
      const byDisplayNumber = await ctx.db
        .query("phoneNumberAssignments")
        .withIndex("by_phone_number", (q) => q.eq("phoneNumber", args.phoneNumber))
        .first();
      if (!byDisplayNumber) {
        return null;
      }

      const entity = await ctx.db.get(byDisplayNumber.entityId);
      return entity ? { entity, numberAssignment: byDisplayNumber } : null;
    }

    const entity = await ctx.db.get(assignment.entityId);
    return entity ? { entity, numberAssignment: assignment } : null;
  }
});

export const upsertPhoneNumberAssignment = mutation({
  args: {
    workerToken: v.string(),
    entityId: v.id("entityProfiles"),
    areaCode: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    e164: v.optional(v.string()),
    status: v.union(
      v.literal("searching"),
      v.literal("ordering"),
      v.literal("configuring"),
      v.literal("active"),
      v.literal("failed"),
      v.literal("released")
    ),
    telnyxPhoneNumberId: v.optional(v.string()),
    telnyxConnectionId: v.optional(v.string()),
    telnyxMessagingProfileId: v.optional(v.string()),
    voiceRoutingStatus: v.optional(v.union(v.literal("missing"), v.literal("configuring"), v.literal("attached"), v.literal("failed"))),
    smsRoutingStatus: v.optional(v.union(v.literal("missing"), v.literal("configuring"), v.literal("attached"), v.literal("failed"))),
    failureReason: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    requireFeature("phone");
    const identity = await requireAuthenticatedIdentity(ctx);
    await requireOwnedEntity(ctx, args.entityId);
    const timestamp = now();
    const existing = await ctx.db
      .query("phoneNumberAssignments")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .first();

    const patch = {
      ownerTokenIdentifier: identity.tokenIdentifier,
      areaCode: args.areaCode ?? existing?.areaCode,
      phoneNumber: args.phoneNumber ?? existing?.phoneNumber,
      e164: args.e164 ?? args.phoneNumber ?? existing?.e164,
      status: args.status,
      telnyxPhoneNumberId: args.telnyxPhoneNumberId ?? existing?.telnyxPhoneNumberId,
      telnyxConnectionId: args.telnyxConnectionId ?? existing?.telnyxConnectionId,
      telnyxMessagingProfileId: args.telnyxMessagingProfileId ?? existing?.telnyxMessagingProfileId,
      voiceRoutingStatus: args.voiceRoutingStatus ?? existing?.voiceRoutingStatus,
      smsRoutingStatus: args.smsRoutingStatus ?? existing?.smsRoutingStatus,
      failureReason: args.failureReason,
      updatedAt: timestamp
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { assignmentId: existing._id };
    }

    const assignmentId = await ctx.db.insert("phoneNumberAssignments", {
      entityId: args.entityId,
      createdAt: timestamp,
      ...patch
    });

    return { assignmentId };
  }
});
