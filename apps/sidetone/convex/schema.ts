import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const entityStatus = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("archived")
);

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

const phoneAssignmentStatus = v.union(
  v.literal("searching"),
  v.literal("ordering"),
  v.literal("configuring"),
  v.literal("active"),
  v.literal("failed"),
  v.literal("released")
);

const zoomInstallStatus = v.union(
  v.literal("active"),
  v.literal("revoked"),
  v.literal("unlinked")
);

const callSessionStatus = v.union(
  v.literal("connecting"),
  v.literal("live"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
  v.literal("cancelled")
);

const callFocusInputMethod = v.union(v.literal("typed"), v.literal("voice"), v.literal("system"));

const discordInstallStatus = v.union(
  v.literal("active"),
  v.literal("revoked"),
  v.literal("unlinked")
);

const discordVoiceCaptureStatus = v.union(
  v.literal("queued"),
  v.literal("joining"),
  v.literal("recording"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
  v.literal("stopped")
);

const billingPlan = v.union(
  v.literal("free"),
  v.literal("smooth_operator"),
  v.literal("premier_pro")
);

const billingSubscriptionStatus = v.union(
  v.literal("free"),
  v.literal("trialing"),
  v.literal("active"),
  v.literal("past_due"),
  v.literal("canceled"),
  v.literal("incomplete"),
  v.literal("incomplete_expired"),
  v.literal("unpaid"),
  v.literal("paused")
);

const stripeMeterStatus = v.union(
  v.literal("not_applicable"),
  v.literal("pending"),
  v.literal("sent"),
  v.literal("failed")
);

const externalEntityType = v.union(
  v.literal("company"),
  v.literal("household"),
  v.literal("deal"),
  v.literal("client"),
  v.literal("account"),
  v.literal("other")
);

const conversationCardKind = v.union(
  v.literal("focus_hit"),
  v.literal("clarify"),
  v.literal("memory"),
  v.literal("risk"),
  v.literal("web_context")
);

const conversationCardStatus = v.union(
  v.literal("new"),
  v.literal("pinned"),
  v.literal("dismissed"),
  v.literal("expired")
);

const liveCardRunStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("skipped"),
  v.literal("routed"),
  v.literal("ready"),
  v.literal("failed")
);

const liveCardAgentRunStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("ready"),
  v.literal("skipped"),
  v.literal("failed")
);

const integrationId = v.union(
  v.literal("buildium"),
  v.literal("rentvine"),
  v.literal("doorloop"),
  v.literal("appfolio"),
  v.literal("rent_manager"),
  v.literal("property_meld"),
  v.literal("yardi_breeze")
);

const integrationConnectionStatus = v.union(
  v.literal("active"),
  v.literal("needs_attention"),
  v.literal("failed"),
  v.literal("revoked")
);

const integrationActionStatus = v.union(
  v.literal("draft"),
  v.literal("approved"),
  v.literal("sent"),
  v.literal("blocked"),
  v.literal("failed"),
  v.literal("cancelled")
);

const conversationCardActionType = v.union(
  v.literal("integration_setup"),
  v.literal("integration_draft")
);

const indexingStatus = v.union(
  v.literal("pending"),
  v.literal("indexed"),
  v.literal("failed"),
  v.literal("skipped")
);

