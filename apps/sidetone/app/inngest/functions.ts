import { inngest } from "./client";
import { hangupCall, sendTelnyxSms } from "../lib/telnyx";
import {
  isSidetoneIntegrationId,
  type SidetoneLiveCardSpecialist,
  type SidetoneLiveCardToolDescriptor,
  type SidetoneLiveCardWorkflow
} from "@sidetone/contracts";

type RunStepOperation =
  | "claim-run"
  | "plan-retrieval"
  | "retrieve-evidence"
  | "generate-answer"
  | "complete-run"
  | "fail-run"
  | "monitor-live-call"
  | "prepare-live-card-run"
  | "complete-live-card-run"
  | "prepare-live-card-agent-run"
  | "complete-live-card-agent-run"
  | "fail-live-card-agent-run"
  | "prepare-uploaded-recording"
  | "record-uploaded-transcript"
  | "finalize-uploaded-recording"
  | "fail-uploaded-recording"
  | "prepare-vexa-meeting"
  | "record-vexa-transcript"
  | "record-vexa-recording"
  | "finalize-vexa-meeting"
  | "fail-vexa-meeting";

function convexBridgeUrl() {
  const siteUrl = process.env.CONVEX_SITE_URL
    ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL
    ?? process.env.CONVEX_URL?.replace(".convex.cloud", ".convex.site")
    ?? process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site");
  if (!siteUrl) {
    throw new Error("CONVEX_SITE_URL is not configured.");
  }
  return `${siteUrl.replace(/\/$/, "")}/call-intelligence/run-step`;
}

async function runStep(operation: RunStepOperation, payload: Record<string, unknown>) {
  const token = process.env.SIDETONE_WORKER_TOKEN?.trim();
  if (!token) {
    throw new Error("SIDETONE_WORKER_TOKEN is not configured.");
  }
  const response = await fetch(convexBridgeUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ operation, ...payload })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? `Call Intelligence worker step failed: ${operation}`);
  }
  return body;
}

type LiveCardKind = "focus_hit" | "clarify" | "memory" | "risk" | "web_context";
type LiveCardPriority = "low" | "normal" | "high";
type LiveCardSupervisorDecision = {
  decision: "skip" | "route";
  reason: string;
  routedAgentIds: string[];
  priority: LiveCardPriority;
  highStakes: boolean;
};
type LiveCardCandidate = {
  emit: boolean;
  kind?: LiveCardKind;
  title?: string;
  body?: string;
  reason?: string;
  priority?: LiveCardPriority;
  confidence?: number;
  dedupeKey?: string;
  sourceSegmentIds?: string[];
  sourceUrls?: string[];
  cardAction?: {
    type: "integration_setup" | "integration_draft";
    integrationId: string;
    label?: string;
    href?: string;
  };
  integrationActionDraft?: {
    integrationId: string;
    actionType: string;
    title: string;
    summary: string;
    payloadJson: string;
  };
  skipReason?: string;
};
type IntegrationSummary = {
  id: string;
  label: string;
  status: string;
  connectionType?: string;
  writePolicy?: string;
  capabilities?: readonly string[];
  audienceTags?: readonly string[];
  connection?: {
    _id?: string;
    status?: string;
    environment?: string;
    displayName?: string;
    capabilities?: readonly string[];
    hasCredentials?: boolean;
    failureReason?: string;
    lastTestedAt?: number;
    connectedAt?: number;
  } | null;
};
type PreparedLiveCardRun = {
  skip?: boolean;
  reason?: string;
  liveCardRunId?: string;
  transcriptWindow?: string;
  callSession?: {
    _id: string;
    status: string;
    mode?: string;
    industryProfile?: string;
    callFocusText?: string | null;
  };
  entity?: unknown;
  sourceSegments?: Array<{ _id: string; text: string; startMs: number; endMs: number; speakerLabel?: string }>;
  recentSegments?: Array<{ _id: string; text: string; startMs: number; endMs: number; speakerLabel?: string }>;
  activeCards?: Array<{ _id: string; title?: string; body?: string; reason?: string; agentId?: string; dedupeKey?: string }>;
  integrations?: IntegrationSummary[];
  workflow?: SidetoneLiveCardWorkflow;
};
type PreparedLiveCardAgentRun = {
  skip?: boolean;
  reason?: string;
  liveCardAgentRunId?: string;
  run?: {
    _id: string;
    callSessionId: string;
    industryProfile: string;
    transcriptWindow: string;
    sourceSegmentIds: string[];
    personaWorkflowVersion: string;
  };
  callSession?: PreparedLiveCardRun["callSession"];
  sourceSegments?: PreparedLiveCardRun["sourceSegments"];
  activeCards?: PreparedLiveCardRun["activeCards"];
  integrations?: IntegrationSummary[];
  workflow?: SidetoneLiveCardWorkflow;
  specialist?: SidetoneLiveCardSpecialist;
};

function liveSupervisorModel() {
  return process.env.SIDETONE_LIVE_SUPERVISOR_MODEL?.trim() || "gpt-5.5";
}

function liveSpecialistModel() {
  return process.env.SIDETONE_LIVE_SPECIALIST_MODEL?.trim() || "gpt-5.4";
}

function liveFastModel() {
  return process.env.SIDETONE_LIVE_FAST_MODEL?.trim() || "gpt-5.4-mini";
}

function outputTextFromResponses(response: any) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const chunks = response.output
    ?.flatMap((item: any) => item.content ?? [])
    ?.map((content: any) => content.text)
    ?.filter(Boolean);
  return chunks?.join("\n") ?? "";
}

async function callOpenAiJson<T>(input: {
  model: string;
  system: string;
  user: unknown;
  schemaName: string;
  schema: Record<string, unknown>;
  reasoningEffort?: "low" | "medium";
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: input.model,
      reasoning: { effort: input.reasoningEffort ?? "low" },
      input: [
        { role: "system", content: input.system },
        { role: "user", content: JSON.stringify(input.user) }
      ],
      text: {
        format: {
          type: "json_schema",
          name: input.schemaName,
          strict: true,
          schema: input.schema
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI live-card call failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  }

  return JSON.parse(outputTextFromResponses(await response.json())) as T;
}

const liveCardSupervisorSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["skip", "route"] },
    reason: { type: "string" },
    routedAgentIds: { type: "array", items: { type: "string" } },
    priority: { type: "string", enum: ["low", "normal", "high"] },
    highStakes: { type: "boolean" }
  },
  required: ["decision", "reason", "routedAgentIds", "priority", "highStakes"]
};

const liveCardCandidateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    emit: { type: "boolean" },
    kind: { anyOf: [{ type: "string", enum: ["focus_hit", "clarify", "memory", "risk", "web_context"] }, { type: "null" }] },
    title: { anyOf: [{ type: "string" }, { type: "null" }] },
    body: { anyOf: [{ type: "string" }, { type: "null" }] },
    reason: { anyOf: [{ type: "string" }, { type: "null" }] },
    priority: { type: "string", enum: ["low", "normal", "high"] },
    confidence: { type: "number" },
    dedupeKey: { anyOf: [{ type: "string" }, { type: "null" }] },
    sourceSegmentIds: { type: "array", items: { type: "string" } },
    sourceUrls: { type: "array", items: { type: "string" } },
    cardAction: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ["integration_setup", "integration_draft"] },
            integrationId: { type: "string" },
            label: { anyOf: [{ type: "string" }, { type: "null" }] },
            href: { anyOf: [{ type: "string" }, { type: "null" }] }
          },
          required: ["type", "integrationId", "label", "href"]
        },
        { type: "null" }
      ]
    },
    integrationActionDraft: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            integrationId: { type: "string" },
            actionType: { type: "string" },
            title: { type: "string" },
            summary: { type: "string" },
            payloadJson: { type: "string" }
          },
          required: ["integrationId", "actionType", "title", "summary", "payloadJson"]
        },
        { type: "null" }
      ]
    },
    skipReason: { anyOf: [{ type: "string" }, { type: "null" }] }
  },
  required: [
    "emit",
    "kind",
    "title",
    "body",
    "reason",
    "priority",
    "confidence",
    "dedupeKey",
    "sourceSegmentIds",
    "sourceUrls",
    "cardAction",
    "integrationActionDraft",
    "skipReason"
  ]
};

function compactWorkflowForPrompt(workflow: SidetoneLiveCardWorkflow) {
  return {
    version: workflow.version,
    emitPolicy: workflow.emitPolicy,
    specialists: workflow.specialists.map((specialist) => ({
      id: specialist.id,
      label: specialist.label,
      description: specialist.description,
      allowedToolIds: specialist.allowedToolIds
    })),
    tools: workflow.tools.map((tool) => ({
      id: tool.id,
      label: tool.label,
      description: tool.description,
      integrationId: tool.integrationId,
      connectionType: tool.connectionType,
      writePolicy: tool.writePolicy,
      capabilities: tool.capabilities ?? []
    })),
    examples: workflow.examples
  };
}

