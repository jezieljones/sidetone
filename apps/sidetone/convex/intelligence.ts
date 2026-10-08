import { readTranscript, normalizeSegments, MAX_TRANSCRIPT_SEGMENTS } from "./transcriptLimits";
import { v } from "convex/values";
import {
  integrationDescriptorsForPersona,
  isSidetoneIntegrationId,
  liveCardWorkflowFor,
  normalizeIndustryProfileId
} from "@sidetone/contracts";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAuthenticatedIdentity, requireOwnedEntity } from "./auth";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const industryProfileArg = v.union(
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
const callStatusArg = v.union(
  v.literal("connecting"),
  v.literal("live"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
  v.literal("cancelled")
);
const searchFilterArgs = {
  contactId: v.optional(v.id("contacts")),
  externalEntityId: v.optional(v.id("externalEntities")),
  tagIds: v.optional(v.array(v.id("tags"))),
  industryProfile: v.optional(industryProfileArg),
  status: v.optional(callStatusArg),
  dateFrom: v.optional(v.float64()),
  dateTo: v.optional(v.float64())
};

type RetrievalIntent = "coverage_check" | "search" | "summarize" | "compare" | "follow_up";
type EntityTreatment = "scope" | "topic" | "dual" | "none";
type RetrievalLane = "exact" | "semantic" | "entity_calls";
type AnswerStyle = "yes_no_with_evidence" | "list" | "summary" | "comparison";
type EntityCandidate = {
  id: string;
  name: string;
  score: number;
  matchedText: string;
};

type RetrievalPlan = {
  intent: RetrievalIntent;
  topicQueries: string[];
  entityScope: { entityId: string | null; entityName: string | null; confidence: number };
  entityTreatment: EntityTreatment;
  retrievalLanes: RetrievalLane[];
  answerStyle: AnswerStyle;
};

const runStageArg = v.union(
  v.literal("queued"),
  v.literal("planning"),
  v.literal("resolving_scope"),
  v.literal("retrieving"),
  v.literal("answering"),
  v.literal("saving")
);

const runStatusArg = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("ready"),
  v.literal("failed"),
  v.literal("cancelled")
);

function now() {
  return Date.now();
}

async function requireOwnedEntityForToken(ctx: any, entityId: any, ownerTokenIdentifier: string) {
  const entity = await ctx.db.get(entityId);
  if (!entity || entity.ownerTokenIdentifier !== ownerTokenIdentifier) {
    throw new Error("Workspace not found.");
  }
  return entity;
}

function zeroEmbedding() {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
}

function cleanText(value?: string | null, maxLength = 8000) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function transcriptTextIsMeaningful(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized.length < 24) {
    return false;
  }
  return !/this call is being (recorded|transcribed)|sidetone is (listening|recording)|may be recorded|welcome to sidetone|tap add call|merge calls|start taking notes/i.test(normalized);
}

function cardFingerprint(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function callModeLabel(mode?: string) {
  if (mode === "sidetone_session") {
    return "Sidetone session";
  }
  if (mode === "call_through") {
    return "Call-through";
  }
  if (mode === "uploaded_recording") {
    return "Uploaded recording";
  }
  if (mode === "shared_import") {
    return "Shared call";
  }
  if (mode === "discord_voice") {
    return "Discord voice";
  }
  if (mode === "vexa_meeting") {
    return "Meeting";
  }
  if (mode === "zoom_rtms") {
    return "Zoom RTMS";
  }
  return "Conference-in";
}

function responseTextFromResponses(response: any) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const chunks = response.output
    ?.flatMap((item: any) => item.content ?? [])
    ?.map((content: any) => content.text)
    ?.filter(Boolean);
  return chunks?.join("\n") ?? "";
}

function splitIntoChunks(segments: Array<{ _id: any; text: string; startMs: number; endMs: number }>) {
  const chunks: Array<{
    chunkText: string;
    startMs: number;
    endMs: number;
    segmentIds: any[];
  }> = [];
  let currentText: string[] = [];
  let currentIds: any[] = [];
  let startMs = 0;
  let endMs = 0;

  for (const segment of segments) {
    if (!transcriptTextIsMeaningful(segment.text)) {
      continue;
    }
    if (!currentText.length) {
      startMs = segment.startMs;
    }
    currentText.push(segment.text);
    currentIds.push(segment._id);
    endMs = segment.endMs;
    const joined = currentText.join(" ");
    if (joined.length >= 1200) {
      chunks.push({ chunkText: joined, startMs, endMs, segmentIds: currentIds });
      currentText = [];
      currentIds = [];
    }
  }

  if (currentText.length) {
    chunks.push({ chunkText: currentText.join(" "), startMs, endMs, segmentIds: currentIds });
  }
  return chunks.slice(0, 80);
}

async function embedTexts(texts: string[]) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return texts.map(() => zeroEmbedding());
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI embeddings failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  }

  const body = await response.json();
  return (body.data ?? []).map((item: any) => item.embedding as number[]);
}

async function sendInngestEvent(name: string, data: Record<string, unknown>) {
  const eventKey = process.env.INNGEST_EVENT_KEY?.trim();
  const devMode = process.env.INNGEST_DEV === "1" || process.env.INNGEST_DEV === "true";
  if (!eventKey && !devMode) {
    throw new Error("INNGEST_EVENT_KEY is not configured.");
  }
  const baseUrl = (
    process.env.INNGEST_BASE_URL
    ?? process.env.INNGEST_DEV_SERVER_URL
    ?? (devMode ? "http://localhost:8288" : "https://inn.gs")
  ).replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/e/${encodeURIComponent(eventKey ?? "local")}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify([{
      name,
      data
    }])
  });
  if (!response.ok) {
    throw new Error(`Unable to enqueue ${name} (${response.status}): ${(await response.text()).slice(0, 500)}`);
  }
  const body = await response.json().catch(() => null);
  if (body?.error || (typeof body?.status === "number" && body.status >= 400)) {
    throw new Error(`Unable to enqueue ${name}: ${String(body.error ?? body.status)}`);
  }
  return Array.isArray(body?.ids) ? String(body.ids[0] ?? "") : undefined;
}

async function sendCallIntelligenceRunEvent(runId: string) {
  return await sendInngestEvent("sidetone/call-intelligence.requested", { runId });
}

async function sendLiveCardSegmentEvent(input: {
  callSessionId: string;
  segmentIds: string[];
}) {
  return await sendInngestEvent("sidetone/live-card.segment-created", input);
}

function normalizeSearchText(value?: string | null) {
  return cleanText(value, 400)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
}

function hasEntityScopeLanguage(question: string, entityName: string) {
  const normalizedQuestion = ` ${normalizeSearchText(question)} `;
  const normalizedName = normalizeSearchText(entityName);
  if (!normalizedName) {
    return false;
  }
  return [
    ` calls with ${normalizedName} `,
    ` call with ${normalizedName} `,
    ` with ${normalizedName} `,
    ` calls for ${normalizedName} `,
    ` call for ${normalizedName} `,
    ` for ${normalizedName} `,
    ` ${normalizedName} calls `,
    ` ${normalizedName} call `,
    ` ${normalizedName} account `,
    ` ${normalizedName} customer `,
    ` ${normalizedName} client `
  ].some((needle) => normalizedQuestion.includes(needle));
}

function normalizePlan(plan: Partial<RetrievalPlan> | null, question: string, candidates: EntityCandidate[]): RetrievalPlan {
  const scopedCandidate = plan?.entityScope?.entityId
    ? candidates.find((candidate) => candidate.id === plan.entityScope?.entityId)
    : null;
  const fallbackCandidate = candidates.find((candidate) => hasEntityScopeLanguage(question, candidate.name));
  const entityCandidate = scopedCandidate ?? fallbackCandidate ?? null;
  const entityTreatment: EntityTreatment = plan?.entityTreatment && ["scope", "topic", "dual", "none"].includes(plan.entityTreatment)
    ? plan.entityTreatment
    : entityCandidate
      ? "scope"
      : "none";
  const topicQueries = (plan?.topicQueries ?? [question])
    .map((query) => cleanText(query, 180))
    .filter((query): query is string => Boolean(query))
    .slice(0, 3);
  const retrievalLanes = (plan?.retrievalLanes ?? ["exact", "semantic"])
    .filter((lane): lane is RetrievalLane => lane === "exact" || lane === "semantic" || lane === "entity_calls")
    .slice(0, 3);

  return {
    intent: plan?.intent && ["coverage_check", "search", "summarize", "compare", "follow_up"].includes(plan.intent)
      ? plan.intent
      : /\b(did|do|ever|covered|cover|mention|mentions|talk about|talked about)\b/i.test(question)
        ? "coverage_check"
        : "search",
    topicQueries: topicQueries.length ? topicQueries : [question],
    entityScope: {
      entityId: entityTreatment === "scope" || entityTreatment === "dual" ? entityCandidate?.id ?? null : null,
      entityName: entityTreatment === "scope" || entityTreatment === "dual" ? entityCandidate?.name ?? null : null,
      confidence: entityCandidate ? Math.min(0.98, Math.max(0.1, entityCandidate.score)) : 0
    },
    entityTreatment,
    retrievalLanes: retrievalLanes.length ? retrievalLanes : ["exact", "semantic"],
    answerStyle: plan?.answerStyle && ["yes_no_with_evidence", "list", "summary", "comparison"].includes(plan.answerStyle)
      ? plan.answerStyle
      : /\b(did|do|ever|covered|cover)\b/i.test(question)
        ? "yes_no_with_evidence"
        : "summary"
  };
}

function fallbackRetrievalPlan(question: string, candidates: EntityCandidate[]): RetrievalPlan {
  const scopedCandidate = candidates.find((candidate) => hasEntityScopeLanguage(question, candidate.name));
  return normalizePlan({
    intent: /\b(did|do|ever|covered|cover|mention|mentions|talk about|talked about)\b/i.test(question)
      ? "coverage_check"
      : "search",
    topicQueries: [question],
    entityScope: {
      entityId: scopedCandidate?.id ?? null,
      entityName: scopedCandidate?.name ?? null,
      confidence: scopedCandidate ? scopedCandidate.score : 0
    },
    entityTreatment: scopedCandidate ? "scope" : "none",
    retrievalLanes: scopedCandidate ? ["exact", "semantic", "entity_calls"] : ["exact", "semantic"],
    answerStyle: /\b(did|do|ever|covered|cover)\b/i.test(question)
      ? "yes_no_with_evidence"
      : "summary"
  }, question, candidates);
}

