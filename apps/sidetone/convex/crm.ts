import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthenticatedIdentity, requireOwnedEntity } from "./auth";

const externalEntityType = v.union(
  v.literal("company"),
  v.literal("household"),
  v.literal("deal"),
  v.literal("client"),
  v.literal("account"),
  v.literal("other")
);

const callFocusInputMethod = v.union(v.literal("typed"), v.literal("voice"), v.literal("system"));

function now() {
  return Date.now();
}

function cleanText(value?: string | null, maxLength = 240) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function normalizeLookup(value?: string | null) {
  return cleanText(value, 240)?.toLowerCase();
}

function normalizePhone(input?: string | null) {
  const raw = cleanText(input, 40);
  if (!raw) {
    return undefined;
  }

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  return raw;
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
  entity: any,
  numberAssignment: { e164?: string; phoneNumber?: string } | null
) {
  return Boolean(
    phoneNumber
    && (
      phoneMatches(phoneNumber, entity?.ownerPhoneNumber)
      || phoneMatches(phoneNumber, numberAssignment?.e164)
      || phoneMatches(phoneNumber, numberAssignment?.phoneNumber)
    )
  );
}

function normalizeEmail(input?: string | null) {
  return cleanText(input, 320)?.toLowerCase();
}

function normalizeTagColor(input?: string | null) {
  const cleaned = cleanText(input, 24);
  return cleaned && /^#[0-9a-fA-F]{6}$/.test(cleaned) ? cleaned : undefined;
}

async function requireOwnedCallSession(ctx: any, callSessionId: any) {
  const identity = await requireAuthenticatedIdentity(ctx);
  const callSession = await ctx.db.get(callSessionId);
  if (!callSession || callSession.ownerTokenIdentifier !== identity.tokenIdentifier) {
    throw new Error("Call session not found.");
  }
  return { identity, callSession };
}

async function upsertExternalEntity(ctx: any, input: {
  workspaceEntityId: any;
  ownerTokenIdentifier: string;
  name?: string;
  type?: "company" | "household" | "deal" | "client" | "account" | "other";
  timestamp: number;
}) {
  const name = cleanText(input.name);
  const normalizedName = normalizeLookup(name);
  if (!name || !normalizedName) {
    return null;
  }

  const existing = await ctx.db
    .query("externalEntities")
    .withIndex("by_workspace_name", (q: any) => q.eq("entityId", input.workspaceEntityId).eq("normalizedName", normalizedName))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      name,
      type: input.type ?? existing.type,
      lastInteractionAt: input.timestamp,
      updatedAt: input.timestamp
    });
    return existing._id;
  }

  return await ctx.db.insert("externalEntities", {
    entityId: input.workspaceEntityId,
    ownerTokenIdentifier: input.ownerTokenIdentifier,
    name,
    normalizedName,
    type: input.type ?? "client",
    lastInteractionAt: input.timestamp,
    createdAt: input.timestamp,
    updatedAt: input.timestamp
  });
}

async function upsertContact(ctx: any, input: {
  workspaceEntityId: any;
  ownerTokenIdentifier: string;
  displayName?: string;
  roleTitle?: string;
  phoneNumber?: string;
  email?: string;
  timestamp: number;
}) {
  const displayName = cleanText(input.displayName);
  const normalizedDisplayName = normalizeLookup(displayName);
  const roleTitle = cleanText(input.roleTitle);
  const phoneNumber = normalizePhone(input.phoneNumber);
  const email = normalizeEmail(input.email);

  if (!displayName && !phoneNumber && !email) {
    return null;
  }

  const existingByPhone = phoneNumber
    ? await ctx.db
      .query("contacts")
      .withIndex("by_phone", (q: any) => q.eq("phoneNumber", phoneNumber))
      .filter((q: any) => q.eq(q.field("entityId"), input.workspaceEntityId))
      .first()
    : null;
  const existingByName = !existingByPhone && normalizedDisplayName
    ? await ctx.db
      .query("contacts")
      .withIndex("by_entity_name", (q: any) => q.eq("entityId", input.workspaceEntityId).eq("normalizedDisplayName", normalizedDisplayName))
      .first()
    : null;
  const existing = existingByPhone ?? existingByName;

  const patch = {
    displayName: displayName ?? existing?.displayName,
    normalizedDisplayName: normalizedDisplayName ?? existing?.normalizedDisplayName,
    roleTitle: roleTitle ?? existing?.roleTitle,
    phoneNumber: phoneNumber ?? existing?.phoneNumber,
    email: email ?? existing?.email,
    lastInteractionAt: input.timestamp,
    updatedAt: input.timestamp
  };

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }

  return await ctx.db.insert("contacts", {
    entityId: input.workspaceEntityId,
    ownerTokenIdentifier: input.ownerTokenIdentifier,
    ...patch,
    createdAt: input.timestamp
  });
}