function onboardingOnlyTranscript(transcript: string) {
  const normalized = transcript.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized.length < 24
    || /welcome to (sidetone|scitone|cytone)|tap add call|merge calls|start taking notes|this call is being recorded and transcribed/.test(normalized);
}

export function normalizeRoutedAgentIds(decision: LiveCardSupervisorDecision, workflow: SidetoneLiveCardWorkflow) {
  if (decision.decision !== "route") {
    return [];
  }
  const allowedAgentIds = new Set(workflow.specialists.map((specialist) => specialist.id));
  return Array.from(new Set(decision.routedAgentIds))
    .filter((agentId) => allowedAgentIds.has(agentId))
    .slice(0, workflow.emitPolicy.maxSpecialistsPerWindow);
}

export function deterministicSupervisorDecision(input: {
  transcriptWindow: string;
  workflow: SidetoneLiveCardWorkflow;
  industryProfile?: string;
}): LiveCardSupervisorDecision {
  const transcript = input.transcriptWindow.toLowerCase();
  const agentIds = new Set(input.workflow.specialists.map((specialist) => specialist.id));
  if (onboardingOnlyTranscript(transcript)) {
    return {
      decision: "skip",
      reason: "Sidetone onboarding or disclosure audio only.",
      routedAgentIds: [],
      priority: "low",
      highStakes: false
    };
  }

  if (
    input.industryProfile === "athletics_recruiting"
    && agentIds.has("zuri_integration_draft")
    && /\b(coach|coaches|teamworks|front rush|ncsa|coach packet|eventbeacon|sportsrecruits|integration)\b/.test(transcript)
  ) {
    return {
      decision: "route",
      reason: "The transcript raised a recruiting-system integration or system-of-record question.",
      routedAgentIds: ["zuri_integration_draft"],
      priority: "normal",
      highStakes: false
    };
  }

  if (
    input.industryProfile === "real_estate_mortgage"
    && agentIds.has("maya_property_integration_draft")
    && /\b(tenant|owner|unit|lease|rent|maintenance|work order|vendor|buildium|rentvine|doorloop|appfolio|rent manager|property meld|yardi)\b/.test(transcript)
  ) {
    const routedAgentIds = /\b(leak|broken|repair|maintenance|work order|vendor|plumber|electrician|hvac|access)\b/.test(transcript)
      && agentIds.has("maya_maintenance_triage")
      ? ["maya_maintenance_triage", "maya_property_integration_draft"]
      : ["maya_property_integration_draft"];
    return {
      decision: "route",
      reason: "The transcript raised a property-management system-of-record or draft-action need.",
      routedAgentIds,
      priority: "normal",
      highStakes: /\b(eviction|habitability|fair housing|safety|emergency|lockout)\b/.test(transcript)
    };
  }

  if (
    input.industryProfile === "real_estate_mortgage"
    && agentIds.has("maya_transaction_terms")
    && /\b(buyer|seller|offer|contingency|inspection|appraisal|lender|title|closing|escrow|mortgage|rate)\b/.test(transcript)
  ) {
    return {
      decision: "route",
      reason: "The transcript raised a concrete real-estate or mortgage transaction detail.",
      routedAgentIds: ["maya_transaction_terms"],
      priority: "normal",
      highStakes: false
    };
  }

  if (input.industryProfile === "oil_and_gas_landmen") {
    const routedAgentIds: string[] = [];
    if (agentIds.has("oil_land_terms") && /\b(royalty|acre|acres|acreage|bonus|lease|tract|county|legal description|depth|option|extension)\b/.test(transcript)) {
      routedAgentIds.push("oil_land_terms");
    }
    if (agentIds.has("oil_title_due_diligence") && /\b(title|deed|probate|heir|heirship|mineral|mineral owner|surface owner|abstract|curative|ownership)\b/.test(transcript)) {
      routedAgentIds.push("oil_title_due_diligence");
    }
    if (agentIds.has("oil_commitment_followup") && /\b(offer|take|accept|send|sign|callback|call back|by friday|tomorrow|payment|paid|papers|documents)\b/.test(transcript)) {
      routedAgentIds.push("oil_commitment_followup");
    }
    if (agentIds.has("oil_owner_memory") && routedAgentIds.length === 0 && /\b(owner|landowner|sister|brother|dad|father|mother|family|prefers|hesitant|concerned)\b/.test(transcript)) {
      routedAgentIds.push("oil_owner_memory");
    }
    if (routedAgentIds.length) {
      return {
        decision: "route",
        reason: "The transcript raised oil-and-gas land terms, owner memory, title follow-up, or a verbal commitment.",
        routedAgentIds,
        priority: "normal",
        highStakes: /\b(title|deed|probate|heirship|ownership|accepted|accept)\b/.test(transcript)
      };
    }
  }

  if (input.industryProfile === "freight_brokerage") {
    const routedAgentIds: string[] = [];
    if (agentIds.has("freight_rate_commitment") && /\b(rate|all in|per mile|rpm|detention|layover|lumper|fuel|accessorial|quote|pay|paid|\$\d|dollars)\b/.test(transcript)) {
      routedAgentIds.push("freight_rate_commitment");
    }
    if (agentIds.has("freight_load_specs") && /\b(pickup|drop|delivery|appointment|dry van|reefer|flatbed|weight|pounds|commodity|lane|origin|destination|temperature|reference)\b/.test(transcript)) {
      routedAgentIds.push("freight_load_specs");
    }
    if (agentIds.has("freight_exception_followup") && /\b(late|missed|detention|claim|rejected|cancel|reconsign|check call|waiting|stuck|breakdown)\b/.test(transcript)) {
      routedAgentIds.push("freight_exception_followup");
    }
    if (agentIds.has("freight_carrier_memory") && routedAgentIds.length === 0 && /\b(carrier|dispatcher|driver|shipper|prefers|reliable|lane|relationship)\b/.test(transcript)) {
      routedAgentIds.push("freight_carrier_memory");
    }
    if (routedAgentIds.length) {
      return {
        decision: "route",
        reason: "The transcript raised a freight rate, load spec, exception, or carrier/customer memory.",
        routedAgentIds,
        priority: /\b(late|missed|claim|rejected|cancel|breakdown)\b/.test(transcript) ? "high" : "normal",
        highStakes: true
      };
    }
  }

  if (agentIds.has("commitment_signal") && /\b(end call button|stop notes|leave call|end the call|control)\b/.test(transcript)) {
    return {
      decision: "route",
      reason: "The transcript raised a concrete live-call control issue.",
      routedAgentIds: ["commitment_signal"],
      priority: "normal",
      highStakes: false
    };
  }

  return {
    decision: "skip",
    reason: "No concrete live-card signal found in the deterministic fallback.",
    routedAgentIds: [],
    priority: "low",
    highStakes: false
  };
}

function normalizedCardAction(value: any): LiveCardCandidate["cardAction"] {
  const type = value?.type === "integration_setup" || value?.type === "integration_draft" ? value.type : undefined;
  const integrationId = typeof value?.integrationId === "string" && isSidetoneIntegrationId(value.integrationId)
    ? value.integrationId
    : undefined;
  if (!type || !integrationId) {
    return undefined;
  }
  return {
    type,
    integrationId,
    label: typeof value?.label === "string" && value.label.trim() ? value.label.trim().slice(0, 60) : undefined,
    href: typeof value?.href === "string" && value.href.trim() && value.href.startsWith("/")
      ? value.href.trim().slice(0, 220)
      : undefined
  };
}