async function planCallIntelligenceRetrieval(input: {
  question: string;
  candidates: EntityCandidate[];
  stats: { totalCalls: number; indexedCalls: number; savedEntities: number };
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.SIDETONE_CALL_INTELLIGENCE_PLANNER_MODEL?.trim()
    || process.env.SIDETONE_CALL_INTELLIGENCE_MODEL?.trim()
    || "gpt-5.4-mini";
  if (!apiKey) {
    return { plan: fallbackRetrievalPlan(input.question, input.candidates), model: "sidetone-deterministic" };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [
              "You are Sidetone's bounded retrieval planner.",
              "Return JSON only. Decide how to retrieve call evidence; do not answer the user.",
              "Use entity scope only when the wording clearly scopes calls with/for an entity.",
              "If an entity name appears as a topic, use entityTreatment topic.",
              "For ambiguous entity/topic usage, use dual."
            ].join(" ")
          },
          {
            role: "user",
            content: JSON.stringify({
              question: input.question,
              entityCandidates: input.candidates.slice(0, 8),
              workspaceStats: input.stats
            })
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "call_intelligence_plan",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                intent: { type: "string", enum: ["coverage_check", "search", "summarize", "compare", "follow_up"] },
                topicQueries: { type: "array", items: { type: "string" } },
                entityScope: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    entityId: { anyOf: [{ type: "string" }, { type: "null" }] },
                    entityName: { anyOf: [{ type: "string" }, { type: "null" }] },
                    confidence: { type: "number" }
                  },
                  required: ["entityId", "entityName", "confidence"]
                },
                entityTreatment: { type: "string", enum: ["scope", "topic", "dual", "none"] },
                retrievalLanes: {
                  type: "array",
                  items: { type: "string", enum: ["exact", "semantic", "entity_calls"] }
                },
                answerStyle: { type: "string", enum: ["yes_no_with_evidence", "list", "summary", "comparison"] }
              },
              required: ["intent", "topicQueries", "entityScope", "entityTreatment", "retrievalLanes", "answerStyle"]
            }
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Planner failed (${response.status})`);
    }
    const parsed = JSON.parse(responseTextFromResponses(await response.json()));
    return { plan: normalizePlan(parsed, input.question, input.candidates), model };
  } catch {
    return { plan: fallbackRetrievalPlan(input.question, input.candidates), model: "sidetone-deterministic" };
  }
}

const liveCardKindArg = v.union(
  v.literal("focus_hit"),
  v.literal("clarify"),
  v.literal("memory"),
  v.literal("risk"),
  v.literal("web_context")
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

const cardActionArg = v.object({
  type: v.union(v.literal("integration_setup"), v.literal("integration_draft")),
  integrationId: integrationIdArg,
  label: v.optional(v.string()),
  href: v.optional(v.string())
});

const integrationActionDraftArg = v.object({
  integrationId: integrationIdArg,
  actionType: v.string(),
  title: v.string(),
  summary: v.string(),
  payloadJson: v.string()
});

const liveCardCandidateArg = v.object({
  emit: v.boolean(),
  kind: v.optional(liveCardKindArg),
  title: v.optional(v.string()),
  body: v.optional(v.string()),
  reason: v.optional(v.string()),
  priority: v.optional(v.union(v.literal("low"), v.literal("normal"), v.literal("high"))),
  confidence: v.optional(v.float64()),
  dedupeKey: v.optional(v.string()),
  sourceSegmentIds: v.optional(v.array(v.id("transcriptSegments"))),
  sourceUrls: v.optional(v.array(v.string())),
  toolActionDraft: v.optional(v.any()),
  cardAction: v.optional(cardActionArg),
  integrationActionDraft: v.optional(integrationActionDraftArg),
  skipReason: v.optional(v.string())
});

function formatLiveCardSegment(segment: { speakerLabel?: string; startMs: number; text: string }) {
  const timestamp = Math.max(0, Math.round(segment.startMs / 1000));
  const minutes = Math.floor(timestamp / 60);
  const seconds = String(timestamp % 60).padStart(2, "0");
  const speaker = segment.speakerLabel ? `${segment.speakerLabel}: ` : "";
  return `[${minutes}:${seconds}] ${speaker}${segment.text}`;
}

function clampConfidence(value?: number) {
  return Math.max(0, Math.min(1, typeof value === "number" && Number.isFinite(value) ? value : 0));
}

function liveCardKindFor(value?: string) {
  return value === "focus_hit"
    || value === "memory"
    || value === "risk"
    || value === "web_context"
    ? value
    : "clarify";
}

function safePayloadJson(value?: string) {
  if (!value) {
    return "{}";
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "{}";
    }
    return JSON.stringify(parsed).slice(0, 12_000);
  } catch {
    return "{}";
  }
}

export const liveCardSegmentContextInternal = internalQuery({
  args: {
    callSessionId: v.id("callSessions"),
    segmentId: v.id("transcriptSegments")
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    const segment = await ctx.db.get(args.segmentId);
    if (!callSession || !segment || segment.callSessionId !== args.callSessionId) {
      return null;
    }
    return { callSession, segment };
  }
});

export const enqueueLiveCardSegmentInternal = internalAction({
  args: {
    callSessionId: v.id("callSessions"),
    segmentId: v.id("transcriptSegments")
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.intelligence.liveCardSegmentContextInternal, args);
    if (!context || !["connecting", "live"].includes(context.callSession.status)) {
      return { enqueued: false, reason: "not_active" };
    }
    if (!transcriptTextIsMeaningful(context.segment.text)) {
      return { enqueued: false, reason: "no_signal" };
    }
    const entitlements = await ctx.runQuery(internal.billing.entitlementsForOwnerTokenInternal, {
      ownerTokenIdentifier: context.callSession.ownerTokenIdentifier
    });
    if (!entitlements.callIntelligence) {
      return { enqueued: false, reason: "not_entitled" };
    }
    const eventId = await sendLiveCardSegmentEvent({
      callSessionId: String(args.callSessionId),
      segmentIds: [String(args.segmentId)]
    });
    return { enqueued: true, eventId };
  }
});

export const liveCardRunContextInternal = internalQuery({
  args: {
    callSessionId: v.id("callSessions"),
    sourceSegmentIds: v.array(v.id("transcriptSegments"))
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      return null;
    }
    const entity = await ctx.db.get(callSession.entityId);
    const sourceSegments = (await Promise.all(args.sourceSegmentIds.map((segmentId) => ctx.db.get(segmentId))))
      .filter((segment) => segment && segment.callSessionId === args.callSessionId);
    const recentSegments = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_call_session_time", (q) => q.eq("callSessionId", args.callSessionId))
      .order("desc")
      .take(16);
    const activeCards = await ctx.db
      .query("conversationCards")
      .withIndex("by_call_session_status", (q) => q.eq("callSessionId", args.callSessionId).eq("status", "new"))
      .order("desc")
      .take(8);
    const integrationConnections = await ctx.db
      .query("integrationConnections")
      .withIndex("by_entity", (q) => q.eq("entityId", callSession.entityId))
      .take(32);
    return {
      callSession,
      entity,
      sourceSegments,
      recentSegments: recentSegments.reverse(),
      activeCards,
      integrationConnections: integrationConnections.map((connection) => ({
        _id: connection._id,
        integrationId: connection.integrationId,
        status: connection.status,
        environment: connection.environment,
        displayName: connection.displayName,
        capabilities: connection.capabilities ?? [],
        hasCredentials: Boolean(connection.encryptedCredentials),
        failureReason: connection.failureReason,
        lastTestedAt: connection.lastTestedAt,
        connectedAt: connection.connectedAt
      }))
    };
  }
});

export const createLiveCardRunInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    sourceSegmentIds: v.array(v.id("transcriptSegments")),
    transcriptWindow: v.string(),
    industryProfile: industryProfileArg,
    personaWorkflowVersion: v.string(),
    supervisorModel: v.optional(v.string()),
    inngestRunId: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      throw new Error("Call session not found.");
    }
    const timestamp = now();
    const liveCardRunId = await ctx.db.insert("liveCardRuns", {
      callSessionId: args.callSessionId,
      entityId: callSession.entityId,
      ownerTokenIdentifier: callSession.ownerTokenIdentifier,
      industryProfile: args.industryProfile,
      personaWorkflowVersion: args.personaWorkflowVersion,
      supervisorModel: args.supervisorModel,
      status: "running",
      sourceSegmentIds: args.sourceSegmentIds,
      transcriptWindow: args.transcriptWindow,
      routedAgentIds: [],
      inngestRunId: args.inngestRunId,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    return { liveCardRunId };
  }
});

export const prepareLiveCardRunInternal = internalAction({
  args: {
    callSessionId: v.id("callSessions"),
    sourceSegmentIds: v.array(v.id("transcriptSegments")),
    supervisorModel: v.optional(v.string()),
    inngestRunId: v.optional(v.string())
  },
  handler: async (ctx, args): Promise<any> => {
    const uniqueSourceSegmentIds = Array.from(new Set(args.sourceSegmentIds));
    const context: any = await ctx.runQuery(internal.intelligence.liveCardRunContextInternal, {
      callSessionId: args.callSessionId,
      sourceSegmentIds: uniqueSourceSegmentIds
    });
    if (!context || !["connecting", "live"].includes(context.callSession.status)) {
      return { skip: true, reason: "not_active" };
    }
    if (!context.sourceSegments.some((segment: any) => transcriptTextIsMeaningful(segment.text))) {
      return { skip: true, reason: "no_signal" };
    }
    const entitlements = await ctx.runQuery(internal.billing.entitlementsForOwnerTokenInternal, {
      ownerTokenIdentifier: context.callSession.ownerTokenIdentifier
    });
    if (!entitlements.callIntelligence) {
      return { skip: true, reason: "not_entitled" };
    }

    const industryProfile = normalizeIndustryProfileId(context.callSession.industryProfile);
    const workflow = liveCardWorkflowFor(industryProfile);
    const integrationDescriptors = integrationDescriptorsForPersona(industryProfile);
    const integrationConnectionById = new Map(
      (context.integrationConnections ?? []).map((connection: any) => [connection.integrationId, connection])
    );
    const integrations = integrationDescriptors.map((descriptor) => {
      const connection = integrationConnectionById.get(descriptor.id) as any;
      return {
        id: descriptor.id,
        label: descriptor.label,
        status: descriptor.status,
        connectionType: descriptor.connectionType,
        writePolicy: descriptor.writePolicy,
        capabilities: descriptor.capabilities,
        audienceTags: descriptor.audienceTags,
        connection: connection
          ? {
            _id: connection._id,
            status: connection.status,
            environment: connection.environment,
            displayName: connection.displayName,
            capabilities: connection.capabilities ?? [],
            hasCredentials: Boolean(connection.hasCredentials),
            failureReason: connection.failureReason,
            lastTestedAt: connection.lastTestedAt,
            connectedAt: connection.connectedAt
          }
          : null
      };
    });
    const transcriptWindow: string = context.recentSegments
      .filter((segment: any) => transcriptTextIsMeaningful(segment.text))
      .map(formatLiveCardSegment)
      .join("\n")
      .slice(-6000);
    if (!transcriptWindow) {
      return { skip: true, reason: "no_signal" };
    }

    const created: { liveCardRunId: any } = await ctx.runMutation(internal.intelligence.createLiveCardRunInternal, {
      callSessionId: args.callSessionId,
      sourceSegmentIds: uniqueSourceSegmentIds,
      transcriptWindow,
      industryProfile,
      personaWorkflowVersion: workflow.version,
      supervisorModel: args.supervisorModel,
      inngestRunId: args.inngestRunId
    });

    return {
      skip: false,
      liveCardRunId: created.liveCardRunId,
      transcriptWindow,
      callSession: {
        _id: context.callSession._id,
        status: context.callSession.status,
        mode: context.callSession.mode,
        industryProfile,
        callFocusText: context.callSession.callFocusText
      },
      entity: context.entity,
      sourceSegments: context.sourceSegments,
      recentSegments: context.recentSegments,
      activeCards: context.activeCards,
      integrations,
      workflow
    };
  }
});

export const completeLiveCardRunInternal = internalMutation({
  args: {
    liveCardRunId: v.id("liveCardRuns"),
    status: v.union(v.literal("skipped"), v.literal("routed"), v.literal("ready"), v.literal("failed")),
    routedAgentIds: v.optional(v.array(v.string())),
    skipReason: v.optional(v.string()),
    error: v.optional(v.string()),
    supervisorModel: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.liveCardRunId);
    if (!run) {
      return { ok: false, skip: true };
    }
    const timestamp = now();
    await ctx.db.patch(args.liveCardRunId, {
      status: args.status,
      routedAgentIds: args.routedAgentIds ?? run.routedAgentIds,
      skipReason: args.skipReason,
      error: args.error,
      supervisorModel: args.supervisorModel ?? run.supervisorModel,
      completedAt: args.status === "routed" ? run.completedAt : timestamp,
      updatedAt: timestamp
    });
    return { ok: true };
  }
});

export const prepareLiveCardAgentRunInternal = internalMutation({
  args: {
    liveCardRunId: v.id("liveCardRuns"),
    agentId: v.string(),
    specialistModel: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.liveCardRunId);
    if (!run || run.status === "failed" || run.status === "skipped") {
      return { skip: true, reason: "run_unavailable" };
    }
    const callSession = await ctx.db.get(run.callSessionId);
    if (!callSession) {
      return { skip: true, reason: "call_unavailable" };
    }
    const workflow = liveCardWorkflowFor(run.industryProfile);
    const specialist = workflow.specialists.find((candidate) => candidate.id === args.agentId);
    if (!specialist) {
      return { skip: true, reason: "unknown_agent" };
    }
    const timestamp = now();
    const liveCardAgentRunId = await ctx.db.insert("liveCardAgentRuns", {
      liveCardRunId: args.liveCardRunId,
      callSessionId: run.callSessionId,
      entityId: run.entityId,
      ownerTokenIdentifier: run.ownerTokenIdentifier,
      agentId: args.agentId,
      specialistModel: args.specialistModel,
      status: "running",
      sourceSegmentIds: run.sourceSegmentIds,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const sourceSegments = (await Promise.all(run.sourceSegmentIds.map((segmentId) => ctx.db.get(segmentId))))
      .filter((segment) => segment && segment.callSessionId === run.callSessionId);
    const activeCards = await ctx.db
      .query("conversationCards")
      .withIndex("by_call_session_status", (q) => q.eq("callSessionId", run.callSessionId).eq("status", "new"))
      .order("desc")
      .take(8);
    const integrationConnections = await ctx.db
      .query("integrationConnections")
      .withIndex("by_entity", (q) => q.eq("entityId", run.entityId))
      .take(32);
    const integrationConnectionById = new Map(
      integrationConnections.map((connection) => [connection.integrationId, connection])
    );
    const integrations = integrationDescriptorsForPersona(run.industryProfile).map((descriptor) => {
      const connection = integrationConnectionById.get(descriptor.id);
      return {
        id: descriptor.id,
        label: descriptor.label,
        status: descriptor.status,
        connectionType: descriptor.connectionType,
        writePolicy: descriptor.writePolicy,
        capabilities: descriptor.capabilities,
        audienceTags: descriptor.audienceTags,
        connection: connection
          ? {
            _id: connection._id,
            status: connection.status,
            environment: connection.environment,
            displayName: connection.displayName,
            capabilities: connection.capabilities ?? [],
            hasCredentials: Boolean(connection.encryptedCredentials),
            failureReason: connection.failureReason,
            lastTestedAt: connection.lastTestedAt,
            connectedAt: connection.connectedAt
          }
          : null
      };
    });
    return {
      skip: false,
      liveCardAgentRunId,
      run,
      callSession,
      sourceSegments,
      activeCards,
      integrations,
      workflow,
      specialist
    };
  }
});

export const completeLiveCardAgentRunInternal = internalMutation({
  args: {
    liveCardAgentRunId: v.id("liveCardAgentRuns"),
    specialistModel: v.optional(v.string()),
    candidate: liveCardCandidateArg
  },
  handler: async (ctx, args) => {
    const agentRun = await ctx.db.get(args.liveCardAgentRunId);
    if (!agentRun) {
      return { ok: false, skip: true, reason: "agent_run_unavailable" };
    }
    const run = await ctx.db.get(agentRun.liveCardRunId);
    if (!run) {
      return { ok: false, skip: true, reason: "run_unavailable" };
    }
    const workflow = liveCardWorkflowFor(run.industryProfile);
    const timestamp = now();
    const confidence = clampConfidence(args.candidate.confidence);
    const title = cleanText(args.candidate.title, 120);
    const body = cleanText(args.candidate.body, 280);
    const reason = cleanText(args.candidate.reason, 280);
    const sourceSegmentIds = args.candidate.sourceSegmentIds?.length
      ? args.candidate.sourceSegmentIds
      : agentRun.sourceSegmentIds;
    const sourceUrls = args.candidate.sourceUrls ?? [];
    const dedupeKey = cleanText(args.candidate.dedupeKey, 180)
      ?? cardFingerprint(`${title ?? ""} ${body ?? ""}`);
    const shouldSkip = !args.candidate.emit
      || confidence < workflow.emitPolicy.minConfidence
      || !title
      || !body
      || !reason;

    if (shouldSkip) {
      await ctx.db.patch(args.liveCardAgentRunId, {
        status: "skipped",
        specialistModel: args.specialistModel ?? agentRun.specialistModel,
        candidate: args.candidate,
        error: args.candidate.skipReason ?? (confidence < workflow.emitPolicy.minConfidence ? "below_confidence_threshold" : undefined),
        completedAt: timestamp,
        updatedAt: timestamp
      });
      return { ok: true, skipped: true };
    }

    const activeCards = await ctx.db
      .query("conversationCards")
      .withIndex("by_call_session_status", (q) => q.eq("callSessionId", run.callSessionId).eq("status", "new"))
      .order("desc")
      .take(8);
    const cooldownCard = activeCards.find((card) =>
      card.agentId === agentRun.agentId && timestamp - card.createdAt < workflow.emitPolicy.cooldownMs
    );
    if (cooldownCard) {
      await ctx.db.patch(args.liveCardAgentRunId, {
        status: "skipped",
        specialistModel: args.specialistModel ?? agentRun.specialistModel,
        candidate: args.candidate,
        error: "cooldown_active",
        completedAt: timestamp,
        updatedAt: timestamp
      });
      return { ok: true, skipped: true, duplicateCardId: cooldownCard._id };
    }
    const fingerprint = cardFingerprint(`${title} ${body}`);
    const duplicate = activeCards.find((card) =>
      (dedupeKey && card.dedupeKey === dedupeKey) || cardFingerprint(`${card.title} ${card.body}`) === fingerprint
    );
    if (duplicate) {
      await ctx.db.patch(args.liveCardAgentRunId, {
        status: "skipped",
        specialistModel: args.specialistModel ?? agentRun.specialistModel,
        candidate: args.candidate,
        error: "duplicate_card",
        completedAt: timestamp,
        updatedAt: timestamp
      });
      return { ok: true, skipped: true, duplicateCardId: duplicate._id };
    }

    let cardAction = args.candidate.cardAction;
    let integrationConnectionId: any = undefined;
    let integrationActionDraftId: any = undefined;
    if (args.candidate.integrationActionDraft && isSidetoneIntegrationId(args.candidate.integrationActionDraft.integrationId)) {
      const draftCandidate = args.candidate.integrationActionDraft;
      const connection = await ctx.db
        .query("integrationConnections")
        .withIndex("by_entity_integration", (q) => q.eq("entityId", run.entityId).eq("integrationId", draftCandidate.integrationId))
        .first();
      if (connection && connection.status === "active") {
        integrationConnectionId = connection._id;
        integrationActionDraftId = await ctx.db.insert("integrationActionDrafts", {
          entityId: run.entityId,
          ownerTokenIdentifier: run.ownerTokenIdentifier,
          callSessionId: run.callSessionId,
          liveCardRunId: agentRun.liveCardRunId,
          liveCardAgentRunId: args.liveCardAgentRunId,
          integrationId: draftCandidate.integrationId,
          integrationConnectionId: connection._id,
          actionType: cleanText(draftCandidate.actionType, 80) ?? "note_draft",
          title: cleanText(draftCandidate.title, 140) ?? title,
          summary: cleanText(draftCandidate.summary, 600) ?? body,
          payloadJson: safePayloadJson(draftCandidate.payloadJson),
          status: "draft",
          approvalRequired: true,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        cardAction = {
          type: "integration_draft",
          integrationId: draftCandidate.integrationId,
          label: cardAction?.label ?? "Review draft",
          href: `/integrations/actions/${integrationActionDraftId}`
        };
      } else if (!cardAction) {
        cardAction = {
          type: "integration_setup",
          integrationId: draftCandidate.integrationId,
          label: `Connect ${draftCandidate.integrationId === "buildium" ? "Buildium" : "integration"}`,
          href: `/integrations?integration=${draftCandidate.integrationId}`
        };
      }
    }

    const cardId = await ctx.db.insert("conversationCards", {
      callSessionId: run.callSessionId,
      entityId: run.entityId,
      ownerTokenIdentifier: run.ownerTokenIdentifier,
      kind: liveCardKindFor(args.candidate.kind),
      title,
      body,
      reason,
      priority: args.candidate.priority ?? "normal",
      status: "new",
      sourceSegmentIds,
      sourceUrls,
      liveCardRunId: agentRun.liveCardRunId,
      liveCardAgentRunId: args.liveCardAgentRunId,
      agentId: agentRun.agentId,
      dedupeKey,
      confidence,
      personaWorkflowVersion: run.personaWorkflowVersion,
      ...(cardAction ? {
        actionType: cardAction.type,
        integrationId: cardAction.integrationId,
        integrationConnectionId,
        integrationActionDraftId,
        actionLabel: cleanText(cardAction.label, 60)
          ?? (cardAction.type === "integration_setup" ? "Connect integration" : "Review draft"),
        actionHref: cleanText(cardAction.href, 220)
          ?? (cardAction.type === "integration_setup"
            ? `/integrations?integration=${cardAction.integrationId}`
            : integrationActionDraftId
              ? `/integrations/actions/${integrationActionDraftId}`
              : "/integrations")
      } : {}),
      createdAt: timestamp,
      expiresAt: timestamp + 10 * 60 * 1000
    });

    if (integrationActionDraftId) {
      await ctx.db.patch(integrationActionDraftId, { conversationCardId: cardId, updatedAt: timestamp });
    }

    const updatedActiveCards = await ctx.db
      .query("conversationCards")
      .withIndex("by_call_session_status", (q) => q.eq("callSessionId", run.callSessionId).eq("status", "new"))
      .order("desc")
      .take(8);
    await Promise.all(
      updatedActiveCards
        .slice(workflow.emitPolicy.maxActiveCards)
        .map((card) => ctx.db.patch(card._id, { status: "expired" }))
    );
    await ctx.db.patch(args.liveCardAgentRunId, {
      status: "ready",
      specialistModel: args.specialistModel ?? agentRun.specialistModel,
      candidate: args.candidate,
      completedAt: timestamp,
      updatedAt: timestamp
    });
    await ctx.db.patch(agentRun.liveCardRunId, {
      status: "ready",
      completedAt: timestamp,
      updatedAt: timestamp
    });
    await ctx.db.insert("auditEvents", {
      entityId: run.entityId,
      callSessionId: run.callSessionId,
      actor: "system",
      type: "conversation_card.generated",
      message: "Sidetone generated a live signal card.",
      metadata: {
        cardId,
        liveCardRunId: agentRun.liveCardRunId,
        liveCardAgentRunId: args.liveCardAgentRunId,
        agentId: agentRun.agentId,
        confidence,
        actionType: cardAction?.type,
        integrationId: cardAction?.integrationId,
        integrationConnectionId,
        integrationActionDraftId,
        sourceSegmentIds,
        sourceUrls
      },
      createdAt: timestamp
    });

    return { ok: true, skipped: false, cardId };
  }
});

export const failLiveCardAgentRunInternal = internalMutation({
  args: {
    liveCardRunId: v.id("liveCardRuns"),
    agentId: v.optional(v.string()),
    error: v.string()
  },
  handler: async (ctx, args) => {
    const timestamp = now();
    const runs = await ctx.db
      .query("liveCardAgentRuns")
      .withIndex("by_live_card_run", (q) => q.eq("liveCardRunId", args.liveCardRunId))
      .take(32);
    await Promise.all(
      runs
        .filter((run) => !args.agentId || run.agentId === args.agentId)
        .filter((run) => run.status === "queued" || run.status === "running")
        .map((run) => ctx.db.patch(run._id, {
          status: "failed",
          error: args.error,
          completedAt: timestamp,
          updatedAt: timestamp
        }))
    );
    await ctx.db.patch(args.liveCardRunId, {
      status: "failed",
      error: args.error,
      completedAt: timestamp,
      updatedAt: timestamp
    });
    return { ok: true };
  }
});

export const updateConversationCardStatus = mutation({
  args: {
    cardId: v.id("conversationCards"),
    status: v.union(v.literal("pinned"), v.literal("dismissed"), v.literal("expired"))
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const card = await ctx.db.get(args.cardId);
    if (!card || card.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Conversation card not found.");
    }
    await ctx.db.patch(args.cardId, { status: args.status });
    return { cardId: args.cardId };
  }
});

export const transcriptForIndexing = internalQuery({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      return null;
    }
    const segments = await readTranscript(ctx, args.callSessionId);
    return { callSession, segments };
  }
});

export const replaceTranscriptChunks = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    chunks: v.array(v.object({
      chunkText: v.string(),
      startMs: v.float64(),
      endMs: v.float64(),
      segmentIds: v.array(v.id("transcriptSegments")),
      embedding: v.array(v.float64())
    })),
    error: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      throw new Error("Call session not found.");
    }

    const existing = await ctx.db
      .query("callTranscriptChunks")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .take(100);
    await Promise.all(existing.map((chunk) => ctx.db.delete(chunk._id)));

    const timestamp = now();
    if (args.error || !args.chunks.length) {
      const status = args.error ? "failed" : "skipped";
      const chunkId = await ctx.db.insert("callTranscriptChunks", {
        callSessionId: args.callSessionId,
        entityId: callSession.entityId,
        ownerTokenIdentifier: callSession.ownerTokenIdentifier,
        externalEntityId: callSession.primaryExternalEntityId,
        chunkText: args.error ?? "Transcript was not meaningful enough to index.",
        startMs: 0,
        endMs: 0,
        segmentIds: [],
        embedding: zeroEmbedding(),
        embeddingModel: EMBEDDING_MODEL,
        status,
        error: args.error,
        indexedAt: status === "skipped" ? timestamp : undefined,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      return { chunkIds: [chunkId], status };
    }

    const chunkIds = await Promise.all(args.chunks.map((chunk) =>
      ctx.db.insert("callTranscriptChunks", {
        callSessionId: args.callSessionId,
        entityId: callSession.entityId,
        ownerTokenIdentifier: callSession.ownerTokenIdentifier,
        externalEntityId: callSession.primaryExternalEntityId,
        chunkText: chunk.chunkText,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        segmentIds: chunk.segmentIds,
        embedding: chunk.embedding,
        embeddingModel: EMBEDDING_MODEL,
        status: "indexed",
        indexedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      })
    ));

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "system",
      type: "call_intelligence.indexed",
      message: "Sidetone indexed transcript chunks for call intelligence.",
      metadata: { chunkCount: chunkIds.length },
      createdAt: timestamp
    });

    return { chunkIds, status: "indexed" as const };
  }
});

async function indexCallTranscriptHandler(ctx: any, args: { callSessionId: any }, ownerTokenIdentifier?: string): Promise<any> {
    const record = await ctx.runQuery(internal.intelligence.transcriptForIndexing, args);
    if (!record || (ownerTokenIdentifier && record.callSession.ownerTokenIdentifier !== ownerTokenIdentifier)) {
      throw new Error("Call session not found.");
    }
    const entitlements = await ctx.runQuery(internal.billing.entitlementsForOwnerTokenInternal, {
      ownerTokenIdentifier: record.callSession.ownerTokenIdentifier
    });
    if (!entitlements.callIntelligence) {
      return await ctx.runMutation(internal.intelligence.replaceTranscriptChunks, {
        callSessionId: args.callSessionId,
        chunks: []
      });
    }

    const chunks = splitIntoChunks(record.segments);
    if (!chunks.length) {
      return await ctx.runMutation(internal.intelligence.replaceTranscriptChunks, {
        callSessionId: args.callSessionId,
        chunks: []
      });
    }

    try {
      const embeddings = await embedTexts(chunks.map((chunk) => chunk.chunkText));
      return await ctx.runMutation(internal.intelligence.replaceTranscriptChunks, {
        callSessionId: args.callSessionId,
        chunks: chunks.map((chunk, index) => ({
          ...chunk,
          embedding: embeddings[index] ?? zeroEmbedding()
        }))
      });
    } catch (error) {
      return await ctx.runMutation(internal.intelligence.replaceTranscriptChunks, {
        callSessionId: args.callSessionId,
        chunks: [],
        error: error instanceof Error ? error.message : "Unable to index transcript."
      });
    }
}

export const indexCallTranscript = action({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args): Promise<any> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required.");
    }
    return await indexCallTranscriptHandler(ctx, args, identity.tokenIdentifier);
  }
});

export const indexCallTranscriptInternal = internalAction({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args): Promise<any> => {
    return await indexCallTranscriptHandler(ctx, args);
  }
});

export const callTranscriptIndexBackfillCandidates = internalQuery({
  args: {
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.optional(v.string()),
    limit: v.float64(),
    force: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity || (args.ownerTokenIdentifier && entity.ownerTokenIdentifier !== args.ownerTokenIdentifier)) {
      throw new Error("Workspace not found.");
    }

    const calls = await ctx.db
      .query("callSessions")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .order("desc")
      .take(300);
    const callIds = [];
    let scanned = 0;
    let alreadyIndexed = 0;
    let noTranscript = 0;

    for (const call of calls) {
      if (callIds.length >= Math.max(1, Math.min(100, args.limit))) {
        break;
      }
      if (args.ownerTokenIdentifier && call.ownerTokenIdentifier !== args.ownerTokenIdentifier) {
        continue;
      }
      scanned += 1;

      if (!args.force) {
        const existingIndexedChunk = await ctx.db
          .query("callTranscriptChunks")
          .withIndex("by_call_session_status", (q) => q.eq("callSessionId", call._id).eq("status", "indexed"))
          .first();
        if (existingIndexedChunk) {
          alreadyIndexed += 1;
          continue;
        }
      }

      const firstSegment = await ctx.db
        .query("transcriptSegments")
        .withIndex("by_call_session_time", (q) => q.eq("callSessionId", call._id))
        .first();
      if (!firstSegment) {
        noTranscript += 1;
        continue;
      }

      callIds.push(call._id);
    }

    return {
      callIds,
      scanned,
      alreadyIndexed,
      noTranscript,
      selected: callIds.length
    };
  }
});

export const backfillCallTranscriptIndexes = action({
  args: {
    entityId: v.id("entityProfiles"),
    limit: v.optional(v.float64()),
    force: v.optional(v.boolean()),
    workerToken: v.optional(v.string())
  },
  handler: async (ctx, args): Promise<{
    scanned: number;
    selected: number;
    indexed: number;
    skipped: number;
    failed: number;
    alreadyIndexed: number;
    noTranscript: number;
    errors: Array<{ callSessionId: string; error: string }>;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    const expectedWorkerToken = process.env.SIDETONE_WORKER_TOKEN?.trim();
    const workerTokenAuthorized = Boolean(expectedWorkerToken && args.workerToken === expectedWorkerToken);
    if (!identity && !workerTokenAuthorized) {
      throw new Error("Authentication required.");
    }

    const candidates: {
      callIds: Array<any>;
      scanned: number;
      alreadyIndexed: number;
      noTranscript: number;
      selected: number;
    } = await ctx.runQuery(internal.intelligence.callTranscriptIndexBackfillCandidates, {
      entityId: args.entityId,
      ownerTokenIdentifier: identity?.tokenIdentifier,
      limit: Math.max(1, Math.min(100, args.limit ?? 50)),
      force: args.force
    });

    let indexed = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ callSessionId: string; error: string }> = [];

    for (const callSessionId of candidates.callIds) {
      try {
        const result = await indexCallTranscriptHandler(ctx, { callSessionId }, identity?.tokenIdentifier);
        if (result?.status === "indexed") {
          indexed += 1;
        } else if (result?.status === "skipped") {
          skipped += 1;
        } else {
          failed += 1;
        }
      } catch (error) {
        failed += 1;
        errors.push({
          callSessionId: String(callSessionId),
          error: error instanceof Error ? error.message : "Unable to index call transcript."
        });
      }
    }

    return {
      scanned: candidates.scanned,
      selected: candidates.selected,
      indexed,
      skipped,
      failed,
      alreadyIndexed: candidates.alreadyIndexed,
      noTranscript: candidates.noTranscript,
      errors
    };
  }
});

export const exactSearchChunks = internalQuery({
  args: {
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    query: v.string(),
    externalEntityId: v.optional(v.id("externalEntities"))
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("callTranscriptChunks")
      .withSearchIndex("search_chunk_text", (q) => {
        const search = q
          .search("chunkText", args.query)
          .eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
          .eq("entityId", args.entityId)
          .eq("status", "indexed");
        return args.externalEntityId ? search.eq("externalEntityId", args.externalEntityId) : search;
      })
      .take(20);
  }
});

export const resolveEntityCandidatesForQuestion = internalQuery({
  args: {
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    question: v.string()
  },
  handler: async (ctx, args): Promise<EntityCandidate[]> => {
    await requireOwnedEntityForToken(ctx, args.entityId, args.ownerTokenIdentifier);
    const normalizedQuestion = normalizeSearchText(args.question);
    if (!normalizedQuestion) {
      return [];
    }
    const questionTerms = new Set(normalizedQuestion.split(" ").filter((term) => term.length >= 3));
    const entities = await ctx.db
      .query("externalEntities")
      .withIndex("by_workspace", (q) => q.eq("entityId", args.entityId))
      .take(250);

    return entities
      .filter((entity) => entity.ownerTokenIdentifier === args.ownerTokenIdentifier)
      .map((entity) => {
        const normalizedName = normalizeSearchText(entity.name);
        const nameTerms = normalizedName.split(" ").filter((term) => term.length >= 3);
        const overlap = nameTerms.filter((term) => questionTerms.has(term)).length;
        const exact = normalizedName && normalizedQuestion.includes(normalizedName);
        const scoped = hasEntityScopeLanguage(args.question, entity.name);
        const score = exact
          ? scoped ? 0.98 : 0.72
          : nameTerms.length
            ? Math.min(0.58, overlap / nameTerms.length)
            : 0;
        return {
          id: String(entity._id),
          name: entity.name,
          score,
          matchedText: exact ? entity.name : nameTerms.filter((term) => questionTerms.has(term)).join(" ")
        };
      })
      .filter((candidate) => candidate.score >= 0.28)
      .sort((left, right) => right.score - left.score || right.name.length - left.name.length)
      .slice(0, 8);
  }
});

export const callIntelligenceSummary = query({
  args: {
    entityId: v.id("entityProfiles")
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    await requireOwnedEntity(ctx, args.entityId);
    const calls = await ctx.db
      .query("callSessions")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .take(1000);
    const indexedChunks = await ctx.db
      .query("callTranscriptChunks")
      .withIndex("by_entity_status", (q) => q.eq("entityId", args.entityId).eq("status", "indexed"))
      .take(1000);
    const savedEntities = await ctx.db
      .query("externalEntities")
      .withIndex("by_workspace", (q) => q.eq("entityId", args.entityId))
      .take(500);
    return {
      totalCalls: calls.filter((call) => call.ownerTokenIdentifier === identity.tokenIdentifier).length,
      indexedCalls: new Set(indexedChunks
        .filter((chunk) => chunk.ownerTokenIdentifier === identity.tokenIdentifier)
        .map((chunk) => String(chunk.callSessionId))).size,
      savedEntities: savedEntities.filter((item) => item.ownerTokenIdentifier === identity.tokenIdentifier).length
    };
  }
});

export const callIntelligenceSummaryForAsk = internalQuery({
  args: {
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string()
  },
  handler: async (ctx, args) => {
    await requireOwnedEntityForToken(ctx, args.entityId, args.ownerTokenIdentifier);
    const calls = await ctx.db
      .query("callSessions")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .take(1000);
    const indexedChunks = await ctx.db
      .query("callTranscriptChunks")
      .withIndex("by_entity_status", (q) => q.eq("entityId", args.entityId).eq("status", "indexed"))
      .take(1000);
    const savedEntities = await ctx.db
      .query("externalEntities")
      .withIndex("by_workspace", (q) => q.eq("entityId", args.entityId))
      .take(500);
    return {
      totalCalls: calls.filter((call) => call.ownerTokenIdentifier === args.ownerTokenIdentifier).length,
      indexedCalls: new Set(indexedChunks
        .filter((chunk) => chunk.ownerTokenIdentifier === args.ownerTokenIdentifier)
        .map((chunk) => String(chunk.callSessionId))).size,
      savedEntities: savedEntities.filter((item) => item.ownerTokenIdentifier === args.ownerTokenIdentifier).length
    };
  }
});

export const callCoverageForAsk = internalQuery({
  args: {
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    externalEntityId: v.optional(v.id("externalEntities"))
  },
  handler: async (ctx, args) => {
    await requireOwnedEntityForToken(ctx, args.entityId, args.ownerTokenIdentifier);
    const calls = args.externalEntityId
      ? await ctx.db
        .query("callSessions")
        .withIndex("by_entity_primary_external_entity", (q) => q.eq("entityId", args.entityId).eq("primaryExternalEntityId", args.externalEntityId))
        .take(1000)
      : await ctx.db
        .query("callSessions")
        .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
        .take(1000);
    const inScopeCallIds = new Set(
      calls
        .filter((call) => call.ownerTokenIdentifier === args.ownerTokenIdentifier)
        .map((call) => String(call._id))
    );
    const indexedChunks = await ctx.db
      .query("callTranscriptChunks")
      .withIndex("by_entity_status", (q) => q.eq("entityId", args.entityId).eq("status", "indexed"))
      .take(1000);
    const indexedCallIds = new Set(indexedChunks
      .filter((chunk) =>
        chunk.ownerTokenIdentifier === args.ownerTokenIdentifier
        && inScopeCallIds.has(String(chunk.callSessionId))
        && (!args.externalEntityId || chunk.externalEntityId === args.externalEntityId)
      )
      .map((chunk) => String(chunk.callSessionId)));
    return {
      totalCalls: inScopeCallIds.size,
      indexedCalls: indexedCallIds.size,
      unindexedCalls: Math.max(0, inScopeCallIds.size - indexedCallIds.size)
    };
  }
});

export const callIdsForExternalEntity = internalQuery({
  args: {
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    externalEntityId: v.id("externalEntities")
  },
  handler: async (ctx, args) => {
    await requireOwnedEntityForToken(ctx, args.entityId, args.ownerTokenIdentifier);
    const externalEntity = await ctx.db.get(args.externalEntityId);
    if (!externalEntity || externalEntity.entityId !== args.entityId || externalEntity.ownerTokenIdentifier !== args.ownerTokenIdentifier) {
      return [];
    }
    const calls = await ctx.db
      .query("callSessions")
      .withIndex("by_entity_primary_external_entity", (q) => q.eq("entityId", args.entityId).eq("primaryExternalEntityId", args.externalEntityId))
      .order("desc")
      .take(300);
    return calls
      .filter((call) => call.ownerTokenIdentifier === args.ownerTokenIdentifier)
      .map((call) => call._id);
  }
});

export const hydrateEvidenceForAsk = internalQuery({
  args: {
    chunkIds: v.array(v.id("callTranscriptChunks")),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string()
  },
  handler: async (ctx, args) => {
    const chunks = (await Promise.all(args.chunkIds.map((id) => ctx.db.get(id))))
      .filter((chunk) =>
        Boolean(
          chunk
          && chunk.entityId === args.entityId
          && chunk.ownerTokenIdentifier === args.ownerTokenIdentifier
          && chunk.status === "indexed"
        )
      );
    return await Promise.all(chunks.map(async (chunk) => {
      const callSession = await ctx.db.get(chunk!.callSessionId);
      if (!callSession || callSession.entityId !== args.entityId || callSession.ownerTokenIdentifier !== args.ownerTokenIdentifier) {
        return null;
      }
      const artifact = await ctx.db
        .query("callArtifacts")
        .withIndex("by_call_session", (q) => q.eq("callSessionId", chunk!.callSessionId))
        .first();
      const participant = await ctx.db
        .query("callParticipants")
        .withIndex("by_call_role", (q) => q.eq("callSessionId", chunk!.callSessionId).eq("role", "primary"))
        .first();
      const externalEntity = chunk!.externalEntityId
        ? await ctx.db.get(chunk!.externalEntityId)
        : callSession.primaryExternalEntityId
          ? await ctx.db.get(callSession.primaryExternalEntityId)
          : participant?.externalEntityId
            ? await ctx.db.get(participant.externalEntityId)
            : null;
      const tags = await Promise.all((await ctx.db
        .query("callTags")
        .withIndex("by_call", (q) => q.eq("callSessionId", chunk!.callSessionId))
        .take(12)
      ).map((callTag) => ctx.db.get(callTag.tagId)));
      return {
        chunkId: chunk!._id,
        callSessionId: chunk!.callSessionId,
        title: externalEntity?.name
          ?? participant?.externalEntityNameSnapshot
          ?? callModeLabel(callSession.mode),
        callBasis: artifact?.callBasis,
        snippet: chunk!.chunkText.slice(0, 520),
        startMs: chunk!.startMs,
        startedAt: callSession.startedAt ?? callSession.createdAt,
        status: callSession.status,
        externalEntityId: externalEntity?._id,
        tags: tags
          .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag && tag.status === "active"))
          .map((tag) => ({ id: String(tag._id), label: tag.label, color: tag.color }))
      };
    })).then((items) => items.filter(Boolean));
  }
});

export const filterVectorSearchChunkIdsForAsk = internalQuery({
  args: {
    chunkIds: v.array(v.id("callTranscriptChunks")),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    externalEntityId: v.optional(v.id("externalEntities"))
  },
  handler: async (ctx, args) => {
    const chunks = await Promise.all(args.chunkIds.map((id) => ctx.db.get(id)));
    return chunks
      .filter((chunk) =>
        Boolean(
          chunk
          && chunk.entityId === args.entityId
          && chunk.ownerTokenIdentifier === args.ownerTokenIdentifier
          && chunk.status === "indexed"
          && (!args.externalEntityId || chunk.externalEntityId === args.externalEntityId)
        )
      )
      .map((chunk) => chunk!._id);
  }
});

export const firstChunkIdsForCalls = internalQuery({
  args: {
    callSessionIds: v.array(v.id("callSessions")),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string()
  },
  handler: async (ctx, args) => {
    const chunkIds = [];
    for (const callSessionId of args.callSessionIds.slice(0, 20)) {
      const callSession = await ctx.db.get(callSessionId);
      if (!callSession || callSession.entityId !== args.entityId || callSession.ownerTokenIdentifier !== args.ownerTokenIdentifier) {
        continue;
      }
      const chunk = await ctx.db
        .query("callTranscriptChunks")
        .withIndex("by_call_session_status", (q) => q.eq("callSessionId", callSessionId).eq("status", "indexed"))
        .first();
      if (chunk) {
        chunkIds.push(chunk._id);
      }
    }
    return chunkIds;
  }
});

export const structuredCallIdsForSearch = internalQuery({
  args: {
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    ...searchFilterArgs
  },
  handler: async (ctx, args) => {
    await requireOwnedEntity(ctx, args.entityId);
    const sessions = await ctx.db
      .query("callSessions")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .order("desc")
      .take(300);

    let candidateIds = new Set(
      sessions
        .filter((session) =>
          session.ownerTokenIdentifier === args.ownerTokenIdentifier
          && (!args.status || session.status === args.status)
          && (!args.industryProfile || session.industryProfile === args.industryProfile)
          && (!args.dateFrom || (session.startedAt ?? session.createdAt) >= args.dateFrom)
          && (!args.dateTo || (session.startedAt ?? session.createdAt) <= args.dateTo)
        )
        .map((session) => String(session._id))
    );

    function intersect(callIds: string[]) {
      const next = new Set(callIds);
      candidateIds = new Set([...candidateIds].filter((id) => next.has(id)));
    }

    if (args.contactId) {
      const participants = await ctx.db
        .query("callParticipants")
        .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
        .take(300);
      intersect(
        participants
          .filter((participant) =>
            participant.entityId === args.entityId
            && participant.ownerTokenIdentifier === args.ownerTokenIdentifier
          )
          .map((participant) => String(participant.callSessionId))
      );
    }

    if (args.externalEntityId) {
      const participants = await ctx.db
        .query("callParticipants")
        .withIndex("by_external_entity", (q) => q.eq("externalEntityId", args.externalEntityId))
        .take(300);
      intersect(
        participants
          .filter((participant) =>
            participant.entityId === args.entityId
            && participant.ownerTokenIdentifier === args.ownerTokenIdentifier
          )
          .map((participant) => String(participant.callSessionId))
      );
    }

    for (const tagId of args.tagIds ?? []) {
      const tag = await ctx.db.get(tagId);
      if (!tag || tag.entityId !== args.entityId || tag.ownerTokenIdentifier !== args.ownerTokenIdentifier) {
        intersect([]);
        continue;
      }
      const callTags = await ctx.db
        .query("callTags")
        .withIndex("by_tag", (q) => q.eq("tagId", tagId))
        .take(300);
      intersect(
        callTags
          .filter((callTag) =>
            callTag.entityId === args.entityId
            && callTag.ownerTokenIdentifier === args.ownerTokenIdentifier
          )
          .map((callTag) => String(callTag.callSessionId))
      );
    }

    return [...candidateIds].slice(0, 100);
  }
});

export const hydrateSearchResults = internalQuery({
  args: {
    chunkIds: v.array(v.id("callTranscriptChunks")),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    callSessionIds: v.optional(v.array(v.id("callSessions")))
  },
  handler: async (ctx, args) => {
    const allowedCallIds = args.callSessionIds ? new Set(args.callSessionIds.map((id) => String(id))) : null;
    const chunks = (await Promise.all(args.chunkIds.map((id) => ctx.db.get(id))))
      .filter((chunk) =>
        Boolean(
          chunk
          && chunk.entityId === args.entityId
          && chunk.ownerTokenIdentifier === args.ownerTokenIdentifier
          && chunk.status === "indexed"
          && (!allowedCallIds || allowedCallIds.has(String(chunk.callSessionId)))
        )
      );
    const results = await Promise.all(chunks.map(async (chunk) => {
      const callSession = await ctx.db.get(chunk!.callSessionId);
      const artifact = await ctx.db
        .query("callArtifacts")
        .withIndex("by_call_session", (q) => q.eq("callSessionId", chunk!.callSessionId))
        .first();
      const participant = await ctx.db
        .query("callParticipants")
        .withIndex("by_call_role", (q) => q.eq("callSessionId", chunk!.callSessionId).eq("role", "primary"))
        .first();
      const contact = participant?.contactId ? await ctx.db.get(participant.contactId) : null;
      const externalEntity = participant?.externalEntityId ? await ctx.db.get(participant.externalEntityId) : null;
      return {
        chunk,
        callSession,
        artifact,
        tags: await Promise.all((await ctx.db
          .query("callTags")
          .withIndex("by_call", (q) => q.eq("callSessionId", chunk!.callSessionId))
          .take(20)
        ).map((callTag) => ctx.db.get(callTag.tagId))),
        identityTitle: externalEntity?.name
          ?? contact?.displayName
          ?? participant?.externalEntityNameSnapshot
          ?? participant?.displayNameSnapshot
          ?? "Sidetone call"
      };
    }));
    return results.filter((result) => result.callSession);
  }
});

export const hydrateCallsForSearch = internalQuery({
  args: {
    callSessionIds: v.array(v.id("callSessions")),
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string()
  },
  handler: async (ctx, args) => {
    const calls = await Promise.all(args.callSessionIds.map(async (callSessionId) => {
      const callSession = await ctx.db.get(callSessionId);
      if (!callSession || callSession.entityId !== args.entityId || callSession.ownerTokenIdentifier !== args.ownerTokenIdentifier) {
        return null;
      }
      const artifact = await ctx.db
        .query("callArtifacts")
        .withIndex("by_call_session", (q) => q.eq("callSessionId", callSessionId))
        .first();
      const chunk = await ctx.db
        .query("callTranscriptChunks")
        .withIndex("by_call_session_status", (q) => q.eq("callSessionId", callSessionId).eq("status", "indexed"))
        .first();
      const participant = await ctx.db
        .query("callParticipants")
        .withIndex("by_call_role", (q) => q.eq("callSessionId", callSessionId).eq("role", "primary"))
        .first();
      const contact = participant?.contactId ? await ctx.db.get(participant.contactId) : null;
      const externalEntity = participant?.externalEntityId ? await ctx.db.get(participant.externalEntityId) : null;
      const tags = await Promise.all((await ctx.db
        .query("callTags")
        .withIndex("by_call", (q) => q.eq("callSessionId", callSessionId))
        .take(20)
      ).map((callTag) => ctx.db.get(callTag.tagId)));
      return {
        callSession,
        artifact,
        chunk,
        tags,
        identityTitle: externalEntity?.name
          ?? contact?.displayName
          ?? participant?.externalEntityNameSnapshot
          ?? participant?.displayNameSnapshot
          ?? "Sidetone call"
      };
    }));
    return calls.filter(Boolean);
  }
});

async function semanticSearchChunkIdsForAsk(ctx: any, input: {
  entityId: any;
  ownerTokenIdentifier: string;
  query: string;
  externalEntityId?: any;
}) {
  const [embedding] = await embedTexts([input.query]);
  const matches: Array<{ _id: any; _score: number }> = await ctx.vectorSearch("callTranscriptChunks", "vector_embedding", {
    vector: embedding,
    limit: 80,
    filter: (q: any) => q.eq("ownerTokenIdentifier", input.ownerTokenIdentifier)
  });
  return await ctx.runQuery(internal.intelligence.filterVectorSearchChunkIdsForAsk, {
    chunkIds: matches.map((match) => match._id),
    entityId: input.entityId,
    ownerTokenIdentifier: input.ownerTokenIdentifier,
    externalEntityId: input.externalEntityId
  });
}

function uniqueIds<T>(ids: T[]) {
  const seen = new Set<string>();
  return ids.filter((id) => {
    const key = String(id);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function callCardsFromEvidence(evidence: Array<any>) {
  const calls = new Map<string, any>();
  for (const item of evidence) {
    const key = String(item.callSessionId);
    const existing = calls.get(key);
    const snippet = {
      chunkId: String(item.chunkId),
      text: item.snippet,
      startMs: item.startMs
    };
    if (existing) {
      existing.snippets.push(snippet);
      continue;
    }
    calls.set(key, {
      callSessionId: key,
      title: item.title,
      callBasis: item.callBasis,
      status: item.status,
      startedAt: item.startedAt,
      externalEntityId: item.externalEntityId ? String(item.externalEntityId) : undefined,
      tags: item.tags,
      snippets: [snippet]
    });
  }
  return [...calls.values()].slice(0, 12);
}

async function answerFromAskEvidence(input: {
  question: string;
  plan: RetrievalPlan;
  evidence: Array<any>;
  coverage: { totalCalls: number; indexedCalls: number; unindexedCalls: number; matchingCalls: number };
  matchedEntities: Array<{ id: string; name: string; treatment: EntityTreatment; confidence: number }>;
}) {
  const model = process.env.SIDETONE_CALL_INTELLIGENCE_MODEL?.trim() || "gpt-5.4-mini";
  if (!input.evidence.length) {
    const scope = input.matchedEntities.find((entity) => entity.treatment === "scope" || entity.treatment === "dual");
    const checked = scope ? `${input.coverage.indexedCalls} indexed calls for ${scope.name}` : `${input.coverage.indexedCalls} indexed calls`;
    const gap = input.coverage.unindexedCalls > 0
      ? ` ${input.coverage.unindexedCalls} in-scope calls were not indexed, so this is not a complete absence check.`
      : "";
    return {
      model: "sidetone-deterministic",
      answer: `I checked ${checked} and did not find clear transcript evidence for that.${gap}`
    };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      model: "sidetone-deterministic",
      answer: [
        "OpenAI is not configured, so I can only return the strongest retrieved call evidence.",
        `I found evidence in ${input.coverage.matchingCalls} call${input.coverage.matchingCalls === 1 ? "" : "s"}.`,
        input.evidence.slice(0, 5).map((item, index) => `[${index + 1}] ${item.title}: ${item.snippet}`).join("\n")
      ].join("\n\n")
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            "You are Sidetone Call Intelligence.",
            "Answer only from the provided call evidence.",
            "Use concise, direct language.",
            "For did-we-ever or coverage questions, state the coverage numbers and evidence status.",
            "Never claim something never happened unless all in-scope calls are indexed and the evidence is empty.",
            "Cite calls by their bracket numbers.",
            "For regulated domains, do not provide legal, medical, financial, insurance, or coverage advice."
          ].join(" ")
        },
        {
          role: "user",
          content: [
            `Question: ${input.question}`,
            `Planner intent: ${input.plan.intent}`,
            `Entity treatment: ${input.plan.entityTreatment}`,
            `Coverage: ${JSON.stringify(input.coverage)}`,
            `Matched entities: ${JSON.stringify(input.matchedEntities)}`,
            "",
            "Evidence:",
            ...input.evidence.slice(0, 40).map((item, index) => [
              `[${index + 1}] ${item.title}${item.callBasis ? ` - ${item.callBasis}` : ""}`,
              `Call ID: ${item.callSessionId}`,
              `Timestamp: ${Math.round(item.startMs / 1000)}s`,
              item.snippet
            ].join("\n"))
          ].join("\n\n")
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI call intelligence failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  }
  return { model, answer: cleanText(responseTextFromResponses(await response.json()), 6000) ?? "I could not generate an answer from the retrieved evidence." };
}

function matchedEntitiesFromPlan(plan: RetrievalPlan) {
  return plan.entityScope.entityId && plan.entityScope.entityName
    ? [{
      id: plan.entityScope.entityId,
      name: plan.entityScope.entityName,
      treatment: plan.entityTreatment,
      confidence: plan.entityScope.confidence
    }]
    : [];
}

async function enqueueCallIntelligenceRun(ctx: any, input: { entityId: any; question: string }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required.");
  }
  const entitlements = await ctx.runQuery(internal.billing.entitlementsForOwnerTokenInternal, {
    ownerTokenIdentifier: identity.tokenIdentifier
  });
  if (!entitlements.callIntelligence) {
    throw new Error("Call Intelligence is available on Smooth Operator and Premier Pro.");
  }
  const question = cleanText(input.question, 800);
  if (!question) {
    throw new Error("Ask a question about your calls.");
  }
  const { runId } = await ctx.runMutation(internal.intelligence.createCallIntelligenceRunInternal, {
    entityId: input.entityId,
    ownerTokenIdentifier: identity.tokenIdentifier,
    question
  });

  try {
    const eventId = await sendCallIntelligenceRunEvent(String(runId));
    await ctx.runMutation(internal.intelligence.noteCallIntelligenceRunEventInternal, {
      runId,
      inngestEventId: eventId
    });
  } catch (error) {
    await ctx.runMutation(internal.intelligence.failCallIntelligenceRunInternal, {
      runId,
      errorCode: "enqueue_failed",
      error: error instanceof Error ? error.message : "Unable to enqueue Call Intelligence run."
    });
  }

  return { runId: String(runId) };
}

export const startCallIntelligenceRun = action({
  args: {
    entityId: v.id("entityProfiles"),
    question: v.string()
  },
  handler: async (ctx, args): Promise<{ runId: string }> => {
    return await enqueueCallIntelligenceRun(ctx, args);
  }
});

export const retryCallIntelligenceRun = action({
  args: {
    runId: v.id("callIntelligenceRuns")
  },
  handler: async (ctx, args): Promise<{ runId: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required.");
    }
    const entitlements = await ctx.runQuery(internal.billing.entitlementsForOwnerTokenInternal, {
      ownerTokenIdentifier: identity.tokenIdentifier
    });
    if (!entitlements.callIntelligence) {
      throw new Error("Call Intelligence is available on Smooth Operator and Premier Pro.");
    }
    const { runId } = await ctx.runMutation(internal.intelligence.requeueCallIntelligenceRunInternal, {
      runId: args.runId,
      ownerTokenIdentifier: identity.tokenIdentifier
    });
    try {
      const eventId = await sendCallIntelligenceRunEvent(String(runId));
      await ctx.runMutation(internal.intelligence.noteCallIntelligenceRunEventInternal, {
        runId,
        inngestEventId: eventId
      });
    } catch (error) {
      await ctx.runMutation(internal.intelligence.failCallIntelligenceRunInternal, {
        runId,
        errorCode: "enqueue_failed",
        error: error instanceof Error ? error.message : "Unable to enqueue Call Intelligence retry."
      });
    }
    return { runId: String(runId) };
  }
});

export const callIntelligenceRun = query({
  args: {
    runId: v.id("callIntelligenceRuns")
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerTokenIdentifier !== identity.tokenIdentifier) {
      return null;
    }
    return run;
  }
});

export const recentCallIntelligenceRuns = query({
  args: {
    entityId: v.id("entityProfiles")
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    await requireOwnedEntity(ctx, args.entityId);
    const runs = await ctx.db
      .query("callIntelligenceRuns")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .order("desc")
      .take(20);
    return runs.filter((run) => run.ownerTokenIdentifier === identity.tokenIdentifier);
  }
});

export const createCallIntelligenceRunInternal = internalMutation({
  args: {
    entityId: v.id("entityProfiles"),
    ownerTokenIdentifier: v.string(),
    question: v.string()
  },
  handler: async (ctx, args) => {
    await requireOwnedEntityForToken(ctx, args.entityId, args.ownerTokenIdentifier);
    const timestamp = now();
    const runId = await ctx.db.insert("callIntelligenceRuns", {
      entityId: args.entityId,
      ownerTokenIdentifier: args.ownerTokenIdentifier,
      question: args.question,
      selectedCallIds: [],
      retrievedChunkIds: [],
      citations: [],
      status: "queued",
      stage: "queued",
      progressMessage: "Queued for Call Intelligence.",
      attemptCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await ctx.db.insert("auditEvents", {
      entityId: args.entityId,
      actor: "owner",
      type: "call_intelligence.qa_run",
      message: "A call intelligence question was queued.",
      metadata: { runId, status: "queued" },
      createdAt: timestamp
    });
    return { runId };
  }
});

export const noteCallIntelligenceRunEventInternal = internalMutation({
  args: {
    runId: v.id("callIntelligenceRuns"),
    inngestEventId: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || !args.inngestEventId) {
      return;
    }
    await ctx.db.patch(args.runId, {
      inngestEventId: args.inngestEventId,
      updatedAt: now()
    });
  }
});

export const requeueCallIntelligenceRunInternal = internalMutation({
  args: {
    runId: v.id("callIntelligenceRuns"),
    ownerTokenIdentifier: v.string()
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerTokenIdentifier !== args.ownerTokenIdentifier) {
      throw new Error("Call Intelligence run not found.");
    }
    if (run.status === "ready") {
      throw new Error("This Call Intelligence run is already complete.");
    }
    const timestamp = now();
    await ctx.db.patch(args.runId, {
      status: "queued",
      stage: "queued",
      progressMessage: "Queued for retry.",
      retrievedChunkIds: [],
      selectedCallIds: [],
      citations: [],
      answer: undefined,
      answerModel: undefined,
      error: undefined,
      errorCode: undefined,
      failedAt: undefined,
      completedAt: undefined,
      resultCalls: undefined,
      coverage: undefined,
      updatedAt: timestamp
    });
    return { runId: args.runId };
  }
});

export const callIntelligenceRunForWorker = internalQuery({
  args: {
    runId: v.id("callIntelligenceRuns")
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.runId);
  }
});

export const claimCallIntelligenceRunInternal = internalMutation({
  args: {
    runId: v.id("callIntelligenceRuns"),
    inngestRunId: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      return { ok: false, skip: true };
    }
    if (run.status === "ready" || run.status === "cancelled") {
      return { ok: true, skip: true };
    }
    const timestamp = now();
    const retryPatch = run.status === "failed"
      ? {
        error: undefined,
        errorCode: undefined,
        failedAt: undefined
      }
      : {};
    await ctx.db.patch(args.runId, {
      ...retryPatch,
      status: "running",
      stage: "planning",
      progressMessage: "Planning the search.",
      attemptCount: (run.attemptCount ?? 0) + 1,
      startedAt: run.startedAt ?? timestamp,
      inngestRunId: args.inngestRunId,
      updatedAt: timestamp
    });
    return { ok: true, skip: false };
  }
});

export const markCallIntelligenceRunStageInternal = internalMutation({
  args: {
    runId: v.id("callIntelligenceRuns"),
    status: v.optional(runStatusArg),
    stage: runStageArg,
    progressMessage: v.string()
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status === "ready" || run.status === "failed" || run.status === "cancelled") {
      return;
    }
    await ctx.db.patch(args.runId, {
      status: args.status ?? run.status,
      stage: args.stage,
      progressMessage: args.progressMessage,
      updatedAt: now()
    });
  }
});

export const storeCallIntelligenceRunPlanInternal = internalMutation({
  args: {
    runId: v.id("callIntelligenceRuns"),
    plannerModel: v.string(),
    retrievalPlan: v.any(),
    matchedEntities: v.array(v.object({
      id: v.string(),
      name: v.string(),
      treatment: v.union(v.literal("scope"), v.literal("topic"), v.literal("dual"), v.literal("none")),
      confidence: v.float64()
    }))
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status === "ready" || run.status === "failed" || run.status === "cancelled") {
      return;
    }
    await ctx.db.patch(args.runId, {
      plannerModel: args.plannerModel,
      retrievalPlan: args.retrievalPlan,
      matchedEntities: args.matchedEntities,
      stage: "retrieving",
      progressMessage: "Searching indexed calls.",
      updatedAt: now()
    });
  }
});

export const storeCallIntelligenceRunEvidenceInternal = internalMutation({
  args: {
    runId: v.id("callIntelligenceRuns"),
    selectedCallIds: v.array(v.id("callSessions")),
    retrievedChunkIds: v.array(v.id("callTranscriptChunks")),
    citations: v.array(v.object({
      callSessionId: v.id("callSessions"),
      chunkId: v.optional(v.id("callTranscriptChunks")),
      text: v.string(),
      startMs: v.optional(v.float64())
    })),
    coverage: v.object({
      totalCalls: v.float64(),
      indexedCalls: v.float64(),
      unindexedCalls: v.float64(),
      matchingCalls: v.float64()
    }),
    resultCalls: v.array(v.any())
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status === "ready" || run.status === "failed" || run.status === "cancelled") {
      return;
    }
    await ctx.db.patch(args.runId, {
      selectedCallIds: args.selectedCallIds,
      retrievedChunkIds: args.retrievedChunkIds,
      citations: args.citations,
      coverage: args.coverage,
      resultCalls: args.resultCalls,
      stage: "answering",
      progressMessage: args.retrievedChunkIds.length
        ? "Reading evidence and writing the answer."
        : "Checking coverage and writing the answer.",
      updatedAt: now()
    });
  }
});

export const storeCallIntelligenceRunAnswerInternal = internalMutation({
  args: {
    runId: v.id("callIntelligenceRuns"),
    answerModel: v.string(),
    answer: v.string()
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status === "ready" || run.status === "failed" || run.status === "cancelled") {
      return;
    }
    await ctx.db.patch(args.runId, {
      answerModel: args.answerModel,
      model: args.answerModel,
      answer: args.answer,
      stage: "saving",
      progressMessage: "Saving the answer.",
      updatedAt: now()
    });
  }
});

export const completeCallIntelligenceRunInternal = internalMutation({
  args: {
    runId: v.id("callIntelligenceRuns")
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status === "ready" || run.status === "failed" || run.status === "cancelled") {
      return;
    }
    await ctx.db.patch(args.runId, {
      status: "ready",
      progressMessage: "Answer ready.",
      completedAt: now(),
      updatedAt: now()
    });
  }
});

export const failCallIntelligenceRunInternal = internalMutation({
  args: {
    runId: v.id("callIntelligenceRuns"),
    errorCode: v.optional(v.string()),
    error: v.string()
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status === "ready" || run.status === "cancelled") {
      return;
    }
    await ctx.db.patch(args.runId, {
      status: "failed",
      progressMessage: "Call Intelligence could not finish this run.",
      errorCode: args.errorCode,
      error: args.error,
      failedAt: now(),
      updatedAt: now()
    });
  }
});

export const planCallIntelligenceRunInternal = internalAction({
  args: {
    runId: v.id("callIntelligenceRuns")
  },
  handler: async (ctx, args) => {
    const run: any = await ctx.runQuery(internal.intelligence.callIntelligenceRunForWorker, { runId: args.runId });
    if (!run || run.status === "ready" || run.status === "failed" || run.status === "cancelled") {
      return { skipped: true };
    }
    await ctx.runMutation(internal.intelligence.markCallIntelligenceRunStageInternal, {
      runId: args.runId,
      status: "running",
      stage: "resolving_scope",
      progressMessage: "Checking entities and planning retrieval."
    });
    const summary = await ctx.runQuery(internal.intelligence.callIntelligenceSummaryForAsk, {
      entityId: run.entityId,
      ownerTokenIdentifier: run.ownerTokenIdentifier
    });
    const candidates: EntityCandidate[] = await ctx.runQuery(internal.intelligence.resolveEntityCandidatesForQuestion, {
      entityId: run.entityId,
      ownerTokenIdentifier: run.ownerTokenIdentifier,
      question: run.question
    });
    const { plan, model } = await planCallIntelligenceRetrieval({
      question: run.question,
      candidates,
      stats: summary
    });
    const matchedEntities = matchedEntitiesFromPlan(plan);
    await ctx.runMutation(internal.intelligence.storeCallIntelligenceRunPlanInternal, {
      runId: args.runId,
      plannerModel: model,
      retrievalPlan: plan,
      matchedEntities
    });
    return { skipped: false, plan, matchedEntities };
  }
});

export const retrieveCallIntelligenceRunEvidenceInternal = internalAction({
  args: {
    runId: v.id("callIntelligenceRuns")
  },
  handler: async (ctx, args) => {
    const run: any = await ctx.runQuery(internal.intelligence.callIntelligenceRunForWorker, { runId: args.runId });
    if (!run || run.status === "ready" || run.status === "failed" || run.status === "cancelled") {
      return { skipped: true };
    }
    const plan = run.retrievalPlan as RetrievalPlan | undefined;
    if (!plan) {
      throw new Error("Call Intelligence run has no retrieval plan.");
    }
    await ctx.runMutation(internal.intelligence.markCallIntelligenceRunStageInternal, {
      runId: args.runId,
      status: "running",
      stage: "retrieving",
      progressMessage: "Searching indexed calls."
    });
    const scopedEntityId = plan.entityScope.entityId && (plan.entityTreatment === "scope" || plan.entityTreatment === "dual")
      ? plan.entityScope.entityId as any
      : undefined;
    const coverageBase = await ctx.runQuery(internal.intelligence.callCoverageForAsk, {
      entityId: run.entityId,
      ownerTokenIdentifier: run.ownerTokenIdentifier,
      externalEntityId: scopedEntityId
    });
    const chunkIds: Array<any> = [];
    const retrievalScopes = plan.entityTreatment === "dual" && scopedEntityId
      ? [undefined, scopedEntityId]
      : [scopedEntityId];
    const topicQueries = plan.topicQueries.slice(0, 3);

    if (plan.retrievalLanes.includes("entity_calls") && scopedEntityId) {
      const callIds = await ctx.runQuery(internal.intelligence.callIdsForExternalEntity, {
        entityId: run.entityId,
        ownerTokenIdentifier: run.ownerTokenIdentifier,
        externalEntityId: scopedEntityId
      });
      const entityChunkIds = await ctx.runQuery(internal.intelligence.firstChunkIdsForCalls, {
        callSessionIds: callIds,
        entityId: run.entityId,
        ownerTokenIdentifier: run.ownerTokenIdentifier
      });
      chunkIds.push(...entityChunkIds);
    }

    if (plan.retrievalLanes.includes("exact")) {
      for (const query of topicQueries) {
        for (const externalEntityId of retrievalScopes) {
          const chunks = await ctx.runQuery(internal.intelligence.exactSearchChunks, {
            entityId: run.entityId,
            ownerTokenIdentifier: run.ownerTokenIdentifier,
            query,
            externalEntityId
          });
          chunkIds.push(...chunks.map((chunk: any) => chunk._id));
        }
      }
    }

    if (plan.retrievalLanes.includes("semantic")) {
      for (const query of topicQueries) {
        for (const externalEntityId of retrievalScopes) {
          chunkIds.push(...await semanticSearchChunkIdsForAsk(ctx, {
            entityId: run.entityId,
            ownerTokenIdentifier: run.ownerTokenIdentifier,
            query,
            externalEntityId
          }));
        }
      }
    }

    const hydrated: any[] = await ctx.runQuery(internal.intelligence.hydrateEvidenceForAsk, {
      chunkIds: uniqueIds(chunkIds).slice(0, 120),
      entityId: run.entityId,
      ownerTokenIdentifier: run.ownerTokenIdentifier
    });
    const evidence = hydrated.slice(0, 40);
    const matchingCalls = new Set(evidence.map((item) => String(item.callSessionId))).size;
    const coverage = { ...coverageBase, matchingCalls };
    const citations = evidence.slice(0, 8).map((item) => ({
      callSessionId: item.callSessionId,
      chunkId: item.chunkId,
      text: item.snippet.slice(0, 240),
      startMs: item.startMs
    }));
    await ctx.runMutation(internal.intelligence.storeCallIntelligenceRunEvidenceInternal, {
      runId: args.runId,
      selectedCallIds: uniqueIds(evidence.map((item) => item.callSessionId)),
      retrievedChunkIds: evidence.map((item) => item.chunkId),
      citations,
      coverage,
      resultCalls: callCardsFromEvidence(evidence)
    });
    return { skipped: false, matchingCalls, retrievedChunkCount: evidence.length };
  }
});

export const answerCallIntelligenceRunInternal = internalAction({
  args: {
    runId: v.id("callIntelligenceRuns")
  },
  handler: async (ctx, args) => {
    const run: any = await ctx.runQuery(internal.intelligence.callIntelligenceRunForWorker, { runId: args.runId });
    if (!run || run.status === "ready" || run.status === "failed" || run.status === "cancelled") {
      return { skipped: true };
    }
    await ctx.runMutation(internal.intelligence.markCallIntelligenceRunStageInternal, {
      runId: args.runId,
      status: "running",
      stage: "answering",
      progressMessage: "Writing the answer from cited evidence."
    });
    const evidence: any[] = await ctx.runQuery(internal.intelligence.hydrateEvidenceForAsk, {
      chunkIds: run.retrievedChunkIds ?? [],
      entityId: run.entityId,
      ownerTokenIdentifier: run.ownerTokenIdentifier
    });
    const answerResult = await answerFromAskEvidence({
      question: run.question,
      plan: run.retrievalPlan as RetrievalPlan,
      evidence,
      coverage: run.coverage ?? { totalCalls: 0, indexedCalls: 0, unindexedCalls: 0, matchingCalls: 0 },
      matchedEntities: run.matchedEntities ?? []
    });
    await ctx.runMutation(internal.intelligence.storeCallIntelligenceRunAnswerInternal, {
      runId: args.runId,
      answerModel: answerResult.model,
      answer: answerResult.answer
    });
    return { skipped: false };
  }
});