async function linkCallToExternalEntity(ctx: any, input: {
  callSession: any;
  ownerTokenIdentifier: string;
  externalEntityId: any;
  entityName: string;
  timestamp: number;
}) {
  const existingParticipant = await ctx.db
    .query("callParticipants")
    .withIndex("by_call_role", (q: any) => q.eq("callSessionId", input.callSession._id).eq("role", "primary"))
    .first();
  const participantPatch = {
    entityId: input.callSession.entityId,
    ownerTokenIdentifier: input.ownerTokenIdentifier,
    externalEntityId: input.externalEntityId,
    externalEntityNameSnapshot: input.entityName,
    updatedAt: input.timestamp
  };
  const participantId = existingParticipant
    ? (await ctx.db.patch(existingParticipant._id, participantPatch), existingParticipant._id)
    : await ctx.db.insert("callParticipants", {
      callSessionId: input.callSession._id,
      role: "primary",
      createdAt: input.timestamp,
      ...participantPatch
    });

  await ctx.db.patch(input.callSession._id, {
    primaryExternalEntityId: input.externalEntityId,
    updatedAt: input.timestamp
  });

  const chunks = await ctx.db
    .query("callTranscriptChunks")
    .withIndex("by_call_session", (q: any) => q.eq("callSessionId", input.callSession._id))
    .take(100);
  await Promise.all(chunks.map((chunk: any) =>
    ctx.db.patch(chunk._id, {
      externalEntityId: input.externalEntityId,
      updatedAt: input.timestamp
    })
  ));

  return participantId;
}

function fallbackEntityNameForCall(input: {
  contact?: any | null;
  participant?: any | null;
  entity: any;
  numberAssignment: { e164?: string; phoneNumber?: string } | null;
}) {
  const candidate = cleanText(
    input.participant?.externalEntityNameSnapshot
    ?? input.contact?.displayName
    ?? input.participant?.displayNameSnapshot
  );
  if (candidate) {
    return candidate;
  }

  const phoneNumber = normalizePhone(input.contact?.phoneNumber ?? input.participant?.phoneNumberSnapshot);
  return phoneNumber && !isInfrastructurePhone(phoneNumber, input.entity, input.numberAssignment)
    ? phoneNumber
    : undefined;
}

export const updateCallEntity = mutation({
  args: {
    callSessionId: v.id("callSessions"),
    entityName: v.string(),
    externalEntityType: v.optional(externalEntityType)
  },
  handler: async (ctx, args) => {
    const { identity, callSession } = await requireOwnedCallSession(ctx, args.callSessionId);
    const timestamp = now();
    const entityName = cleanText(args.entityName);
    if (!entityName) {
      throw new Error("Entity name is required.");
    }

    const externalEntityId = await upsertExternalEntity(ctx, {
      workspaceEntityId: callSession.entityId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      name: entityName,
      type: args.externalEntityType,
      timestamp
    });
    if (!externalEntityId) {
      throw new Error("Entity name is required.");
    }

    const participantId = await linkCallToExternalEntity(ctx, {
      callSession,
      ownerTokenIdentifier: identity.tokenIdentifier,
      externalEntityId,
      entityName,
      timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "owner",
      type: "call_entity.updated",
      message: "Owner updated the call entity.",
      metadata: {
        externalEntityId,
        participantId
      },
      createdAt: timestamp
    });

    return { externalEntityId, participantId };
  }
});

export const backfillCallEntities = mutation({
  args: {
    entityId: v.id("entityProfiles")
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const entity = await requireOwnedEntity(ctx, args.entityId);
    const timestamp = now();
    const numberAssignment = await ctx.db
      .query("phoneNumberAssignments")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .first();
    const calls = await ctx.db
      .query("callSessions")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .order("desc")
      .take(500);

    let linked = 0;
    let skipped = 0;

    for (const callSession of calls) {
      const participant = await ctx.db
        .query("callParticipants")
        .withIndex("by_call_role", (q) => q.eq("callSessionId", callSession._id).eq("role", "primary"))
        .first();
      const participantExternalEntity = participant?.externalEntityId
        ? await ctx.db.get(participant.externalEntityId)
        : null;
      const contact = participant?.contactId ? await ctx.db.get(participant.contactId) : null;
      const entityName = participantExternalEntity?.name
        ?? fallbackEntityNameForCall({ contact, participant, entity, numberAssignment });

      if (!entityName) {
        skipped += 1;
        continue;
      }

      const externalEntityId = participantExternalEntity?._id
        ?? await upsertExternalEntity(ctx, {
          workspaceEntityId: args.entityId,
          ownerTokenIdentifier: identity.tokenIdentifier,
          name: entityName,
          timestamp
        });
      if (!externalEntityId) {
        skipped += 1;
        continue;
      }

      await linkCallToExternalEntity(ctx, {
        callSession,
        ownerTokenIdentifier: identity.tokenIdentifier,
        externalEntityId,
        entityName,
        timestamp
      });
      linked += 1;
    }

    await ctx.db.patch(args.entityId, {
      identityBackfilledAt: timestamp,
      updatedAt: timestamp
    });

    if (linked > 0) {
      await ctx.db.insert("auditEvents", {
        entityId: args.entityId,
        actor: "system",
        type: "call_entity.backfilled",
        message: "Sidetone backfilled call entities for call intelligence.",
        metadata: { linked, skipped },
        createdAt: timestamp
      });
    }

    return { linked, skipped };
  }
});