function normalizedIntegrationActionDraft(value: any): LiveCardCandidate["integrationActionDraft"] {
  const integrationId = typeof value?.integrationId === "string" && isSidetoneIntegrationId(value.integrationId)
    ? value.integrationId
    : undefined;
  const actionType = typeof value?.actionType === "string" ? value.actionType.trim().slice(0, 80) : "";
  const title = typeof value?.title === "string" ? value.title.trim().slice(0, 140) : "";
  const summary = typeof value?.summary === "string" ? value.summary.trim().slice(0, 600) : "";
  const payloadJson = typeof value?.payloadJson === "string" ? value.payloadJson.trim() : "";
  if (!integrationId || !actionType || !title || !summary || !payloadJson) {
    return undefined;
  }
  if (/(delete|destroy|charge|refund|evict|lockout|write[_-]?now|auto[_-]?write|direct[_-]?write)/i.test(actionType)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(payloadJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    if (JSON.stringify(parsed).length > 12_000) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return { integrationId, actionType, title, summary, payloadJson };
}

export function normalizeCandidate(value: any): LiveCardCandidate {
  const emit = Boolean(value?.emit);
  const integrationActionDraft = normalizedIntegrationActionDraft(value?.integrationActionDraft);
  const cardAction = normalizedCardAction(value?.cardAction)
    ?? (integrationActionDraft
      ? {
        type: "integration_draft" as const,
        integrationId: integrationActionDraft.integrationId,
        label: "Review draft"
      }
      : undefined);
  return {
    emit,
    kind: value?.kind ?? undefined,
    title: typeof value?.title === "string" && value.title.trim() ? value.title.trim() : undefined,
    body: typeof value?.body === "string" && value.body.trim() ? value.body.trim() : undefined,
    reason: typeof value?.reason === "string" && value.reason.trim() ? value.reason.trim() : undefined,
    priority: value?.priority === "low" || value?.priority === "high" ? value.priority : "normal",
    confidence: typeof value?.confidence === "number" ? value.confidence : emit ? 0.5 : 0,
    dedupeKey: typeof value?.dedupeKey === "string" && value.dedupeKey.trim() ? value.dedupeKey.trim() : undefined,
    sourceSegmentIds: Array.isArray(value?.sourceSegmentIds) ? value.sourceSegmentIds.map(String).filter(Boolean) : undefined,
    sourceUrls: Array.isArray(value?.sourceUrls) ? value.sourceUrls.map(String).filter(Boolean) : [],
    cardAction,
    integrationActionDraft,
    skipReason: typeof value?.skipReason === "string" && value.skipReason.trim() ? value.skipReason.trim() : undefined
  };
}

export function deterministicSpecialistCandidate(input: {
  transcriptWindow: string;
  specialist: SidetoneLiveCardSpecialist;
  sourceSegmentIds: string[];
  integrations?: IntegrationSummary[];
}): LiveCardCandidate {
  const transcript = input.transcriptWindow.toLowerCase();
  if (input.specialist.id === "zuri_integration_draft" && /\b(coach|coaches|teamworks|front rush|ncsa|coach packet|eventbeacon|sportsrecruits|integration)\b/.test(transcript)) {
    return {
      emit: true,
      kind: "web_context",
      title: "Confirm recruiting system",
      body: "Ask which recruiting system of record matters before drafting an action for Teamworks, Front Rush, NCSA Coach, Coach Packet, EventBeacon, or SportsRecruits.",
      reason: "The call raised coach integrations, but the target recruiting platform is not yet clear.",
      priority: "normal",
      confidence: 0.86,
      dedupeKey: "zuri:integration-system-of-record",
      sourceSegmentIds: input.sourceSegmentIds,
      sourceUrls: []
    };
  }

  if (input.specialist.id === "maya_property_integration_draft" && /\b(tenant|owner|unit|lease|rent|maintenance|work order|buildium|property manager|property management)\b/.test(transcript)) {
    const buildium = input.integrations?.find((integration) => integration.id === "buildium");
    const buildiumConnected = buildium?.connection?.status === "active";
    if (buildiumConnected) {
      return {
        emit: true,
        kind: "web_context",
        title: "Draft Buildium action",
        body: "Review a Buildium draft from this property-management call before anything is written externally.",
        reason: "The call contains a tenant, owner, unit, lease, rent, or maintenance action that belongs in the property-management system of record.",
        priority: "normal",
        confidence: 0.84,
        dedupeKey: "maya:buildium:draft-action",
        sourceSegmentIds: input.sourceSegmentIds,
        sourceUrls: [],
        cardAction: {
          type: "integration_draft",
          integrationId: "buildium",
          label: "Review draft"
        },
        integrationActionDraft: {
          integrationId: "buildium",
          actionType: /\b(leak|broken|repair|maintenance|work order|vendor|plumber|electrician|hvac)\b/.test(transcript)
            ? "maintenance_work_order"
            : "tenant_note",
          title: "Buildium draft from live call",
          summary: "Draft a Buildium record update from the live call transcript. Confirm the matched tenant, owner, unit, and payload before approving.",
          payloadJson: JSON.stringify({
            source: "sidetone_live_call",
            transcriptWindow: input.transcriptWindow.slice(-1800),
            requiresReview: true
          })
        }
      };
    }
    return {
      emit: true,
      kind: "web_context",
      title: "Connect Buildium",
      body: "Connect Buildium before Sidetone can draft tenant notes, owner notes, or maintenance work orders from property-management calls.",
      reason: "The call raised a property-management system-of-record action, but Buildium is not connected for this workspace.",
      priority: "normal",
      confidence: 0.82,
      dedupeKey: "maya:buildium:setup",
      sourceSegmentIds: input.sourceSegmentIds,
      sourceUrls: [],
      cardAction: {
        type: "integration_setup",
        integrationId: "buildium",
        label: "Connect Buildium",
        href: "/integrations?integration=buildium"
      }
    };
  }

  if (input.specialist.id === "maya_maintenance_triage" && /\b(leak|broken|repair|maintenance|work order|vendor|plumber|electrician|hvac|access)\b/.test(transcript)) {
    return {
      emit: true,
      kind: "risk",
      title: "Capture maintenance details",
      body: "Confirm the unit, issue, urgency, access instructions, owner approval, vendor, and tenant update before the call ends.",
      reason: "The call contains a concrete property-maintenance issue with operational details that can be expensive to lose.",
      priority: /\b(emergency|safety|flood|fire|no heat|lockout)\b/.test(transcript) ? "high" : "normal",
      confidence: 0.8,
      dedupeKey: "maya:maintenance:triage",
      sourceSegmentIds: input.sourceSegmentIds,
      sourceUrls: []
    };
  }

  if (input.specialist.id === "maya_transaction_terms" && /\b(buyer|seller|offer|contingency|inspection|appraisal|lender|title|closing|escrow|mortgage|rate)\b/.test(transcript)) {
    return {
      emit: true,
      kind: "clarify",
      title: "Confirm transaction detail",
      body: "Confirm the real-estate or mortgage term, deadline, owner, and tradeoff while the call is still live.",
      reason: "The call contains a transaction detail that should be captured without routing to a property-management integration.",
      priority: "normal",
      confidence: 0.78,
      dedupeKey: "maya:transaction:terms",
      sourceSegmentIds: input.sourceSegmentIds,
      sourceUrls: []
    };
  }

  if (input.specialist.id === "oil_land_terms" && /\b(royalty|acre|acres|acreage|bonus|lease|tract|county|legal description|depth|option|extension)\b/.test(transcript)) {
    return {
      emit: true,
      kind: "clarify",
      title: "Confirm land terms",
      body: "Confirm the royalty, acreage, lease bonus, tract/county, and any signing condition while the terms are fresh.",
      reason: "The call contains oil-and-gas land terms that can create financial or title disputes if captured loosely.",
      priority: "normal",
      confidence: 0.82,
      dedupeKey: "oil:land-terms",
      sourceSegmentIds: input.sourceSegmentIds,
      sourceUrls: []
    };
  }

  if (input.specialist.id === "oil_title_due_diligence" && /\b(title|deed|probate|heir|heirship|mineral|mineral owner|surface owner|abstract|curative|ownership)\b/.test(transcript)) {
    return {
      emit: true,
      kind: "risk",
      title: "Verify title detail",
      body: "Document the ownership or title fact to verify, including any deed, probate, heirship, mineral-interest, or curative follow-up mentioned.",
      reason: "The call raised a title or ownership issue that should be treated as a verification item, not assumed.",
      priority: "high",
      confidence: 0.8,
      dedupeKey: "oil:title-diligence",
      sourceSegmentIds: input.sourceSegmentIds,
      sourceUrls: []
    };
  }

  if (input.specialist.id === "oil_commitment_followup" && /\b(offer|take|accept|send|sign|callback|call back|by friday|tomorrow|payment|paid|papers|documents)\b/.test(transcript)) {
    return {
      emit: true,
      kind: "focus_hit",
      title: "Capture verbal commitment",
      body: "Write down the offer, acceptance, document send, payment timing, callback, and open condition before the call moves on.",
      reason: "The call contains a verbal commitment that may become the record everyone argues from later.",
      priority: "normal",
      confidence: 0.81,
      dedupeKey: "oil:commitment-followup",
      sourceSegmentIds: input.sourceSegmentIds,
      sourceUrls: []
    };
  }

  if (input.specialist.id === "freight_rate_commitment" && /\b(rate|all in|per mile|rpm|detention|layover|lumper|fuel|accessorial|quote|pay|paid|\$\d|dollars)\b/.test(transcript)) {
    return {
      emit: true,
      kind: "focus_hit",
      title: "Confirm freight rate",
      body: "Confirm the rate, per-mile terms, accessorials, payment condition, and who committed before dispatch.",
      reason: "The call contains a freight rate or accessorial commitment that can directly affect margin.",
      priority: "normal",
      confidence: 0.84,
      dedupeKey: "freight:rate-commitment",
      sourceSegmentIds: input.sourceSegmentIds,
      sourceUrls: []
    };
  }

  if (input.specialist.id === "freight_load_specs" && /\b(pickup|drop|delivery|appointment|dry van|reefer|flatbed|weight|pounds|commodity|lane|origin|destination|temperature|reference)\b/.test(transcript)) {
    return {
      emit: true,
      kind: "memory",
      title: "Capture load specs",
      body: "Confirm lane, appointment windows, equipment, weight, commodity, reference numbers, and facility instructions.",
      reason: "The call contains dispatch-critical load facts that should not be reconstructed later.",
      priority: "normal",
      confidence: 0.82,
      dedupeKey: "freight:load-specs",
      sourceSegmentIds: input.sourceSegmentIds,
      sourceUrls: []
    };
  }

  if (input.specialist.id === "freight_exception_followup" && /\b(late|missed|detention|claim|rejected|cancel|reconsign|check call|waiting|stuck|breakdown)\b/.test(transcript)) {
    return {
      emit: true,
      kind: "risk",
      title: "Track freight exception",
      body: "Capture the exception, timing, responsible party, promised update, and money term before the situation changes.",
      reason: "The call contains a freight exception or dispute risk that needs a clear live record.",
      priority: "high",
      confidence: 0.83,
      dedupeKey: "freight:exception-followup",
      sourceSegmentIds: input.sourceSegmentIds,
      sourceUrls: []
    };
  }

  if (input.specialist.id === "commitment_signal" && /\b(end call button|stop notes|leave call|end the call|control)\b/.test(transcript)) {
    return {
      emit: true,
      kind: "clarify",
      title: "Stop notes control",
      body: "Add one clear Stop notes action on the live call surface so the user can stop Sidetone without returning to the dashboard.",
      reason: "The transcript identified a concrete missing live-call control.",
      priority: "normal",
      confidence: 0.82,
      dedupeKey: "product:stop-notes-control",
      sourceSegmentIds: input.sourceSegmentIds,
      sourceUrls: []
    };
  }

  return {
    emit: false,
    priority: "low",
    confidence: 0,
    sourceSegmentIds: input.sourceSegmentIds,
    sourceUrls: [],
    skipReason: "No specialist-specific signal found."
  };
}

function specialistPrompt(input: {
  workflow: SidetoneLiveCardWorkflow;
  specialist: SidetoneLiveCardSpecialist;
  tools: readonly SidetoneLiveCardToolDescriptor[];
}) {
  const allowedTools = input.tools.filter((tool) => input.specialist.allowedToolIds.includes(tool.id));
  return [
    "You are a Sidetone live-card specialist.",
    "Return one candidate JSON object only. You do not write to the UI directly.",
    "Emit only when this specialist has a concrete, timely signal from the transcript window.",
    "Every user-facing card will be labeled Live signal, so do not include UI label language.",
    "Never invent facts, names, dates, systems, compliance conclusions, or external writes.",
    "External integrations are draft-only and approval-gated; if not connected, emit a cardAction with type integration_setup.",
    "When a connected integration needs action, emit integrationActionDraft with payloadJson as a plain JSON object string. Never emit destructive, direct-write, billing, lockout, eviction, delete, charge, or refund actions.",
    `Workflow version: ${input.workflow.version}.`,
    `Specialist: ${input.specialist.label}. ${input.specialist.description}`,
    `Instructions: ${input.specialist.instructions}`,
    allowedTools.length
      ? `Allowed tool descriptors: ${JSON.stringify(allowedTools)}`
      : "No external tools are available to this specialist."
  ].join("\n");
}

type FailureEventPayload = {
  data?: {
    event?: {
      data?: {
        runId?: unknown;
        callSessionId?: unknown;
        liveCardRunId?: unknown;
        agentId?: unknown;
      };
    };
  };
};

function runIdFromFailureEvent(event: FailureEventPayload) {
  return typeof event?.data?.event?.data?.runId === "string" ? event.data.event.data.runId : null;
}

function callSessionIdFromFailureEvent(event: FailureEventPayload) {
  return typeof event?.data?.event?.data?.callSessionId === "string"
    ? event.data.event.data.callSessionId
    : null;
}

function liveCardRunIdFromFailureEvent(event: FailureEventPayload) {
  return typeof event?.data?.event?.data?.liveCardRunId === "string"
    ? event.data.event.data.liveCardRunId
    : null;
}

function liveCardAgentIdFromFailureEvent(event: FailureEventPayload) {
  return typeof event?.data?.event?.data?.agentId === "string"
    ? event.data.event.data.agentId
    : null;
}

function assemblyAiHeaders() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ASSEMBLYAI_API_KEY is not configured.");
  }
  return {
    authorization: apiKey,
    "Content-Type": "application/json"
  };
}