export default defineSchema({
  entityProfiles: defineTable({
    ownerTokenIdentifier: v.string(),
    name: v.string(),
    ownerPhoneNumber: v.optional(v.string()),
    entityType: v.union(v.literal("person"), v.literal("business"), v.literal("team"), v.literal("case"), v.literal("deal")),
    status: entityStatus,
    timezone: v.string(),
    defaultIndustryProfile: v.optional(industryProfile),
    defaultCoachMode: v.optional(coachMode),
    defaultConsentMode: v.union(
      v.literal("conference_disclosure"),
      v.literal("owner_acknowledgment"),
      v.literal("workspace_setting")
    ),
    riskClass: v.union(v.literal("standard"), v.literal("regulated"), v.literal("sensitive")),
    activationContactStatus: v.optional(v.union(v.literal("not_started"), v.literal("saved"), v.literal("skipped"))),
    activationMergeGuideViewedAt: v.optional(v.float64()),
    activationOnboardingPromptPlayedAt: v.optional(v.float64()),
    activationPracticeCallCompletedAt: v.optional(v.float64()),
    identityBackfilledAt: v.optional(v.float64()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_owner", ["ownerTokenIdentifier"])
    .index("by_status", ["status"]),

  phoneNumberAssignments: defineTable({
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    phoneNumber: v.optional(v.string()),
    e164: v.optional(v.string()),
    areaCode: v.optional(v.string()),
    status: phoneAssignmentStatus,
    telnyxPhoneNumberId: v.optional(v.string()),
    telnyxConnectionId: v.optional(v.string()),
    telnyxMessagingProfileId: v.optional(v.string()),
    voiceRoutingStatus: v.optional(v.union(v.literal("missing"), v.literal("configuring"), v.literal("attached"), v.literal("failed"))),
    smsRoutingStatus: v.optional(v.union(v.literal("missing"), v.literal("configuring"), v.literal("attached"), v.literal("failed"))),
    failureReason: v.optional(v.string()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_entity", ["entityId"])
    .index("by_e164", ["e164"])
    .index("by_owner", ["ownerTokenIdentifier"])
    .index("by_phone_number", ["phoneNumber"])
    .index("by_entity_status", ["entityId", "status"]),

  contacts: defineTable({
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    displayName: v.optional(v.string()),
    normalizedDisplayName: v.optional(v.string()),
    roleTitle: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    lastInteractionAt: v.optional(v.float64()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_entity", ["entityId"])
    .index("by_phone", ["phoneNumber"])
    .index("by_entity_name", ["entityId", "normalizedDisplayName"])
    .index("by_phone_entity", ["phoneNumber", "entityId"]),

  billingCustomers: defineTable({
    ownerTokenIdentifier: v.string(),
    clerkUserId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_owner", ["ownerTokenIdentifier"])
    .index("by_clerk_user", ["clerkUserId"])
    .index("by_stripe_customer", ["stripeCustomerId"]),

  billingSubscriptions: defineTable({
    ownerTokenIdentifier: v.string(),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    plan: billingPlan,
    status: billingSubscriptionStatus,
    cancelAtPeriodEnd: v.optional(v.boolean()),
    currentPeriodStart: v.float64(),
    currentPeriodEnd: v.float64(),
    trialStart: v.optional(v.float64()),
    trialEnd: v.optional(v.float64()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_owner", ["ownerTokenIdentifier"])
    .index("by_stripe_customer", ["stripeCustomerId"])
    .index("by_stripe_subscription", ["stripeSubscriptionId"]),

  billingUsagePeriods: defineTable({
    ownerTokenIdentifier: v.string(),
    billingSubscriptionId: v.optional(v.id("billingSubscriptions")),
    plan: billingPlan,
    status: billingSubscriptionStatus,
    periodStart: v.float64(),
    periodEnd: v.float64(),
    allowanceSeconds: v.float64(),
    finalizedUsageSeconds: v.float64(),
    warningSmsSentAt: v.optional(v.float64()),
    graceStartedAt: v.optional(v.float64()),
    cutoffAt: v.optional(v.float64()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_owner_period", ["ownerTokenIdentifier", "periodStart"])
    .index("by_owner_period_end", ["ownerTokenIdentifier", "periodEnd"]),

  phoneCallUsageEvents: defineTable({
    ownerTokenIdentifier: v.string(),
    entityId: v.id("entityProfiles"),
    callSessionId: v.id("callSessions"),
    billingUsagePeriodId: v.id("billingUsagePeriods"),
    planAtUsage: billingPlan,
    statusAtUsage: billingSubscriptionStatus,
    durationSeconds: v.float64(),
    includedSecondsApplied: v.float64(),
    overageMinutes: v.float64(),
    stripeMeterStatus,
    stripeMeterEventId: v.optional(v.string()),
    stripeMeterEventName: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_call_session", ["callSessionId"])
    .index("by_owner", ["ownerTokenIdentifier"])
    .index("by_usage_period", ["billingUsagePeriodId"])
    .index("by_meter_status", ["stripeMeterStatus"])
    .index("by_owner_meter_status", ["ownerTokenIdentifier", "stripeMeterStatus"]),

  stripeWebhookEvents: defineTable({
    stripeEventId: v.string(),
    eventType: v.string(),
    status: v.union(v.literal("received"), v.literal("processed"), v.literal("failed")),
    error: v.optional(v.string()),
    receivedAt: v.float64(),
    processedAt: v.optional(v.float64())
  })
    .index("by_stripe_event", ["stripeEventId"]),

  externalEntities: defineTable({
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    name: v.string(),
    normalizedName: v.string(),
    type: externalEntityType,
    notes: v.optional(v.string()),
    lastInteractionAt: v.optional(v.float64()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_workspace", ["entityId"])
    .index("by_workspace_name", ["entityId", "normalizedName"])
    .index("by_owner", ["ownerTokenIdentifier"]),

  callParticipants: defineTable({
    callSessionId: v.id("callSessions"),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    contactId: v.optional(v.id("contacts")),
    externalEntityId: v.optional(v.id("externalEntities")),
    role: v.union(v.literal("primary"), v.literal("participant"), v.literal("related")),
    displayNameSnapshot: v.optional(v.string()),
    externalEntityNameSnapshot: v.optional(v.string()),
    phoneNumberSnapshot: v.optional(v.string()),
    emailSnapshot: v.optional(v.string()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_call", ["callSessionId"])
    .index("by_call_role", ["callSessionId", "role"])
    .index("by_contact", ["contactId"])
    .index("by_external_entity", ["externalEntityId"])
    .index("by_workspace", ["entityId"]),

  tags: defineTable({
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    label: v.string(),
    normalizedLabel: v.string(),
    color: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_workspace_status", ["entityId", "status"])
    .index("by_workspace_label", ["entityId", "normalizedLabel"])
    .index("by_owner", ["ownerTokenIdentifier"]),

  callTags: defineTable({
    callSessionId: v.id("callSessions"),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    tagId: v.id("tags"),
    createdAt: v.float64()
  })
    .index("by_call", ["callSessionId"])
    .index("by_tag", ["tagId"])
    .index("by_call_tag", ["callSessionId", "tagId"])
    .index("by_workspace", ["entityId"]),

  callSessions: defineTable({
    storedTranscriptSegmentCount: v.optional(v.number()),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    mode: v.union(
      v.literal("conference_in"),
      v.literal("call_through"),
      v.literal("sidetone_session"),
      v.literal("shared_import"),
      v.literal("uploaded_recording"),
      v.literal("discord_voice"),
      v.literal("vexa_meeting"),
      v.literal("zoom_rtms")
    ),
    status: callSessionStatus,
    industryProfile: v.optional(industryProfile),
    coachMode: v.optional(coachMode),
    primaryExternalEntityId: v.optional(v.id("externalEntities")),
    consentMode: v.union(
      v.literal("conference_disclosure"),
      v.literal("owner_acknowledgment"),
      v.literal("workspace_setting")
    ),
    callFocusText: v.optional(v.string()),
    callFocusInputMethod: v.optional(callFocusInputMethod),
    externalIntegration: v.optional(v.object({
      source: v.string(),
      externalId: v.string(),
      callbackUrl: v.string(),
      metadata: v.optional(v.any()),
      deliveredAt: v.optional(v.float64()),
      deliveryStatus: v.optional(v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed")))
    })),
    telnyxCallControlId: v.optional(v.string()),
    telnyxCallSessionId: v.optional(v.string()),
    telnyxConferenceId: v.optional(v.string()),
    publicShareToken: v.optional(v.string()),
    publicShareEnabled: v.optional(v.boolean()),
    publicShareCreatedAt: v.optional(v.float64()),
    publicShareDisabledAt: v.optional(v.float64()),
    startedAt: v.optional(v.float64()),
    endedAt: v.optional(v.float64()),
    failureReason: v.optional(v.string()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_entity", ["entityId"])
    .index("by_entity_primary_external_entity", ["entityId", "primaryExternalEntityId"])
    .index("by_owner", ["ownerTokenIdentifier"])
    .index("by_status", ["status"])
    .index("by_public_share_token", ["publicShareToken"])
    .index("by_telnyx_call_session", ["telnyxCallSessionId"])
    .index("by_telnyx_control", ["telnyxCallControlId"])
    .index("by_external_integration", ["externalIntegration.source", "externalIntegration.externalId"]),

  callImports: defineTable({
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    sourceCallSessionId: v.id("callSessions"),
    sourceOwnerTokenIdentifier: v.string(),
    sourceShareToken: v.string(),
    importedCallSessionId: v.id("callSessions"),
    sourceTitle: v.optional(v.string()),
    importedAt: v.float64(),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_owner", ["ownerTokenIdentifier"])
    .index("by_owner_source_call", ["ownerTokenIdentifier", "sourceCallSessionId"])
    .index("by_imported_call", ["importedCallSessionId"])
    .index("by_share_token", ["sourceShareToken"]),

  callLegs: defineTable({
    callSessionId: v.id("callSessions"),
    entityId: v.id("entityProfiles"),
    role: v.union(v.literal("owner"), v.literal("external"), v.literal("sidetone")),
    phoneNumber: v.optional(v.string()),
    telnyxCallControlId: v.optional(v.string()),
    telnyxCallLegId: v.optional(v.string()),
    status: v.union(v.literal("ringing"), v.literal("answered"), v.literal("ended"), v.literal("failed")),
    startedAt: v.optional(v.float64()),
    endedAt: v.optional(v.float64())
  })
    .index("by_call_session", ["callSessionId"])
    .index("by_telnyx_call_control", ["telnyxCallControlId"])
    .index("by_call_session_role", ["callSessionId", "role"]),

  transcriptSegments: defineTable({
    callSessionId: v.id("callSessions"),
    entityId: v.id("entityProfiles"),
    provider: v.union(v.literal("assemblyai"), v.literal("telnyx"), v.literal("vexa"), v.literal("zoom_rtms"), v.literal("other")),
    speakerLabel: v.optional(v.string()),
    speakerTrack: v.union(v.literal("inbound"), v.literal("outbound"), v.literal("mixed"), v.literal("unknown")),
    text: v.string(),
    startMs: v.float64(),
    endMs: v.float64(),
    confidence: v.optional(v.float64()),
    isFinal: v.boolean(),
    createdAt: v.float64()
  })
    .index("by_call_session", ["callSessionId"])
    .index("by_call_session_time", ["callSessionId", "startMs"]),

  coachCards: defineTable({
    callSessionId: v.id("callSessions"),
    entityId: v.id("entityProfiles"),
    mode: coachMode,
    suggestion: v.string(),
    reason: v.string(),
    priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high")),
    status: v.union(v.literal("new"), v.literal("seen"), v.literal("pinned"), v.literal("dismissed"), v.literal("expired")),
    sourceSegmentIds: v.array(v.id("transcriptSegments")),
    createdAt: v.float64(),
    expiresAt: v.optional(v.float64())
  })
    .index("by_call_session", ["callSessionId"])
    .index("by_call_session_status", ["callSessionId", "status"]),

  conversationCards: defineTable({
    callSessionId: v.id("callSessions"),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    kind: conversationCardKind,
    title: v.string(),
    body: v.string(),
    reason: v.string(),
    priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high")),
    status: conversationCardStatus,
    sourceSegmentIds: v.array(v.id("transcriptSegments")),
    sourceUrls: v.array(v.string()),
    liveCardRunId: v.optional(v.id("liveCardRuns")),
    liveCardAgentRunId: v.optional(v.id("liveCardAgentRuns")),
    agentId: v.optional(v.string()),
    dedupeKey: v.optional(v.string()),
    confidence: v.optional(v.float64()),
    personaWorkflowVersion: v.optional(v.string()),
    actionType: v.optional(conversationCardActionType),
    integrationId: v.optional(integrationId),
    integrationConnectionId: v.optional(v.id("integrationConnections")),
    integrationActionDraftId: v.optional(v.id("integrationActionDrafts")),
    actionLabel: v.optional(v.string()),
    actionHref: v.optional(v.string()),
    createdAt: v.float64(),
    expiresAt: v.optional(v.float64())
  })
    .index("by_call_session", ["callSessionId"])
    .index("by_call_session_status", ["callSessionId", "status"])
    .index("by_call_session_dedupe", ["callSessionId", "dedupeKey"])
    .index("by_entity", ["entityId"]),

  liveCardRuns: defineTable({
    callSessionId: v.id("callSessions"),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    industryProfile: industryProfile,
    personaWorkflowVersion: v.string(),
    supervisorModel: v.optional(v.string()),
    status: liveCardRunStatus,
    sourceSegmentIds: v.array(v.id("transcriptSegments")),
    transcriptWindow: v.string(),
    routedAgentIds: v.array(v.string()),
    skipReason: v.optional(v.string()),
    error: v.optional(v.string()),
    inngestRunId: v.optional(v.string()),
    createdAt: v.float64(),
    updatedAt: v.float64(),
    completedAt: v.optional(v.float64())
  })
    .index("by_call_session", ["callSessionId"])
    .index("by_call_session_status", ["callSessionId", "status"])
    .index("by_owner_status", ["ownerTokenIdentifier", "status"]),

  liveCardAgentRuns: defineTable({
    liveCardRunId: v.id("liveCardRuns"),
    callSessionId: v.id("callSessions"),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    agentId: v.string(),
    specialistModel: v.optional(v.string()),
    status: liveCardAgentRunStatus,
    sourceSegmentIds: v.array(v.id("transcriptSegments")),
    candidate: v.optional(v.any()),
    error: v.optional(v.string()),
    createdAt: v.float64(),
    updatedAt: v.float64(),
    completedAt: v.optional(v.float64())
  })
    .index("by_live_card_run", ["liveCardRunId"])
    .index("by_call_session", ["callSessionId"])
    .index("by_call_session_agent", ["callSessionId", "agentId"]),

  integrationConnections: defineTable({
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    integrationId,
    status: integrationConnectionStatus,
    environment: v.optional(v.union(v.literal("production"), v.literal("sandbox"))),
    displayName: v.optional(v.string()),
    capabilities: v.array(v.string()),
    encryptedCredentials: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    lastTestedAt: v.optional(v.float64()),
    connectedAt: v.optional(v.float64()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_entity", ["entityId"])
    .index("by_entity_integration", ["entityId", "integrationId"])
    .index("by_owner_integration", ["ownerTokenIdentifier", "integrationId"]),

  integrationActionDrafts: defineTable({
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    callSessionId: v.optional(v.id("callSessions")),
    conversationCardId: v.optional(v.id("conversationCards")),
    liveCardRunId: v.optional(v.id("liveCardRuns")),
    liveCardAgentRunId: v.optional(v.id("liveCardAgentRuns")),
    integrationId,
    integrationConnectionId: v.optional(v.id("integrationConnections")),
    actionType: v.string(),
    title: v.string(),
    summary: v.string(),
    payloadJson: v.string(),
    status: integrationActionStatus,
    approvalRequired: v.boolean(),
    externalResultJson: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.float64(),
    updatedAt: v.float64(),
    approvedAt: v.optional(v.float64()),
    sentAt: v.optional(v.float64())
  })
    .index("by_entity", ["entityId"])
    .index("by_call_session", ["callSessionId"])
    .index("by_card", ["conversationCardId"])
    .index("by_owner_status", ["ownerTokenIdentifier", "status"]),

  integrationEntityLinks: defineTable({
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    integrationId,
    externalRecordType: v.string(),
    externalRecordId: v.string(),
    displayName: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    email: v.optional(v.string()),
    unitLabel: v.optional(v.string()),
    source: v.union(v.literal("caller_match"), v.literal("manual"), v.literal("webhook")),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_entity", ["entityId"])
    .index("by_entity_integration", ["entityId", "integrationId"])
    .index("by_external_record", ["integrationId", "externalRecordType", "externalRecordId"])
    .index("by_phone", ["entityId", "phoneNumber"]),

  callArtifacts: defineTable({
    callSessionId: v.id("callSessions"),
    entityId: v.id("entityProfiles"),
    title: v.optional(v.string()),
    callBasis: v.optional(v.string()),
    summary: v.optional(v.string()),
    decisions: v.array(v.string()),
    actionItems: v.array(v.string()),
    risks: v.array(v.string()),
    followUpDraft: v.optional(v.string()),
    crmNoteDraft: v.optional(v.string()),
    nextCallAdvice: v.optional(v.string()),
    promptVersion: v.string(),
    modelName: v.string(),
    transcriptSegmentCount: v.optional(v.float64()),
    transcriptLatestSegmentCreatedAt: v.optional(v.float64()),
    status: v.union(v.literal("draft"), v.literal("ready"), v.literal("failed")),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_call_session", ["callSessionId"])
    .index("by_entity", ["entityId"]),

  callTranscriptChunks: defineTable({
    callSessionId: v.id("callSessions"),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    externalEntityId: v.optional(v.id("externalEntities")),
    chunkText: v.string(),
    startMs: v.float64(),
    endMs: v.float64(),
    segmentIds: v.array(v.id("transcriptSegments")),
    embedding: v.array(v.float64()),
    embeddingModel: v.optional(v.string()),
    status: indexingStatus,
    error: v.optional(v.string()),
    indexedAt: v.optional(v.float64()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_call_session", ["callSessionId"])
    .index("by_entity_status", ["entityId", "status"])
    .index("by_owner_status", ["ownerTokenIdentifier", "status"])
    .searchIndex("search_chunk_text", {
      searchField: "chunkText",
      filterFields: ["ownerTokenIdentifier", "entityId", "externalEntityId", "status"]
    })
    .vectorIndex("vector_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["ownerTokenIdentifier", "entityId", "externalEntityId", "status"]
    })
    .index("by_call_session_status", ["callSessionId", "status"]),

  callIntelligenceRuns: defineTable({
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    question: v.string(),
    selectedCallIds: v.array(v.id("callSessions")),
    filters: v.optional(v.any()),
    retrievedChunkIds: v.array(v.id("callTranscriptChunks")),
    model: v.optional(v.string()),
    plannerModel: v.optional(v.string()),
    answerModel: v.optional(v.string()),
    stage: v.optional(v.union(
      v.literal("queued"),
      v.literal("planning"),
      v.literal("resolving_scope"),
      v.literal("retrieving"),
      v.literal("answering"),
      v.literal("saving")
    )),
    progressMessage: v.optional(v.string()),
    attemptCount: v.optional(v.float64()),
    startedAt: v.optional(v.float64()),
    completedAt: v.optional(v.float64()),
    failedAt: v.optional(v.float64()),
    retrievalPlan: v.optional(v.object({
      intent: v.union(
        v.literal("coverage_check"),
        v.literal("search"),
        v.literal("summarize"),
        v.literal("compare"),
        v.literal("follow_up")
      ),
      topicQueries: v.array(v.string()),
      entityScope: v.object({
        entityId: v.union(v.string(), v.null()),
        entityName: v.union(v.string(), v.null()),
        confidence: v.float64()
      }),
      entityTreatment: v.union(v.literal("scope"), v.literal("topic"), v.literal("dual"), v.literal("none")),
      retrievalLanes: v.array(v.union(v.literal("exact"), v.literal("semantic"), v.literal("entity_calls"))),
      answerStyle: v.union(v.literal("yes_no_with_evidence"), v.literal("list"), v.literal("summary"), v.literal("comparison"))
    })),
    matchedEntities: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      treatment: v.union(v.literal("scope"), v.literal("topic"), v.literal("dual"), v.literal("none")),
      confidence: v.float64()
    }))),
    coverage: v.optional(v.object({
      totalCalls: v.float64(),
      indexedCalls: v.float64(),
      unindexedCalls: v.float64(),
      matchingCalls: v.float64()
    })),
    resultCalls: v.optional(v.array(v.object({
      callSessionId: v.string(),
      title: v.string(),
      callBasis: v.optional(v.string()),
      status: v.string(),
      startedAt: v.optional(v.float64()),
      externalEntityId: v.optional(v.string()),
      tags: v.array(v.object({
        id: v.string(),
        label: v.string(),
        color: v.optional(v.string())
      })),
      snippets: v.array(v.object({
        chunkId: v.string(),
        text: v.string(),
        startMs: v.float64()
      }))
    }))),
    answer: v.optional(v.string()),
    citations: v.array(v.object({
      callSessionId: v.id("callSessions"),
      chunkId: v.optional(v.id("callTranscriptChunks")),
      text: v.string(),
      startMs: v.optional(v.float64())
    })),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    errorCode: v.optional(v.string()),
    error: v.optional(v.string()),
    inngestEventId: v.optional(v.string()),
    inngestRunId: v.optional(v.string()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_entity", ["entityId"])
    .index("by_owner", ["ownerTokenIdentifier"])
    .index("by_owner_status", ["ownerTokenIdentifier", "status"]),

  callDocs: defineTable({
    callSessionId: v.id("callSessions"),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    title: v.string(),
    contentJson: v.optional(v.any()),
    contentHtml: v.string(),
    contentMarkdown: v.optional(v.string()),
    version: v.float64(),
    generatedFromArtifactId: v.optional(v.id("callArtifacts")),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_call_session", ["callSessionId"])
    .index("by_entity", ["entityId"]),

  callArtifactRuns: defineTable({
    callSessionId: v.id("callSessions"),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    provider: v.union(v.literal("openai"), v.literal("anthropic"), v.literal("gemini")),
    modelId: v.string(),
    modelLabel: v.string(),
    isLabRun: v.boolean(),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    decisions: v.array(v.string()),
    actionItems: v.array(v.string()),
    risks: v.array(v.string()),
    followUpDraft: v.optional(v.string()),
    crmNoteDraft: v.optional(v.string()),
    promptVersion: v.string(),
    transcriptSegmentCount: v.optional(v.float64()),
    transcriptLatestSegmentCreatedAt: v.optional(v.float64()),
    error: v.optional(v.string()),
    status: v.union(v.literal("ready"), v.literal("failed")),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_call_session", ["callSessionId"])
    .index("by_owner", ["ownerTokenIdentifier"])
    .index("by_entity", ["entityId"]),

  callRecordings: defineTable({
    callSessionId: v.id("callSessions"),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    provider: v.union(v.literal("telnyx"), v.literal("convex_storage"), v.literal("vexa"), v.literal("zoom_rtms")),
    recordingId: v.string(),
    storageId: v.optional(v.id("_storage")),
    status: v.union(v.literal("ready"), v.literal("failed")),
    source: v.optional(v.union(
      v.literal("call"),
      v.literal("conference"),
      v.literal("upload"),
      v.literal("discord_voice"),
      v.literal("vexa_meeting"),
      v.literal("zoom_rtms")
    )),
    format: v.optional(v.union(
      v.literal("mp3"),
      v.literal("wav"),
      v.literal("m4a"),
      v.literal("webm"),
      v.literal("ogg")
    )),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.float64()),
    channels: v.optional(v.union(v.literal("single"), v.literal("dual"))),
    telnyxCallControlId: v.optional(v.string()),
    telnyxCallLegId: v.optional(v.string()),
    telnyxCallSessionId: v.optional(v.string()),
    telnyxConferenceId: v.optional(v.string()),
    vexaMeetingId: v.optional(v.string()),
    vexaMediaFileId: v.optional(v.string()),
    recordingStartedAt: v.optional(v.float64()),
    recordingEndedAt: v.optional(v.float64()),
    durationMs: v.optional(v.float64()),
    recordingUrls: v.optional(v.object({
      mp3: v.optional(v.string()),
      wav: v.optional(v.string())
    })),
    publicRecordingUrls: v.optional(v.object({
      mp3: v.optional(v.string()),
      wav: v.optional(v.string())
    })),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_call_session", ["callSessionId"])
    .index("by_recording_id", ["recordingId"]),

  uploadedRecordings: defineTable({
    callSessionId: v.id("callSessions"),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.float64(),
    status: v.union(
      v.literal("uploaded"),
      v.literal("transcribing"),
      v.literal("generating_notes"),
      v.literal("ready"),
      v.literal("failed")
    ),
    assemblyAiTranscriptId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_call_session", ["callSessionId"])
    .index("by_owner", ["ownerTokenIdentifier"])
    .index("by_status", ["status"]),

  vexaMeetingCaptures: defineTable({
    callSessionId: v.id("callSessions"),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    platform: v.union(v.literal("google_meet"), v.literal("teams"), v.literal("zoom")),
    nativeMeetingId: v.string(),
    meetingUrl: v.optional(v.string()),
    botName: v.optional(v.string()),
    language: v.optional(v.string()),
    status: v.union(
      v.literal("requested"),
      v.literal("joining"),
      v.literal("transcribing"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("stopped")
    ),
    vexaMeetingId: v.optional(v.float64()),
    vexaStatus: v.optional(v.string()),
    lastTranscriptAt: v.optional(v.float64()),
    segmentCount: v.optional(v.float64()),
    error: v.optional(v.string()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_owner", ["ownerTokenIdentifier"])
    .index("by_call_session", ["callSessionId"])
    .index("by_status", ["status"]),

  zoomRtmsCaptures: defineTable({
    callSessionId: v.id("callSessions"),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    zoomMeetingId: v.string(),
    zoomMeetingUuid: v.optional(v.string()),
    meetingUrl: v.optional(v.string()),
    rtmsStreamId: v.optional(v.string()),
    serverUrls: v.optional(v.string()),
    status: v.union(
      v.literal("waiting"),
      v.literal("streaming"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("stopped")
    ),
    transcriptSegmentCount: v.optional(v.float64()),
    lastTranscriptAt: v.optional(v.float64()),
    recordingId: v.optional(v.string()),
    error: v.optional(v.string()),
    startedAt: v.optional(v.float64()),
    stoppedAt: v.optional(v.float64()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_owner", ["ownerTokenIdentifier"])
    .index("by_call_session", ["callSessionId"])
    .index("by_zoom_meeting", ["zoomMeetingId"])
    .index("by_zoom_meeting_status", ["zoomMeetingId", "status"])
    .index("by_stream", ["rtmsStreamId"])
    .index("by_status", ["status"]),

  zoomInstallations: defineTable({
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    zoomClientId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    tokenType: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
    status: zoomInstallStatus,
    authorizedAt: v.float64(),
    expiresAt: v.optional(v.float64()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_owner", ["ownerTokenIdentifier"])
    .index("by_owner_client", ["ownerTokenIdentifier", "zoomClientId"])
    .index("by_owner_entity_status", ["ownerTokenIdentifier", "entityId", "status"]),

  discordInstallations: defineTable({
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    discordApplicationId: v.optional(v.string()),
    discordGuildId: v.string(),
    discordGuildName: v.optional(v.string()),
    discordUserId: v.string(),
    discordUsername: v.optional(v.string()),
    status: discordInstallStatus,
    installedAt: v.optional(v.float64()),
    linkedAt: v.float64(),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_owner", ["ownerTokenIdentifier"])
    .index("by_guild", ["discordGuildId"])
    .index("by_guild_user", ["discordGuildId", "discordUserId"])
    .index("by_user", ["discordUserId"])
    .index("by_guild_user_status", ["discordGuildId", "discordUserId", "status"])
    .index("by_owner_entity", ["ownerTokenIdentifier", "entityId"]),

  discordVoiceCaptures: defineTable({
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    callSessionId: v.optional(v.id("callSessions")),
    discordInstallationId: v.optional(v.id("discordInstallations")),
    discordGuildId: v.string(),
    discordGuildName: v.optional(v.string()),
    discordChannelId: v.optional(v.string()),
    discordChannelName: v.optional(v.string()),
    discordStartedByUserId: v.string(),
    discordStartedByUsername: v.optional(v.string()),
    workerSessionId: v.optional(v.string()),
    status: discordVoiceCaptureStatus,
    storageId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.float64()),
    durationMs: v.optional(v.float64()),
    participantCount: v.optional(v.float64()),
    callFocusText: v.optional(v.string()),
    industryProfile: v.optional(industryProfile),
    error: v.optional(v.string()),
    startedAt: v.optional(v.float64()),
    stoppedAt: v.optional(v.float64()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_owner", ["ownerTokenIdentifier"])
    .index("by_call_session", ["callSessionId"])
    .index("by_guild_status", ["discordGuildId", "status"])
    .index("by_guild_channel_status", ["discordGuildId", "discordChannelId", "status"])
    .index("by_status", ["status"])
    .index("by_owner_entity", ["ownerTokenIdentifier", "entityId"]),

  ownerNotifications: defineTable({
    entityId: v.id("entityProfiles"),
    callSessionId: v.id("callSessions"),
    channel: v.union(v.literal("sms")),
    purpose: v.union(v.literal("owner_call_summary"), v.literal("merge_reminder")),
    status: v.union(v.literal("sending"), v.literal("sent"), v.literal("failed"), v.literal("skipped")),
    toPhoneNumber: v.string(),
    provider: v.optional(v.literal("telnyx")),
    providerMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.float64(),
    updatedAt: v.float64()
  })
    .index("by_call_purpose_channel", ["callSessionId", "purpose", "channel"])
    .index("by_provider_message", ["providerMessageId"])
    .index("by_entity", ["entityId"]),

  consentRecords: defineTable({
    entityId: v.id("entityProfiles"),
    callSessionId: v.id("callSessions"),
    mode: v.union(v.literal("conference_disclosure"), v.literal("owner_acknowledgment"), v.literal("workspace_setting")),
    disclosureText: v.string(),
    recordedAt: v.float64(),
    source: v.union(v.literal("voice_prompt"), v.literal("owner_setting"), v.literal("manual"))
  })
    .index("by_call_session", ["callSessionId"])
    .index("by_entity", ["entityId"]),

  auditEvents: defineTable({
    entityId: v.optional(v.id("entityProfiles")),
    callSessionId: v.optional(v.id("callSessions")),
    actor: v.union(
      v.literal("owner"),
      v.literal("system"),
      v.literal("telnyx"),
      v.literal("assemblyai"),
      v.literal("stripe"),
      v.literal("discord"),
      v.literal("vexa"),
      v.literal("zoom")
    ),
    type: v.string(),
    message: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.float64()
  })
    .index("by_entity", ["entityId"])
    .index("by_call_session", ["callSessionId"]),

  webhookEvents: defineTable({
    provider: v.union(v.literal("telnyx"), v.literal("assemblyai"), v.literal("stripe"), v.literal("discord")),
    providerEventId: v.string(),
    eventType: v.string(),
    entityId: v.optional(v.id("entityProfiles")),
    callSessionId: v.optional(v.id("callSessions")),
    status: v.union(v.literal("received"), v.literal("processed"), v.literal("ignored"), v.literal("failed")),
    payload: v.optional(v.any()),
    error: v.optional(v.string()),
    receivedAt: v.float64(),
    processedAt: v.optional(v.float64())
  })
    .index("by_provider_event", ["provider", "providerEventId"])
    .index("by_call_session", ["callSessionId"])
    .index("by_entity", ["entityId"])
});