export const updatePrimaryContactForCall = mutation({
  args: {
    callSessionId: v.id("callSessions"),
    displayName: v.optional(v.string()),
    externalEntityName: v.optional(v.string()),
    externalEntityType: v.optional(externalEntityType),
    roleTitle: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    email: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const { identity, callSession } = await requireOwnedCallSession(ctx, args.callSessionId);
    const timestamp = now();
    const entity = await ctx.db.get(callSession.entityId);
    const numberAssignment = await ctx.db
      .query("phoneNumberAssignments")
      .withIndex("by_entity", (q: any) => q.eq("entityId", callSession.entityId))
      .first();
    const normalizedPhoneNumber = normalizePhone(args.phoneNumber);
    const phoneNumber = normalizedPhoneNumber && !isInfrastructurePhone(normalizedPhoneNumber, entity, numberAssignment)
      ? normalizedPhoneNumber
      : undefined;
    const email = normalizeEmail(args.email);
    const contactId = await upsertContact(ctx, {
      workspaceEntityId: callSession.entityId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      displayName: args.displayName,
      roleTitle: args.roleTitle,
      phoneNumber,
      email,
      timestamp
    });
    const externalEntityId = await upsertExternalEntity(ctx, {
      workspaceEntityId: callSession.entityId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      name: args.externalEntityName,
      type: args.externalEntityType,
      timestamp
    });

    const existingParticipant = await ctx.db
      .query("callParticipants")
      .withIndex("by_call_role", (q: any) => q.eq("callSessionId", args.callSessionId).eq("role", "primary"))
      .first();
    const existingParticipantContact = existingParticipant?.contactId
      ? await ctx.db.get(existingParticipant.contactId)
      : null;
    const existingParticipantRawPhone = existingParticipantContact?.phoneNumber ?? existingParticipant?.phoneNumberSnapshot;
    const existingParticipantHasInfrastructurePhone = isInfrastructurePhone(
      existingParticipantRawPhone,
      entity,
      numberAssignment
    );
    const existingPhoneNumber = existingParticipantHasInfrastructurePhone
      ? undefined
      : existingParticipant?.phoneNumberSnapshot;
    const participantPatch = {
      entityId: callSession.entityId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      contactId: contactId ?? (existingParticipantHasInfrastructurePhone ? undefined : existingParticipant?.contactId),
      externalEntityId: externalEntityId ?? existingParticipant?.externalEntityId,
      displayNameSnapshot: cleanText(args.displayName)
        ?? (existingParticipantHasInfrastructurePhone ? undefined : existingParticipant?.displayNameSnapshot),
      externalEntityNameSnapshot: cleanText(args.externalEntityName) ?? existingParticipant?.externalEntityNameSnapshot,
      phoneNumberSnapshot: phoneNumber ?? existingPhoneNumber,
      emailSnapshot: email ?? existingParticipant?.emailSnapshot,
      updatedAt: timestamp
    };

    const participantId = existingParticipant
      ? (await ctx.db.patch(existingParticipant._id, participantPatch), existingParticipant._id)
      : await ctx.db.insert("callParticipants", {
        callSessionId: args.callSessionId,
        role: "primary",
        createdAt: timestamp,
        ...participantPatch
      });

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "owner",
      type: "call_identity.updated",
      message: "Owner updated who the call was with.",
      metadata: {
        contactId,
        externalEntityId,
        participantId
      },
      createdAt: timestamp
    });

    return { contactId, externalEntityId, participantId };
  }
});