function assemblyAiAuthHeader() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ASSEMBLYAI_API_KEY is not configured.");
  }
  return { authorization: apiKey };
}

type AssemblyAiTranscript = {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  text?: string | null;
  error?: string | null;
  audio_duration?: number | null;
  utterances?: Array<{
    text?: string | null;
    start?: number | null;
    end?: number | null;
    speaker?: string | null;
    confidence?: number | null;
  }> | null;
};

type VexaPlatform = "google_meet" | "teams" | "zoom";

type VexaTranscript = {
  id?: number;
  status?: string | null;
  start_time?: string | number | null;
  end_time?: string | number | null;
  segments?: Array<{
    text?: string | null;
    start_time?: number | null;
    end_time?: number | null;
    start?: number | null;
    end?: number | null;
    speaker?: string | null;
    confidence?: number | null;
    completed?: boolean | null;
  }> | null;
};

type VexaRecordingMediaFile = {
  id?: number | string | null;
  type?: string | null;
  format?: string | null;
  file_size_bytes?: number | null;
  duration_seconds?: number | null;
  created_at?: string | number | null;
};

type VexaRecording = {
  id?: number | string | null;
  meeting_id?: number | string | null;
  status?: string | null;
  created_at?: string | number | null;
  completed_at?: string | number | null;
  media_files?: VexaRecordingMediaFile[] | null;
};

type VexaRecordingList = {
  recordings?: VexaRecording[] | null;
  detail?: string | null;
  error?: string | null;
};

type VexaRecordingDownloadResponse = {
  url?: string | null;
  download_url?: string | null;
  filename?: string | null;
  content_type?: string | null;
  file_size_bytes?: number | null;
  detail?: string | null;
  error?: string | null;
};

async function submitAssemblyAiTranscript(audioUrl: string) {
  const response = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: assemblyAiHeaders(),
    body: JSON.stringify({
      audio_url: audioUrl,
      speech_models: ["universal-3-pro", "universal-2"],
      language_detection: true,
      speaker_labels: true,
      punctuate: true,
      format_text: true
    })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? `AssemblyAI transcript submit failed (${response.status}).`);
  }
  if (!body?.id) {
    throw new Error("AssemblyAI did not return a transcript id.");
  }
  return body as AssemblyAiTranscript;
}

async function getAssemblyAiTranscript(transcriptId: string) {
  const response = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
    headers: assemblyAiHeaders()
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? `AssemblyAI transcript lookup failed (${response.status}).`);
  }
  return body as AssemblyAiTranscript;
}

async function uploadAssemblyAiAudioFromUrl(audioUrl: string, headers?: HeadersInit) {
  const upstream = await fetch(audioUrl, {
    headers,
    cache: "no-store"
  });
  if (!upstream.ok || !upstream.body) {
    throw new Error(`Unable to download audio for transcription (${upstream.status}).`);
  }

  const response = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: assemblyAiAuthHeader(),
    body: upstream.body,
    duplex: "half"
  } as RequestInit & { duplex: "half" });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? `AssemblyAI upload failed (${response.status}).`);
  }
  if (!body?.upload_url) {
    throw new Error("AssemblyAI did not return an upload URL.");
  }
  return { uploadUrl: String(body.upload_url) };
}

function segmentsFromAssemblyAiTranscript(transcript: AssemblyAiTranscript) {
  const utterances = transcript.utterances
    ?.filter((utterance) => utterance.text?.trim())
    .map((utterance) => ({
      text: utterance.text!.trim(),
      startMs: Math.max(0, Number(utterance.start ?? 0)),
      endMs: Math.max(Number(utterance.start ?? 0), Number(utterance.end ?? utterance.start ?? 0)),
      speakerLabel: utterance.speaker ? `Speaker ${utterance.speaker}` : undefined,
      confidence: typeof utterance.confidence === "number" ? utterance.confidence : undefined
    })) ?? [];

  if (utterances.length) {
    return utterances;
  }

  const text = transcript.text?.trim();
  if (!text) {
    return [];
  }

  return [{
    text,
    startMs: 0,
    endMs: Math.max(1000, Math.round(Number(transcript.audio_duration ?? 0) * 1000)),
    speakerLabel: undefined,
    confidence: undefined
  }];
}

function vexaApiBase() {
  return (process.env.VEXA_API_BASE?.trim() || "https://api.cloud.vexa.ai").replace(/\/+$/, "");
}

function vexaApiKey() {
  const key = process.env.VEXA_API_KEY?.trim() || process.env.VEXA_BOT_KEY?.trim();
  if (!key) {
    throw new Error("VEXA_API_KEY or VEXA_BOT_KEY is not configured.");
  }
  return key;
}

async function fetchVexaTranscript(platform: VexaPlatform, nativeMeetingId: string) {
  const response = await fetch(
    `${vexaApiBase()}/transcripts/${encodeURIComponent(platform)}/${encodeURIComponent(nativeMeetingId)}`,
    {
      headers: {
        "X-API-Key": vexaApiKey()
      },
      cache: "no-store"
    }
  );
  const body = await response.json().catch(() => null);
  if (response.status === 404) {
    return { status: "not_found", segments: [] } satisfies VexaTranscript;
  }
  if (!response.ok) {
    throw new Error(body?.detail ?? body?.error ?? `Vexa transcript lookup failed (${response.status}).`);
  }
  return body as VexaTranscript;
}

async function fetchVexaRecordingsForMeeting(vexaMeetingId: string) {
  const url = new URL(`${vexaApiBase()}/recordings`);
  url.searchParams.set("meeting_id", vexaMeetingId);
  const response = await fetch(url, {
    headers: {
      "X-API-Key": vexaApiKey()
    },
    cache: "no-store"
  });
  const body = await response.json().catch(() => null) as VexaRecordingList | null;
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(body?.detail ?? body?.error ?? `Vexa recording lookup failed (${response.status}).`);
  }
  return body?.recordings ?? [];
}

async function fetchVexaRecordingDownloadMetadata(recordingId: string, mediaFileId: string) {
  const response = await fetch(
    `${vexaApiBase()}/recordings/${encodeURIComponent(recordingId)}/media/${encodeURIComponent(mediaFileId)}/download`,
    {
      headers: {
        "X-API-Key": vexaApiKey()
      },
      cache: "no-store"
    }
  );
  const body = await response.json().catch(() => null) as VexaRecordingDownloadResponse | null;
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(body?.detail ?? body?.error ?? `Vexa recording download lookup failed (${response.status}).`);
  }
  const url = body?.url ?? body?.download_url;
  if (!url) {
    return null;
  }
  return {
    url,
    fileName: body?.filename ?? undefined,
    contentType: body?.content_type ?? undefined,
    sizeBytes: body?.file_size_bytes ?? undefined
  };
}

function vexaRecordingRawUrl(recordingId: string, mediaFileId: string) {
  return `${vexaApiBase()}/recordings/${encodeURIComponent(recordingId)}/media/${encodeURIComponent(mediaFileId)}/raw`;
}

function secondsToMs(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.round(numeric * 1000);
}

function segmentsFromVexaTranscript(transcript: VexaTranscript) {
  return (transcript.segments ?? [])
    .filter((segment) => segment.text?.trim())
    .map((segment) => {
      const startMs = secondsToMs(segment.start_time ?? segment.start ?? 0);
      const endMs = secondsToMs(segment.end_time ?? segment.end ?? 0);
      return {
        text: segment.text!.trim(),
        startMs,
        endMs: Math.max(endMs, startMs + 1),
        speakerLabel: segment.speaker?.trim() || undefined,
        confidence: typeof segment.confidence === "number" ? segment.confidence : undefined,
        isFinal: segment.completed ?? true
      };
    });
}

function isVexaTerminalStatus(status?: string | null) {
  const normalized = status?.toLowerCase();
  return normalized === "completed"
    || normalized === "ready"
    || normalized === "ended"
    || normalized === "stopped";
}

function isVexaFailureStatus(status?: string | null) {
  const normalized = status?.toLowerCase();
  return normalized === "failed"
    || normalized === "cancelled"
    || normalized === "error"
    || normalized === "needs_human_help";
}

function vexaFailureMessage(platform: VexaPlatform, status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "needs_human_help" && platform === "zoom") {
    return "Zoom blocked Vexa's automated Web Client bot. Configure Vexa's Zoom SDK/RTMS path before using Zoom meetings.";
  }
  if (normalized === "needs_human_help") {
    return "Vexa needs manual operator help to join this meeting.";
  }
  return `Vexa meeting ended with status ${status}.`;
}

function isVexaRecordingReady(status?: string | null) {
  const normalized = status?.toLowerCase();
  return normalized === "completed" || normalized === "ready";
}