export const updateCallFocus = mutation({
  args: {
    callSessionId: v.id("callSessions"),
    callFocusText: v.optional(v.string()),
    inputMethod: v.optional(callFocusInputMethod)
  },
  handler: async (ctx, args) => {
    const { callSession } = await requireOwnedCallSession(ctx, args.callSessionId);
    const timestamp = now();
    const callFocusText = cleanText(args.callFocusText, 500);

    await ctx.db.patch(args.callSessionId, {
      callFocusText,
      callFocusInputMethod: callFocusText ? args.inputMethod ?? "typed" : undefined,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "owner",
      type: "call_focus.updated",
      message: callFocusText ? "Owner updated what Sidetone should listen for." : "Owner cleared what Sidetone should listen for.",
      metadata: {
        inputMethod: args.inputMethod ?? "typed"
      },
      createdAt: timestamp
    });

    return { callSessionId: args.callSessionId, callFocusText };
  }
});

export const listTagsForEntity = query({
  args: {
    entityId: v.id("entityProfiles")
  },
  handler: async (ctx, args) => {
    await requireOwnedEntity(ctx, args.entityId);
    return await ctx.db
      .query("tags")
      .withIndex("by_workspace_status", (q) => q.eq("entityId", args.entityId).eq("status", "active"))
      .order("asc")
      .take(100);
  }
});

export const upsertTag = mutation({
  args: {
    entityId: v.id("entityProfiles"),
    label: v.string(),
    color: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    await requireOwnedEntity(ctx, args.entityId);
    const timestamp = now();
    const label = cleanText(args.label, 40);
    const normalizedLabel = normalizeLookup(label);
    if (!label || !normalizedLabel) {
      throw new Error("Tag label is required.");
    }

    const existing = await ctx.db
      .query("tags")
      .withIndex("by_workspace_label", (q) => q.eq("entityId", args.entityId).eq("normalizedLabel", normalizedLabel))
      .first();
    const color = normalizeTagColor(args.color);

    if (existing) {
      await ctx.db.patch(existing._id, {
        label,
        color: color ?? existing.color,
        status: "active",
        updatedAt: timestamp
      });
      return { tagId: existing._id };
    }

    const tagId = await ctx.db.insert("tags", {
      entityId: args.entityId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      label,
      normalizedLabel,
      color,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: args.entityId,
      actor: "owner",
      type: "tag.created",
      message: `Owner created tag ${label}.`,
      metadata: { tagId },
      createdAt: timestamp
    });

    return { tagId };
  }
});

export const archiveTag = mutation({
  args: {
    tagId: v.id("tags")
  },
  handler: async (ctx, args) => {
    const tag = await ctx.db.get(args.tagId);
    if (!tag) {
      throw new Error("Tag not found.");
    }
    await requireOwnedEntity(ctx, tag.entityId);
    const timestamp = now();
    await ctx.db.patch(args.tagId, {
      status: "archived",
      updatedAt: timestamp
    });
    await ctx.db.insert("auditEvents", {
      entityId: tag.entityId,
      actor: "owner",
      type: "tag.archived",
      message: `Owner archived tag ${tag.label}.`,
      metadata: { tagId: args.tagId },
      createdAt: timestamp
    });
    return { tagId: args.tagId };
  }
});

export const attachTagToCall = mutation({
  args: {
    callSessionId: v.id("callSessions"),
    tagId: v.id("tags")
  },
  handler: async (ctx, args) => {
    const { identity, callSession } = await requireOwnedCallSession(ctx, args.callSessionId);
    const tag = await ctx.db.get(args.tagId);
    if (!tag || tag.entityId !== callSession.entityId || tag.ownerTokenIdentifier !== identity.tokenIdentifier || tag.status !== "active") {
      throw new Error("Tag not found.");
    }

    const existing = await ctx.db
      .query("callTags")
      .withIndex("by_call_tag", (q: any) => q.eq("callSessionId", args.callSessionId).eq("tagId", args.tagId))
      .first();
    if (existing) {
      return { callTagId: existing._id };
    }

    const timestamp = now();
    const callTagId = await ctx.db.insert("callTags", {
      callSessionId: args.callSessionId,
      entityId: callSession.entityId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      tagId: args.tagId,
      createdAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "owner",
      type: "call_tag.attached",
      message: `Owner tagged call ${tag.label}.`,
      metadata: { tagId: args.tagId, callTagId },
      createdAt: timestamp
    });

    return { callTagId };
  }
});

export const detachTagFromCall = mutation({
  args: {
    callSessionId: v.id("callSessions"),
    tagId: v.id("tags")
  },
  handler: async (ctx, args) => {
    const { callSession } = await requireOwnedCallSession(ctx, args.callSessionId);
    const existing = await ctx.db
      .query("callTags")
      .withIndex("by_call_tag", (q: any) => q.eq("callSessionId", args.callSessionId).eq("tagId", args.tagId))
      .first();
    if (!existing) {
      return { removed: false };
    }

    await ctx.db.delete(existing._id);
    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "owner",
      type: "call_tag.detached",
      message: "Owner removed a tag from the call.",
      metadata: { tagId: args.tagId },
      createdAt: now()
    });

    return { removed: true };
  }
});