function timestampFromVexa(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function vexaRecordingFormat(format?: string | null) {
  const normalized = format?.trim().toLowerCase();
  return normalized === "mp3"
    || normalized === "wav"
    || normalized === "m4a"
    || normalized === "webm"
    || normalized === "ogg"
    ? normalized
    : undefined;
}

function fallbackContentTypeForFormat(format?: string) {
  if (format === "wav") return "audio/wav";
  if (format === "mp3") return "audio/mpeg";
  if (format === "m4a") return "audio/mp4";
  if (format === "ogg") return "audio/ogg";
  if (format === "webm") return "video/webm";
  return undefined;
}

function selectVexaRecordingMedia(recordings: VexaRecording[]) {
  const readyRecordings = recordings
    .filter((recording) => recording.id !== undefined && recording.id !== null && isVexaRecordingReady(recording.status))
    .sort((left, right) =>
      (timestampFromVexa(right.completed_at ?? right.created_at) ?? 0)
      - (timestampFromVexa(left.completed_at ?? left.created_at) ?? 0)
    );

  for (const recording of readyRecordings) {
    const mediaFiles = (recording.media_files ?? [])
      .filter((media) => media.id !== undefined && media.id !== null)
      .sort((left, right) => {
        const leftRank = left.type === "audio" ? 0 : left.type === "video" ? 1 : 2;
        const rightRank = right.type === "audio" ? 0 : right.type === "video" ? 1 : 2;
        return leftRank - rightRank;
      });
    const media = mediaFiles[0];
    if (media) {
      return { recording, media };
    }
  }

  return null;
}

async function resolveVexaRecordingForMeeting(vexaMeetingId: string) {
  const recordings = await fetchVexaRecordingsForMeeting(vexaMeetingId);
  const selected = selectVexaRecordingMedia(recordings);
  if (!selected) {
    return { status: "pending", recordingCount: recordings.length } as const;
  }

  const recordingId = String(selected.recording.id);
  const mediaFileId = String(selected.media.id);
  const download = await fetchVexaRecordingDownloadMetadata(recordingId, mediaFileId);
  if (!download) {
    return { status: "pending", recordingCount: recordings.length, recordingId, mediaFileId } as const;
  }

  const format = vexaRecordingFormat(selected.media.format);
  const durationMs = typeof selected.media.duration_seconds === "number" && Number.isFinite(selected.media.duration_seconds)
    ? Math.round(selected.media.duration_seconds * 1000)
    : undefined;

  return {
    status: "ready",
    recordingId,
    vexaMeetingId: String(selected.recording.meeting_id ?? vexaMeetingId),
    mediaFileId,
    format,
    fileName: download.fileName ?? `vexa-meeting-${vexaMeetingId}.${format ?? "webm"}`,
    mimeType: download.contentType ?? fallbackContentTypeForFormat(format),
    sizeBytes: download.sizeBytes ?? selected.media.file_size_bytes ?? undefined,
    recordingStartedAt: timestampFromVexa(selected.recording.created_at),
    recordingEndedAt: timestampFromVexa(selected.recording.completed_at),
    durationMs
  } as const;
}

export const callIntelligenceRun = inngest.createFunction(
  {
    id: "call-intelligence-run",
    name: "Call Intelligence Run",
    retries: 3,
    triggers: [{ event: "sidetone/call-intelligence.requested" }],
    onFailure: async ({ event, error, step }) => {
      const runId = runIdFromFailureEvent(event);
      if (!runId) {
        return;
      }
      await step.run("mark-run-failed", async () => {
        await runStep("fail-run", {
          runId,
          errorCode: "retries_exhausted",
          error: error.message
        });
      });
    }
  },
  async ({ event, step, runId }) => {
    const sidetoneRunId = event.data.runId;
    if (typeof sidetoneRunId !== "string" || !sidetoneRunId) {
      throw new Error("Missing Call Intelligence run id.");
    }

    await step.run("claim-run", async () => {
      return await runStep("claim-run", {
        runId: sidetoneRunId,
        inngestRunId: runId
      });
    });

    await step.run("plan-retrieval", async () => {
      return await runStep("plan-retrieval", { runId: sidetoneRunId });
    });

    await step.run("retrieve-evidence", async () => {
      return await runStep("retrieve-evidence", { runId: sidetoneRunId });
    });

    await step.run("generate-answer", async () => {
      return await runStep("generate-answer", { runId: sidetoneRunId });
    });

    await step.run("complete-run", async () => {
      return await runStep("complete-run", { runId: sidetoneRunId });
    });

    return { runId: sidetoneRunId };
  }
);

export const liveCardSupervisor = inngest.createFunction(
  {
    id: "live-card-supervisor",
    name: "Live Card Supervisor",
    retries: 2,
    triggers: [{ event: "sidetone/live-card.segment-created" }],
    batchEvents: {
      // Inngest plan limit: registration is rejected outright if maxSize > 5,
      // which silently unregisters every function in this app. Keep at <= 5.
      maxSize: 5,
      timeout: "3s",
      key: "event.data.callSessionId"
    },
    concurrency: {
      limit: 1,
      key: "event.data.callSessionId"
    }
  },
  async (input: any) => {
    const step = input.step;
    const runId = input.runId;
    const eventBatch = Array.isArray(input.events) && input.events.length ? input.events : [input.event];
    const callSessionId = eventBatch.find((event: any) => typeof event?.data?.callSessionId === "string")?.data.callSessionId;
    if (typeof callSessionId !== "string" || !callSessionId) {
      throw new Error("Missing live-card call session id.");
    }

    const sourceSegmentIds = Array.from(new Set(eventBatch.flatMap((event: any) => {
      const segmentIds = Array.isArray(event?.data?.segmentIds) ? event.data.segmentIds : [];
      const segmentId = typeof event?.data?.segmentId === "string" ? [event.data.segmentId] : [];
      return [...segmentIds, ...segmentId].map(String).filter(Boolean);
    })));
    if (!sourceSegmentIds.length) {
      return { callSessionId, status: "skipped", reason: "missing_segment" };
    }

    const supervisorModel = liveSupervisorModel();
    const preparedBody = await step.run("prepare-live-card-run", async () => {
      return await runStep("prepare-live-card-run", {
        callSessionId,
        sourceSegmentIds,
        supervisorModel,
        inngestRunId: runId
      });
    });
    const prepared = preparedBody?.result as PreparedLiveCardRun | undefined;
    if (!prepared || prepared.skip || !prepared.liveCardRunId || !prepared.workflow) {
      return { callSessionId, status: "skipped", reason: prepared?.reason ?? "not_prepared" };
    }

    const decision = await step.run("route-live-card-window", async () => {
      const llmDecision = await callOpenAiJson<LiveCardSupervisorDecision>({
        model: supervisorModel,
        reasoningEffort: prepared.callSession?.industryProfile === "legal_client_services" ? "medium" : "low",
        schemaName: "sidetone_live_card_supervisor",
        schema: liveCardSupervisorSchema,
        system: [
          prepared.workflow!.supervisorPrompt,
          "Return JSON only.",
          "Route to zero, one, or two specialist agent ids.",
          "Skip Sidetone onboarding/disclosure audio and filler.",
          "A product issue raised by the owner can be routed as a concrete signal."
        ].join(" "),
        user: {
          callSession: prepared.callSession,
          entity: prepared.entity,
          transcriptWindow: prepared.transcriptWindow,
          sourceSegments: prepared.sourceSegments ?? [],
          recentSegments: prepared.recentSegments ?? [],
          workflow: compactWorkflowForPrompt(prepared.workflow!),
          integrations: prepared.integrations ?? [],
          activeCards: prepared.activeCards ?? []
        }
      });

      return llmDecision ?? deterministicSupervisorDecision({
        transcriptWindow: prepared.transcriptWindow ?? "",
        workflow: prepared.workflow!,
        industryProfile: prepared.callSession?.industryProfile
      });
    }) as LiveCardSupervisorDecision;

    const routedAgentIds = normalizeRoutedAgentIds(decision, prepared.workflow);
    if (!routedAgentIds.length) {
      await step.run("complete-live-card-run-skipped", async () => {
        return await runStep("complete-live-card-run", {
          liveCardRunId: prepared.liveCardRunId,
          status: "skipped",
          skipReason: decision.reason,
          routedAgentIds: [],
          supervisorModel
        });
      });
      return { callSessionId, liveCardRunId: prepared.liveCardRunId, status: "skipped", reason: decision.reason };
    }

    await step.run("complete-live-card-run-routed", async () => {
      return await runStep("complete-live-card-run", {
        liveCardRunId: prepared.liveCardRunId,
        status: "routed",
        routedAgentIds,
        supervisorModel
      });
    });

    await step.sendEvent(
      "request-live-card-specialists",
      routedAgentIds.map((agentId) => ({
        name: "sidetone/live-card.agent-requested",
        data: {
          callSessionId,
          liveCardRunId: prepared.liveCardRunId,
          agentId,
          highStakes: decision.highStakes,
          priority: decision.priority
        }
      }))
    );

    return { callSessionId, liveCardRunId: prepared.liveCardRunId, routedAgentIds };
  }
);

export const liveCardSpecialist = inngest.createFunction(
  {
    id: "live-card-specialist",
    name: "Live Card Specialist",
    retries: 2,
    triggers: [{ event: "sidetone/live-card.agent-requested" }],
    concurrency: {
      limit: 1,
      key: "event.data.callSessionId"
    },
    onFailure: async ({ event, error, step }) => {
      const liveCardRunId = liveCardRunIdFromFailureEvent(event);
      if (!liveCardRunId) {
        return;
      }
      await step.run("mark-live-card-agent-failed", async () => {
        await runStep("fail-live-card-agent-run", {
          liveCardRunId,
          agentId: liveCardAgentIdFromFailureEvent(event) ?? undefined,
          error: error.message
        });
      });
    }
  },
  async ({ event, step }) => {
    const callSessionId = event.data.callSessionId;
    const liveCardRunId = event.data.liveCardRunId;
    const agentId = event.data.agentId;
    if (typeof callSessionId !== "string" || typeof liveCardRunId !== "string" || typeof agentId !== "string") {
      throw new Error("Missing live-card specialist payload.");
    }

    const highStakes = Boolean(event.data.highStakes);
    const specialistModel = highStakes ? liveSpecialistModel() : liveFastModel();
    const preparedBody = await step.run("prepare-live-card-agent-run", async () => {
      return await runStep("prepare-live-card-agent-run", {
        liveCardRunId,
        agentId,
        specialistModel
      });
    });
    const prepared = preparedBody?.result as PreparedLiveCardAgentRun | undefined;
    if (!prepared || prepared.skip || !prepared.liveCardAgentRunId || !prepared.workflow || !prepared.specialist || !prepared.run) {
      return { callSessionId, liveCardRunId, agentId, status: "skipped", reason: prepared?.reason ?? "not_prepared" };
    }

    const candidate = await step.run("run-live-card-specialist", async () => {
      const llmCandidate = await callOpenAiJson<LiveCardCandidate>({
        model: specialistModel,
        reasoningEffort: highStakes ? "medium" : "low",
        schemaName: "sidetone_live_card_candidate",
        schema: liveCardCandidateSchema,
        system: specialistPrompt({
          workflow: prepared.workflow!,
          specialist: prepared.specialist!,
          tools: prepared.workflow!.tools
        }),
        user: {
          callSession: prepared.callSession,
          transcriptWindow: prepared.run!.transcriptWindow,
          sourceSegments: prepared.sourceSegments ?? [],
          activeCards: prepared.activeCards ?? [],
          integrations: prepared.integrations ?? [],
          workflowExamples: prepared.workflow!.examples
        }
      });

      return normalizeCandidate(llmCandidate ?? deterministicSpecialistCandidate({
        transcriptWindow: prepared.run!.transcriptWindow,
        specialist: prepared.specialist!,
        sourceSegmentIds: prepared.run!.sourceSegmentIds,
        integrations: prepared.integrations
      }));
    }) as LiveCardCandidate;

    await step.run("complete-live-card-agent-run", async () => {
      return await runStep("complete-live-card-agent-run", {
        liveCardAgentRunId: prepared.liveCardAgentRunId,
        specialistModel,
        candidate
      });
    });

    return { callSessionId, liveCardRunId, agentId, emitted: candidate.emit };
  }
);

type LiveCallMonitorResult = {
  continueMonitoring?: boolean;
  shouldEndCall?: boolean;
  shouldSendWarningSms?: boolean;
  shouldSendGraceSms?: boolean;
  callControlIds?: string[];
  ownerPhoneNumber?: string;
  sidetonePhoneNumber?: string;
  remainingSeconds?: number;
};

async function sendUsageSms(result: LiveCallMonitorResult, text: string) {
  if (!result.ownerPhoneNumber || !result.sidetonePhoneNumber) {
    return { status: "skipped", reason: "missing_phone_number" };
  }
  await sendTelnyxSms({
    fromPhoneNumber: result.sidetonePhoneNumber,
    toPhoneNumber: result.ownerPhoneNumber,
    text
  });
  return { status: "sent" };
}

export const billingLiveCallMonitor = inngest.createFunction(
  {
    id: "billing-live-call-monitor",
    name: "Billing Live Call Monitor",
    retries: 2,
    triggers: [{ event: "sidetone/billing.live-call-monitor.requested" }]
  },
  async ({ event, step }) => {
    const callSessionId = event.data.callSessionId;
    if (typeof callSessionId !== "string" || !callSessionId) {
      throw new Error("Missing live call session id.");
    }

    for (let attempt = 0; attempt < 480; attempt += 1) {
      const body = await step.run(`monitor-live-call-${attempt}`, async () => {
        return await runStep("monitor-live-call", { callSessionId });
      });
      const result = body?.result as LiveCallMonitorResult | undefined;
      if (!result?.continueMonitoring) {
        if (result?.shouldEndCall && result.callControlIds?.length) {
          await step.run(`end-live-call-${attempt}`, async () => {
            await Promise.allSettled(
              result.callControlIds!.map((callControlId) => hangupCall({ callControlId }))
            );
          });
        }
        return { callSessionId, status: result?.shouldEndCall ? "ended" : "stopped" };
      }

      if (result.shouldSendWarningSms) {
        await step.run(`send-warning-sms-${attempt}`, async () => {
          return await sendUsageSms(
            result,
            "Sidetone usage update: you have about 30 included phone minutes left this month. Your current call can continue."
          );
        });
      }

      if (result.shouldSendGraceSms) {
        await step.run(`send-grace-sms-${attempt}`, async () => {
          return await sendUsageSms(
            result,
            "Sidetone usage limit reached. This call has a 30-minute grace period before Sidetone ends. Upgrade from Subscriptions to keep using phone calls."
          );
        });
      }

      await step.sleep(`wait-before-next-billing-check-${attempt}`, "1m");
    }

    return { callSessionId, status: "max_checks_reached" };
  }
);

export const uploadedRecordingProcessing = inngest.createFunction(
  {
    id: "uploaded-recording-processing",
    name: "Uploaded Recording Processing",
    retries: 3,
    triggers: [{ event: "sidetone/recording-upload.requested" }],
    onFailure: async ({ event, error, step }) => {
      const callSessionId = callSessionIdFromFailureEvent(event);
      if (!callSessionId) {
        return;
      }
      await step.run("mark-upload-failed", async () => {
        await runStep("fail-uploaded-recording", {
          callSessionId,
          error: error.message
        });
      });
    }
  },
  async ({ event, step }) => {
    const callSessionId = event.data.callSessionId;
    if (typeof callSessionId !== "string" || !callSessionId) {
      throw new Error("Missing uploaded recording call session id.");
    }

    const prepared = await step.run("prepare-uploaded-recording", async () => {
      return await runStep("prepare-uploaded-recording", { callSessionId });
    });
    const storageUrl = String(prepared?.result?.storageUrl ?? "");
    if (!storageUrl) {
      throw new Error("Uploaded recording did not return a storage URL.");
    }

    const submitted = await step.run("submit-assemblyai-transcript", async () => {
      return await submitAssemblyAiTranscript(storageUrl);
    });
    const transcriptId = String(submitted.id);
    let transcript = submitted;

    for (let attempt = 0; attempt < 240; attempt += 1) {
      transcript = await step.run(`poll-assemblyai-transcript-${attempt}`, async () => {
        return await getAssemblyAiTranscript(transcriptId);
      });

      if (transcript.status === "completed") {
        break;
      }
      if (transcript.status === "error") {
        throw new Error(transcript.error ?? "AssemblyAI could not transcribe this recording.");
      }

      await step.sleep(`wait-for-assemblyai-${attempt}`, "5s");
    }

    if (transcript.status !== "completed") {
      throw new Error("AssemblyAI transcription timed out.");
    }

    const segments = segmentsFromAssemblyAiTranscript(transcript);
    if (!segments.length) {
      throw new Error("AssemblyAI did not return transcript text.");
    }

    await step.run("save-uploaded-transcript", async () => {
      return await runStep("record-uploaded-transcript", {
        callSessionId,
        assemblyAiTranscriptId: transcriptId,
        segments
      });
    });

    await step.run("generate-uploaded-notes", async () => {
      return await runStep("finalize-uploaded-recording", { callSessionId });
    });

    return { callSessionId, transcriptId, segmentCount: segments.length };
  }
);

export const vexaMeetingProcessing = inngest.createFunction(
  {
    id: "vexa-meeting-processing",
    name: "Vexa Meeting Processing",
    retries: 2,
    triggers: [{ event: "sidetone/vexa-meeting.requested" }],
    onFailure: async ({ event, error, step }) => {
      const callSessionId = callSessionIdFromFailureEvent(event);
      if (!callSessionId) {
        return;
      }
      await step.run("mark-vexa-meeting-failed", async () => {
        await runStep("fail-vexa-meeting", {
          callSessionId,
          error: error.message
        });
      });
    }
  },
  async ({ event, step }) => {
    const callSessionId = event.data.callSessionId;
    if (typeof callSessionId !== "string" || !callSessionId) {
      throw new Error("Missing Vexa meeting call session id.");
    }

    const prepared = await step.run("prepare-vexa-meeting", async () => {
      return await runStep("prepare-vexa-meeting", { callSessionId });
    });
    const platform = prepared?.result?.platform as VexaPlatform | undefined;
    const nativeMeetingId = String(prepared?.result?.nativeMeetingId ?? "");
    let vexaMeetingId = prepared?.result?.vexaMeetingId !== undefined && prepared?.result?.vexaMeetingId !== null
      ? String(prepared.result.vexaMeetingId)
      : "";
    if (!platform || !nativeMeetingId) {
      throw new Error("Vexa meeting capture is missing platform or meeting id.");
    }

    let latestSegmentCount = 0;
    let latestStatus = "";
    let sawTranscript = false;

    for (let attempt = 0; attempt < 1440; attempt += 1) {
      const transcript = await step.run(`poll-vexa-transcript-${attempt}`, async () => {
        return await fetchVexaTranscript(platform, nativeMeetingId);
      });
      if (transcript.id !== undefined && transcript.id !== null) {
        vexaMeetingId = String(transcript.id);
      }
      const status = String(transcript.status ?? "");
      const segments = segmentsFromVexaTranscript(transcript);

      if (isVexaFailureStatus(status)) {
        throw new Error(vexaFailureMessage(platform, status));
      }

      if (segments.length && (segments.length !== latestSegmentCount || status !== latestStatus)) {
        sawTranscript = true;
        latestSegmentCount = segments.length;
        latestStatus = status;
        await step.run(`save-vexa-transcript-${attempt}`, async () => {
          return await runStep("record-vexa-transcript", {
            callSessionId,
            vexaStatus: status,
            segments
          });
        });
      }

      if (isVexaTerminalStatus(status)) {
        break;
      }

      await step.sleep(`wait-for-vexa-${attempt}`, attempt < 12 ? "5s" : "15s");
    }

    const shouldUseRecordingTranscript = platform === "teams";
    if (!sawTranscript && !shouldUseRecordingTranscript) {
      throw new Error("Vexa did not return transcript text for this meeting.");
    }

    if (!shouldUseRecordingTranscript) {
      await step.run("generate-vexa-meeting-notes", async () => {
        return await runStep("finalize-vexa-meeting", { callSessionId });
      });
    }

    let savedRecording: unknown = null;
    let recordingTranscriptSaved = false;
    if (vexaMeetingId) {
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const recording = await step.run(`poll-vexa-recording-${attempt}`, async () => {
          try {
            return await resolveVexaRecordingForMeeting(vexaMeetingId);
          } catch (error) {
            return {
              status: "error" as const,
              error: error instanceof Error ? error.message : "Vexa recording lookup failed."
            };
          }
        });

        if (recording.status === "ready") {
          savedRecording = await step.run("record-vexa-recording", async () => {
            try {
              return await runStep("record-vexa-recording", {
                callSessionId,
                vexaRecordingId: recording.recordingId,
                vexaMeetingId: recording.vexaMeetingId,
                vexaMediaFileId: recording.mediaFileId,
                status: "ready",
                format: recording.format,
                fileName: recording.fileName,
                mimeType: recording.mimeType,
                sizeBytes: recording.sizeBytes,
                recordingStartedAt: recording.recordingStartedAt,
                recordingEndedAt: recording.recordingEndedAt,
                durationMs: recording.durationMs
              });
            } catch (error) {
              return {
                ok: false,
                error: error instanceof Error ? error.message : "Vexa recording save failed."
              };
            }
          });

          if (shouldUseRecordingTranscript) {
            const upload = await step.run("upload-vexa-recording-to-assemblyai", async () => {
              return await uploadAssemblyAiAudioFromUrl(
                vexaRecordingRawUrl(recording.recordingId, recording.mediaFileId),
                { "X-API-Key": vexaApiKey() }
              );
            });
            const submitted = await step.run("submit-vexa-recording-assemblyai-transcript", async () => {
              return await submitAssemblyAiTranscript(upload.uploadUrl);
            });
            const transcriptId = String(submitted.id);
            let assemblyTranscript = submitted;
            for (let transcriptAttempt = 0; transcriptAttempt < 60; transcriptAttempt += 1) {
              assemblyTranscript = await step.run(`poll-vexa-recording-assemblyai-${transcriptAttempt}`, async () => {
                return await getAssemblyAiTranscript(transcriptId);
              });
              if (assemblyTranscript.status === "completed") {
                break;
              }
              if (assemblyTranscript.status === "error") {
                throw new Error(assemblyTranscript.error ?? "AssemblyAI could not transcribe the meeting recording.");
              }
              await step.sleep(`wait-vexa-recording-assemblyai-${transcriptAttempt}`, transcriptAttempt < 12 ? "5s" : "15s");
            }
            if (assemblyTranscript.status !== "completed") {
              throw new Error("AssemblyAI transcription timed out for the meeting recording.");
            }
            const recordingSegments = segmentsFromAssemblyAiTranscript(assemblyTranscript);
            if (!recordingSegments.length) {
              throw new Error("AssemblyAI did not return transcript text for the meeting recording.");
            }
            latestSegmentCount = recordingSegments.length;
            recordingTranscriptSaved = true;
            await step.run("save-vexa-recording-assemblyai-transcript", async () => {
              return await runStep("record-vexa-transcript", {
                callSessionId,
                provider: "assemblyai",
                assemblyAiTranscriptId: transcriptId,
                vexaStatus: "recording_transcribed",
                segments: recordingSegments
              });
            });
          }
          break;
        }

        if (attempt < 23) {
          await step.sleep(`wait-for-vexa-recording-${attempt}`, attempt < 6 ? "5s" : "15s");
        }
      }
    }

    if (shouldUseRecordingTranscript && !recordingTranscriptSaved && !sawTranscript) {
      throw new Error("Sidetone could not get a transcript from Vexa or the Teams recording.");
    }

    if (shouldUseRecordingTranscript) {
      await step.run("generate-vexa-meeting-notes", async () => {
        return await runStep("finalize-vexa-meeting", { callSessionId });
      });
    }

    return { callSessionId, segmentCount: latestSegmentCount, savedRecording };
  }
);

// ── External call webhook delivery (service integrations) ─────────

export const deliverExternalCallWebhook = inngest.createFunction(
  {
    id: "sidetone-deliver-external-call-webhook",
    triggers: { event: "sidetone/external-call.completed" },
    concurrency: 3,
    retries: 4
  },
  async ({ event, step }) => {
    const callSessionId = String(event.data.callSessionId ?? "");
    if (!callSessionId) return { delivered: false, reason: "missing_call_session" };
    const serviceToken = process.env.SIDETONE_SERVICE_TOKEN?.trim();
    const webhookSecret = process.env.SIDETONE_OUTBOUND_WEBHOOK_SECRET?.trim();
    if (!serviceToken || !webhookSecret) {
      return { delivered: false, reason: "service_env_missing" };
    }

    const { fetchQuery, fetchMutation, fetchAction } = await import("convex/nextjs");
    const { api } = await import("../../convex/_generated/api");

    // Non-fatal: mint the shared call page link so the external system can
    // deep-link to the recording, notes, and transcript.
    await step.run("ensure-call-share", async () => {
      try {
        return await fetchMutation(api.calls.ensureExternalCallShare, {
          serviceToken,
          callSessionId: callSessionId as never
        });
      } catch (error) {
        console.warn("Unable to ensure shared call link; delivering without it.", error);
        return null;
      }
    });

    // Expensive LLM step: distill the full call history for this external
    // record into next-call advice before building the webhook payload, so the
    // payload's artifact carries it. Failure is non-fatal — deliver without it.
    await step.run("generate-next-call-advice", async () => {
      try {
        return await fetchAction(api.calls.generateNextCallAdviceForExternalCall, {
          serviceToken,
          callSessionId: callSessionId as never
        });
      } catch (error) {
        console.warn("Next-call advice generation failed; delivering without it.", error);
        return { advice: null };
      }
    });

    const payload = await step.run("load-delivery-payload", async () => {
      return await fetchQuery(api.calls.getExternalCallDeliveryPayload, {
        serviceToken,
        callSessionId: callSessionId as never
      });
    });
    if (!payload) return { delivered: false, reason: "no_external_integration" };

    const result = await step.run("post-webhook", async () => {
      const { createHmac } = await import("node:crypto");
      const body = JSON.stringify({
        callSessionId,
        externalRef: {
          source: payload.externalIntegration.source,
          externalId: payload.externalIntegration.externalId,
          metadata: payload.externalIntegration.metadata
        },
        status: payload.status,
        startedAt: payload.startedAt,
        endedAt: payload.endedAt,
        durationSecs: payload.durationSecs,
        failureReason: payload.failureReason,
        recordingUrl: payload.recordingUrl,
        callUrl: payload.callUrl,
        transcript: payload.transcript,
        artifact: payload.artifact
      });
      const timestamp = String(Date.now());
      const signature = createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`).digest("hex");
      const response = await fetch(payload.externalIntegration.callbackUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sidetone-timestamp": timestamp,
          "x-sidetone-signature": signature
        },
        body,
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) {
        throw new Error(`External webhook delivery failed (${response.status}).`);
      }
      return { status: response.status };
    });

    await step.run("mark-delivered", async () => {
      await fetchMutation(api.calls.markExternalCallDelivered, {
        serviceToken,
        callSessionId: callSessionId as never,
        deliveryStatus: "delivered"
      });
    });

    return { delivered: true, status: result.status };
  }
);

// Safety net: requeue ended external calls whose webhook delivery never
// happened (dropped event, failed run, app not yet synced at call time).
export const sweepPendingExternalCallDeliveries = inngest.createFunction(
  {
    id: "sidetone-external-delivery-sweeper",
    triggers: { cron: "*/15 * * * *" },
    retries: 1
  },
  async ({ step }) => {
    const serviceToken = process.env.SIDETONE_SERVICE_TOKEN?.trim();
    if (!serviceToken) return { queued: 0, reason: "service_env_missing" };

    const { fetchQuery } = await import("convex/nextjs");
    const { api } = await import("../../convex/_generated/api");

    const pending = (await step.run("load-pending-deliveries", async () => {
      return await fetchQuery(api.calls.listPendingExternalDeliveries, { serviceToken });
    })) as Array<{ callSessionId: string }>;
    if (!pending.length) return { queued: 0 };

    await step.sendEvent(
      "requeue-pending-deliveries",
      pending.map((item) => ({
        name: "sidetone/external-call.completed",
        data: { callSessionId: item.callSessionId, source: "delivery_sweeper" }
      }))
    );
    return { queued: pending.length };
  }
);

export const functions = [
  callIntelligenceRun,
  liveCardSupervisor,
  liveCardSpecialist,
  billingLiveCallMonitor,
  uploadedRecordingProcessing,
  vexaMeetingProcessing,
  deliverExternalCallWebhook,
  sweepPendingExternalCallDeliveries
];
