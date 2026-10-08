import { readTranscript, normalizeSegments, MAX_TRANSCRIPT_SEGMENTS } from "./transcriptLimits";
import { requireWorkerToken, requireFeature } from "./deployment";
import { v } from "convex/values";
import {
  buildSidetonePromptContext,
  coachLensPromptFor,
  industryProfileFor,
  normalizeIndustryProfileId,
  normalizeTuningMode
} from "@sidetone/contracts";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
import { requireAuthenticatedIdentity, requireOwnedEntity } from "./auth";

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

const vexaMeetingPlatform = v.union(
  v.literal("google_meet"),
  v.literal("teams"),
  v.literal("zoom")
);

const REQUIRED_ZOOM_RTMS_START_SCOPE = "meeting:update:participant_rtms_app_status";
const ZOOM_RTMS_START_SCOPE_ALIASES = new Set([
  REQUIRED_ZOOM_RTMS_START_SCOPE,
  `${REQUIRED_ZOOM_RTMS_START_SCOPE}:admin`,
  "meeting:write",
  "meeting:write:admin"
]);

function now() {
  return Date.now();
}

function isPhoneCallMode(mode: string) {
  return mode === "conference_in" || mode === "call_through" || mode === "sidetone_session";
}

function isStoredRecordingMode(mode: string) {
  return mode === "uploaded_recording" || mode === "discord_voice";
}

function vexaPlatformLabel(platform: string) {
  if (platform === "google_meet") return "Google Meet";
  if (platform === "teams") return "Microsoft Teams";
  if (platform === "zoom") return "Zoom";
  return "Meeting";
}

function cleanText(value?: string | null, maxLength = 240) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function hasZoomRtmsStartScope(scopes?: string[]) {
  return (scopes ?? []).some((scope) => ZOOM_RTMS_START_SCOPE_ALIASES.has(scope));
}

function normalizeLookup(value?: string | null) {
  return cleanText(value, 240)?.toLowerCase();
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
  entity: { ownerPhoneNumber?: string } | null,
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

function identityPhone(
  phoneNumber: string | undefined,
  entity: { ownerPhoneNumber?: string } | null,
  numberAssignment: { e164?: string; phoneNumber?: string } | null
) {
  return phoneNumber && !isInfrastructurePhone(phoneNumber, entity, numberAssignment)
    ? phoneNumber
    : undefined;
}

function callLegIdentityPhone(
  phoneNumber: string | undefined,
  callMode: string,
  entity: { ownerPhoneNumber?: string } | null,
  numberAssignment: { e164?: string; phoneNumber?: string } | null
) {
  return callMode === "call_through"
    ? identityPhone(phoneNumber, entity, numberAssignment)
    : undefined;
}

function configuredCallerPhoneForSummary(input: {
  callSession?: { mode?: string; externalIntegration?: { metadata?: any } | null } | null;
  ownerLeg?: { phoneNumber?: string } | null;
  entity?: { ownerPhoneNumber?: string } | null;
}) {
  const requestedOperatorPhone = typeof input.callSession?.externalIntegration?.metadata?.operatorPhoneNumber === "string"
    ? input.callSession.externalIntegration.metadata.operatorPhoneNumber.trim()
    : "";

  if (input.callSession?.mode === "call_through") {
    return requestedOperatorPhone || input.ownerLeg?.phoneNumber || input.entity?.ownerPhoneNumber;
  }

  return input.entity?.ownerPhoneNumber || input.ownerLeg?.phoneNumber || requestedOperatorPhone || undefined;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitSentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function uniqueFirst(items: string[], maxItems: number) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = item.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(item);
    }
    if (result.length >= maxItems) {
      break;
    }
  }
  return result;
}

function artifactTitleFromText(text?: string) {
  const words = (text ?? "")
    .replace(/[^a-zA-Z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 1)
    .slice(0, 3);

  if (!words.length) {
    return "Call Notes";
  }

  return words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function normalizeArtifactTitle(title: string | undefined, fallbackText?: string) {
  const words = (title ?? "")
    .replace(/[^a-zA-Z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 3);

  if (!words.length) {
    return artifactTitleFromText(fallbackText);
  }

  return words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function normalizeCallBasis(input?: string, fallbackText?: string) {
  const source = input?.trim() ? input : fallbackText;
  const words = (source ?? "")
    .replace(/[^a-zA-Z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 10);

  if (!words.length) {
    return "Captured call notes and next steps.";
  }

  return words.join(" ");
}

function buildDeterministicCallArtifact(transcript: string) {
  const sentences = splitSentences(transcript);
  if (!sentences.length) {
    return {
      title: "Audio Check",
      callBasis: "No conversation audio was captured.",
      summary: "Sidetone did not capture enough audio to summarize this call yet.",
      decisions: [],
      actionItems: ["Review the call record once transcript audio is available."],
      risks: [],
      followUpDraft: "Thanks for the call. I will follow up with the useful notes and next steps shortly.",
      crmNoteDraft: "Sidetone call record: transcript was not available when notes were generated."
    };
  }

  const actionKeywords = /\b(send|follow up|confirm|schedule|reschedule|order|update|call|email|text|share|review|collect)\b/i;
  const decisionKeywords = /\b(agreed|decided|confirmed|will|moving|moved|deadline|next step|plan)\b/i;
  const riskKeywords = /\b(concern|blocker|issue|problem|worried|delay|risk|can't|cannot|missing)\b/i;

  const actionItems = uniqueFirst(
    sentences
      .filter((sentence) => actionKeywords.test(sentence))
      .map((sentence) => sentence.replace(/^we need to\s+/i, "").replace(/^let'?s\s+/i, "")),
    5
  );
  const decisions = uniqueFirst(sentences.filter((sentence) => decisionKeywords.test(sentence)), 4);
  const risks = uniqueFirst(sentences.filter((sentence) => riskKeywords.test(sentence)), 4);
  const usefulLead = sentences.slice(0, Math.min(3, sentences.length)).join(" ");

  return {
    title: artifactTitleFromText(usefulLead),
    callBasis: normalizeCallBasis(undefined, usefulLead),
    summary:
      usefulLead.length > 280
        ? `${usefulLead.slice(0, 277).trim()}...`
        : usefulLead,
    decisions,
    actionItems: actionItems.length ? actionItems : ["Review the notes and send one clear follow-up."],
    risks,
    followUpDraft: `Thanks for the call. Here is what I captured: ${usefulLead}`,
    crmNoteDraft: [
      "Sidetone call notes",
      "",
      `Summary: ${usefulLead}`,
      "",
      actionItems.length ? `Action items: ${actionItems.join("; ")}` : "Action items: Review notes and follow up.",
      decisions.length ? `Decisions: ${decisions.join("; ")}` : null,
      risks.length ? `Risks or concerns: ${risks.join("; ")}` : null
    ]
      .filter(Boolean)
      .join("\n")
  };
}

const generatedArtifact = v.object({
  title: v.optional(v.string()),
  callBasis: v.optional(v.string()),
  summary: v.string(),
  decisions: v.array(v.string()),
  actionItems: v.array(v.string()),
  risks: v.array(v.string()),
  followUpDraft: v.optional(v.string()),
  crmNoteDraft: v.optional(v.string())
});

const labModelProvider = v.union(v.literal("openai"), v.literal("anthropic"), v.literal("gemini"));

const artifactSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    callBasis: { type: "string" },
    summary: { type: "string" },
    decisions: { type: "array", items: { type: "string" } },
    actionItems: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    followUpDraft: { type: "string" },
    crmNoteDraft: { type: "string" }
  },
  required: ["title", "callBasis", "summary", "decisions", "actionItems", "risks", "followUpDraft", "crmNoteDraft"]
};

const DEFAULT_POST_CALL_MODEL = "gpt-5.4-mini";
const NOTES_UNAVAILABLE_SUMMARY =
  "Sidetone could not generate notes for this call. The transcript and recording are still available.";

class PostCallGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostCallGenerationError";
  }
}

function readOutputText(response: any) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const chunks = response.output
    ?.flatMap((item: any) => item.content ?? [])
    ?.map((content: any) => content.text)
    ?.filter(Boolean);
  return chunks?.join("\n") ?? "";
}

function isMissingModelError(detail: string) {
  return detail.includes("model_not_found") || detail.includes("does not exist");
}

function allowDeterministicPostCallFallback() {
  return process.env.SIDETONE_ALLOW_DETERMINISTIC_POST_CALL_FALLBACK?.trim() === "true";
}

function openAiFailureMessage(status: number, detail: string) {
  if (!detail.trim()) {
    return `OpenAI post-call generation failed (${status}).`;
  }

  try {
    const parsed = JSON.parse(detail);
    const message = parsed?.error?.message;
    if (typeof message === "string" && message.trim()) {
      return `OpenAI post-call generation failed (${status}): ${message.trim()}`;
    }
  } catch {
    // Use the raw response below.
  }

  return `OpenAI post-call generation failed (${status}): ${detail.slice(0, 500)}`;
}

async function generateArtifactWithOpenAI(input: {
  transcript: string;
  coachMode?: string;
  industryProfile?: string;
  callFocusText?: string;
  startedAt?: number;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    if (allowDeterministicPostCallFallback()) {
      return { artifact: buildDeterministicCallArtifact(input.transcript), modelName: "sidetone-deterministic" };
    }
    throw new PostCallGenerationError("OPENAI_API_KEY is not configured for post-call note generation.");
  }

  const configuredModelName = process.env.SIDETONE_POST_CALL_MODEL?.trim();
  const modelNames = Array.from(
    new Set([configuredModelName, DEFAULT_POST_CALL_MODEL].filter((modelName): modelName is string => Boolean(modelName)))
  );
  let lastStatus = 0;
  let lastDetail = "";
  const normalizedIndustryProfile = normalizeIndustryProfileId(input.industryProfile);
  const normalizedCoachMode = normalizeTuningMode(input.coachMode);
  const profile = industryProfileFor(normalizedIndustryProfile);
  const lens = normalizedCoachMode ? coachLensPromptFor(normalizedCoachMode) : undefined;
  const promptContext = buildSidetonePromptContext({
    industryProfile: normalizedIndustryProfile,
    coachMode: normalizedCoachMode
  });

  for (const modelName of modelNames) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelName,
        input: [
          {
            role: "system",
            content: [
              "You are Sidetone, a private phone-call scribe.",
              "Turn raw phone transcripts into a clean call record, not a transcript excerpt.",
              normalizedCoachMode
                ? "Use the selected industry profile as the domain lens and the selected live coaching style as the behavioral lens."
                : "Use the selected industry profile as the domain lens.",
              promptContext,
              "Ignore recording disclosures, product-testing chatter, repeated filler, and false starts unless they are the actual purpose of the call.",
              "Never invent names, dates, amounts, commitments, or owners.",
              "Action items must be real next steps from the call. Do not include disclosure statements or generic review tasks.",
              "Call basis must be a short sentence fragment of 10 words or fewer that explains what the call was about. It is dashboard subtext, not the call title.",
              input.callFocusText
                ? "The user's Listen For instruction narrows attention for this call but does not replace the industry profile."
                : "",
              "For legal, insurance, financial-services, or healthcare-sensitive calls, capture facts and follow-up only; do not give legal, clinical, financial, insurance, or coverage advice.",
              "If the call was mostly a product test, say that plainly and capture only the concrete next steps.",
              "Return title as a short 3-word noun phrase that summarizes the call, such as Schedule Follow-Up or Closing Repair Details."
            ].join(" ")
          },
          {
            role: "user",
            content: [
              "Create the post-call record.",
              `Industry profile: ${profile.label}`,
              lens ? `Live coaching style: ${lens.label}` : "",
              input.callFocusText ? `Listen For: ${input.callFocusText}` : "",
              input.startedAt ? `Started at: ${new Date(input.startedAt).toISOString()}` : "",
              "",
              "Transcript:",
              input.transcript
            ].join("\n")
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "sidetone_call_artifact",
            strict: true,
            schema: artifactSchema
          }
        }
      })
    });

    if (response.ok) {
      const body = await response.json();
      return {
        artifact: JSON.parse(readOutputText(body)) as {
          title?: string;
          summary: string;
          decisions: string[];
          actionItems: string[];
          risks: string[];
          followUpDraft?: string;
          crmNoteDraft?: string;
        },
        modelName
      };
    }

    lastStatus = response.status;
    lastDetail = await response.text().catch(() => "");
    if (!isMissingModelError(lastDetail)) {
      break;
    }
  }

  const message = openAiFailureMessage(lastStatus, lastDetail);
  console.warn("OpenAI post-call generation failed.", lastStatus, lastDetail.slice(0, 500));
  if (allowDeterministicPostCallFallback()) {
    return { artifact: buildDeterministicCallArtifact(input.transcript), modelName: "sidetone-deterministic" };
  }
  throw new PostCallGenerationError(message);
}

async function generateNextCallAdviceWithOpenAI(history: {
  source: string;
  metadata?: unknown;
  calls: Array<{
    isCurrent: boolean;
    startedAt?: number;
    endedAt?: number;
    status: string;
    failureReason?: string;
    callFocusText?: string;
    artifact: {
      title?: string;
      summary?: string;
      decisions: string[];
      actionItems: string[];
      risks: string[];
    } | null;
  }>;
  transcript?: string;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const modelNames = Array.from(
    new Set(
      [
        process.env.SIDETONE_NEXT_CALL_ADVICE_MODEL?.trim(),
        process.env.SIDETONE_POST_CALL_MODEL?.trim(),
        DEFAULT_POST_CALL_MODEL
      ].filter((modelName): modelName is string => Boolean(modelName))
    )
  );

  const chronological = [...history.calls].reverse();
  const callBlocks = chronological.map((call, index) => {
    const when = call.endedAt ?? call.startedAt;
    const lines = [
      `Call ${index + 1}${call.isCurrent ? " (just ended)" : ""} — ${when ? new Date(when).toISOString() : "date unknown"} — status: ${call.status}${call.failureReason ? ` (${call.failureReason})` : ""}`
    ];
    if (call.callFocusText) lines.push(`Goal: ${call.callFocusText}`);
    if (call.artifact?.summary) lines.push(`Summary: ${call.artifact.summary}`);
    if (call.artifact?.decisions?.length) lines.push(`Decisions: ${call.artifact.decisions.join("; ")}`);
    if (call.artifact?.actionItems?.length) lines.push(`Action items: ${call.artifact.actionItems.join("; ")}`);
    if (call.artifact?.risks?.length) lines.push(`Risks: ${call.artifact.risks.join("; ")}`);
    return lines.join("\n");
  });

  const metadataText = history.metadata ? JSON.stringify(history.metadata).slice(0, 600) : "";

  for (const modelName of modelNames) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelName,
        input: [
          {
            role: "system",
            content: [
              "You are Sidetone, advising a salesperson before their next call to this prospect.",
              "You are given every prior call with this prospect (oldest first) and the transcript of the most recent one.",
              "Write next-call advice for the salesperson: the single best objective for the next call, commitments either side made that must be honored first, objections or hesitations heard so far, and suggested timing.",
              "Be concrete and grounded only in what was actually said. Never invent names, dates, amounts, or commitments.",
              "If commitments are unfulfilled (e.g. an email that was promised), the advice must lead with fulfilling them before calling again.",
              "Output 3 to 5 short bullet lines, each starting with '- ', no headers, 110 words maximum total."
            ].join(" ")
          },
          {
            role: "user",
            content: [
              metadataText ? `Prospect context: ${metadataText}` : "",
              "",
              "Call history:",
              callBlocks.join("\n\n"),
              "",
              history.transcript ? `Transcript of the most recent call:\n${history.transcript}` : ""
            ].join("\n")
          }
        ]
      })
    });

    if (response.ok) {
      const body = await response.json();
      const advice = readOutputText(body).trim();
      return advice ? advice.slice(0, 2_000) : null;
    }

    const detail = await response.text().catch(() => "");
    console.warn("Next-call advice generation failed.", response.status, detail.slice(0, 300));
    if (!isMissingModelError(detail)) {
      return null;
    }
  }

  return null;
}

function compactSmsText(text: string, maxLength: number) {
  const compacted = text.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) {
    return compacted;
  }
  return `${compacted.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function sidetonePublicBaseUrl() {
  return (process.env.SIDETONE_PUBLIC_BASE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}

function makeShareToken() {
  const bytes = new Uint8Array(24);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeUploadedFileName(input?: string | null) {
  return cleanText(input, 160)?.replace(/[^\w.\-() ]+/g, "").trim() || "recording";
}

function audioFormatFromMime(input?: string | null) {
  const mime = input?.toLowerCase() ?? "";
  if (mime.includes("wav") || mime.includes("wave")) {
    return "wav" as const;
  }
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) {
    return "m4a" as const;
  }
  if (mime.includes("webm")) {
    return "webm" as const;
  }
  if (mime.includes("ogg") || mime.includes("oga")) {
    return "ogg" as const;
  }
  if (mime.includes("mpeg") || mime.includes("mp3")) {
    return "mp3" as const;
  }
  return undefined;
}

async function ensureOwnerWorkspace(ctx: any, input: {
  ownerTokenIdentifier: string;
  timestamp: number;
}) {
  const existing = await ctx.db
    .query("entityProfiles")
    .withIndex("by_owner", (q: any) => q.eq("ownerTokenIdentifier", input.ownerTokenIdentifier))
    .order("desc")
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

async function upsertExternalEntityForCall(ctx: any, input: {
  workspaceEntityId: any;
  ownerTokenIdentifier: string;
  callSessionId: any;
  name?: string | null;
  timestamp: number;
}) {
  const name = cleanText(input.name);
  const normalizedName = normalizeLookup(name);
  if (!name || !normalizedName) {
    return null;
  }

  const existingExternalEntity = await ctx.db
    .query("externalEntities")
    .withIndex("by_workspace_name", (q: any) => q.eq("entityId", input.workspaceEntityId).eq("normalizedName", normalizedName))
    .first();
  const externalEntityId = existingExternalEntity?._id ?? await ctx.db.insert("externalEntities", {
    entityId: input.workspaceEntityId,
    ownerTokenIdentifier: input.ownerTokenIdentifier,
    name,
    normalizedName,
    type: "client",
    lastInteractionAt: input.timestamp,
    createdAt: input.timestamp,
    updatedAt: input.timestamp
  });

  if (existingExternalEntity) {
    await ctx.db.patch(existingExternalEntity._id, {
      name,
      lastInteractionAt: input.timestamp,
      updatedAt: input.timestamp
    });
  }

  const existingParticipant = await ctx.db
    .query("callParticipants")
    .withIndex("by_call_role", (q: any) => q.eq("callSessionId", input.callSessionId).eq("role", "primary"))
    .first();
  const participantPatch = {
    entityId: input.workspaceEntityId,
    ownerTokenIdentifier: input.ownerTokenIdentifier,
    externalEntityId,
    externalEntityNameSnapshot: name,
    updatedAt: input.timestamp
  };

  if (existingParticipant) {
    await ctx.db.patch(existingParticipant._id, participantPatch);
  } else {
    await ctx.db.insert("callParticipants", {
      callSessionId: input.callSessionId,
      role: "primary",
      createdAt: input.timestamp,
      ...participantPatch
    });
  }

  await ctx.db.patch(input.callSessionId, {
    primaryExternalEntityId: externalEntityId,
    updatedAt: input.timestamp
  });

  return externalEntityId;
}

function ownerSummarySmsFromNumber() {
  return process.env.SIDETONE_OWNER_SUMMARY_SMS_FROM_NUMBER?.trim()
    || process.env.TELNYX_OWNER_SUMMARY_SMS_FROM_NUMBER?.trim()
    || process.env.TELNYX_SMS_FROM_NUMBER?.trim();
}

function buildOwnerSummarySms(input: {
  shareUrl: string;
  artifact: {
    summary: string;
    actionItems: string[];
  };
}) {
  const lines = [
    "Sidetone notes:",
    compactSmsText(input.artifact.summary, 260)
  ];

  const actionItems = input.artifact.actionItems
    .map((item) => compactSmsText(item, 80))
    .filter(Boolean)
    .slice(0, 2);

  if (actionItems.length) {
    lines.push("", "Next:");
    for (const item of actionItems) {
      lines.push(`- ${item}`);
    }
  }

  lines.push("", `Share: ${input.shareUrl}`);
  const smsText = lines.join("\n");
  if (smsText.length <= 620) {
    return smsText;
  }

  const fixedText = `Sidetone notes:\n\nShare: ${input.shareUrl}`;
  const summaryBudget = Math.max(120, 620 - fixedText.length - 2);
  return [
    "Sidetone notes:",
    compactSmsText(input.artifact.summary, summaryBudget),
    "",
    `Share: ${input.shareUrl}`
  ].join("\n");
}

function transcriptTextIsMeaningful(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized.length < 12) {
    return false;
  }

  return !/this call is being recorded and transcribed by (sidetone|scitone|cytone)|welcome to sidetone|tap add call|merge calls|start taking notes/i.test(normalized);
}

function buildMergeReminderSms(input: {
  callSessionId: string;
  reason?: string;
}) {
  const lead = input.reason === "call_hold"
    ? "Your Sidetone call leg still appears to be on hold."
    : "Sidetone is connected, but it is not hearing the conversation yet.";

  return [
    "Sidetone reminder:",
    lead,
    input.reason === "call_hold"
      ? "Return to the Sidetone call and tap Merge Calls so Sidetone can hear the active conversation."
      : "If you're on another phone call, tap Merge Calls. If Sidetone is on hold or muted, return it to the active call.",
    "",
    `Open: ${sidetonePublicBaseUrl()}/calls/live/${input.callSessionId}`
  ].join("\n");
}

async function sendTelnyxSms(input: {
  fromPhoneNumber: string;
  toPhoneNumber: string;
  text: string;
  messagingProfileId?: string;
}) {
  const apiKey = process.env.SIDETONE_SMS_ENABLED === "true" ? process.env.TELNYX_API_KEY?.trim() : undefined;
  if (!apiKey) {
    return {
      status: "skipped" as const,
      error: "TELNYX_API_KEY is not configured in Convex."
    };
  }

  const messagingProfileId = input.messagingProfileId?.trim() || process.env.TELNYX_MESSAGING_PROFILE_ID?.trim();
  const body: Record<string, string> = {
    from: input.fromPhoneNumber,
    to: input.toPhoneNumber,
    text: input.text
  };

  if (messagingProfileId) {
    body.messaging_profile_id = messagingProfileId;
  }

  const response = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const responseBody = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Telnyx SMS failed (${response.status}): ${responseBody.slice(0, 500)}`);
  }

  const parsed = responseBody
    ? await Promise.resolve()
      .then(() => JSON.parse(responseBody))
      .catch(() => ({}))
    : {};
  return {
    status: "sent" as const,
    providerMessageId: parsed?.data?.id ?? parsed?.id
  };
}

async function attachTelnyxNumberToMessagingProfile(input: {
  telnyxPhoneNumberId: string;
  messagingProfileId: string;
}) {
  const apiKey = process.env.TELNYX_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("TELNYX_API_KEY is not configured in Convex.");
  }

  const response = await fetch(`https://api.telnyx.com/v2/phone_numbers/${input.telnyxPhoneNumberId}/messaging`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_profile_id: input.messagingProfileId
    })
  });

  const responseBody = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Telnyx messaging profile attach failed (${response.status}): ${responseBody.slice(0, 500)}`);
  }
}

export const createCallThroughSession = mutation({
  args: {
    entityId: v.id("entityProfiles"),
    toPhoneNumber: v.string(),
    fromPhoneNumber: v.string(),
    ownerPhoneNumber: v.string(),
    contactName: v.optional(v.string()),
    industryProfile: v.optional(industryProfile),
    coachMode: v.optional(v.union(coachMode, v.null())),
    callFocusText: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    requireFeature("phone");
    const entity = await requireOwnedEntity(ctx, args.entityId);
    const identity = await requireAuthenticatedIdentity(ctx);
    const timestamp = now();

    await ctx.db.patch(entity._id, {
      ownerPhoneNumber: args.ownerPhoneNumber,
      defaultIndustryProfile: args.industryProfile ?? entity.defaultIndustryProfile ?? "general",
      defaultCoachMode: args.coachMode ?? undefined,
      updatedAt: timestamp
    });

    const contactId = await ctx.db.insert("contacts", {
      entityId: entity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      displayName: args.contactName?.trim() || undefined,
      normalizedDisplayName: args.contactName?.trim().toLowerCase() || undefined,
      phoneNumber: args.toPhoneNumber,
      lastInteractionAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const callSessionId = await ctx.db.insert("callSessions", {
      entityId: entity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      mode: "call_through",
      status: "connecting",
      industryProfile: args.industryProfile ?? entity.defaultIndustryProfile ?? "general",
      ...(args.coachMode ? { coachMode: args.coachMode } : {}),
      callFocusText: args.callFocusText?.trim() || undefined,
      callFocusInputMethod: args.callFocusText?.trim() ? "typed" : undefined,
      consentMode: entity.defaultConsentMode,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("callParticipants", {
      callSessionId,
      entityId: entity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      contactId,
      role: "primary",
      displayNameSnapshot: args.contactName?.trim() || undefined,
      phoneNumberSnapshot: args.toPhoneNumber,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("callLegs", {
      callSessionId,
      entityId: entity._id,
      role: "owner",
      phoneNumber: args.ownerPhoneNumber,
      status: "ringing",
      startedAt: timestamp
    });

    await ctx.db.insert("callLegs", {
      callSessionId,
      entityId: entity._id,
      role: "external",
      phoneNumber: args.toPhoneNumber,
      status: "ringing",
      startedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: entity._id,
      callSessionId,
      actor: "owner",
      type: "call_through.requested",
      message: `Outbound call requested to ${args.toPhoneNumber}.`,
      metadata: {
        contactId,
        fromPhoneNumber: args.fromPhoneNumber
      },
      createdAt: timestamp
    });

    return { callSessionId };
  }
});

function requireServiceToken(provided: string) {
  const expected = process.env.SIDETONE_SERVICE_TOKEN?.trim();
  if (!expected) {
    throw new Error("SIDETONE_SERVICE_TOKEN is not configured in Convex.");
  }
  if (provided.length !== expected.length) {
    throw new Error("Invalid service token.");
  }
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch !== 0) {
    throw new Error("Invalid service token.");
  }
}

export const createServiceCallThroughSession = mutation({
  args: {
    serviceToken: v.string(),
    toPhoneNumber: v.string(),
    contactName: v.optional(v.string()),
    callFocusText: v.optional(v.string()),
    // Which sales agent's cell rings first; falls back to the pinned
    // operator entity's owner phone.
    operatorPhoneNumber: v.optional(v.string()),
    externalSource: v.string(),
    externalId: v.string(),
    callbackUrl: v.string(),
    externalMetadata: v.optional(v.any())
  },
  handler: async (ctx, args) => {
    requireFeature("phone");
    requireServiceToken(args.serviceToken);
    const entityId = process.env.SIDETONE_SERVICE_ENTITY_ID?.trim();
    if (!entityId) {
      throw new Error("SIDETONE_SERVICE_ENTITY_ID is not configured in Convex.");
    }
    const entity = await ctx.db.get(entityId as Id<"entityProfiles">);
    if (!entity) {
      throw new Error("Service operator entity not found.");
    }
    const assignment = await ctx.db
      .query("phoneNumberAssignments")
      .withIndex("by_entity_status", (q) => q.eq("entityId", entity._id).eq("status", "active"))
      .first();
    const fromPhoneNumber = assignment?.e164 ?? assignment?.phoneNumber;
    if (!fromPhoneNumber) {
      throw new Error("Service operator entity has no active Sidetone number.");
    }
    const ownerPhoneNumber = args.operatorPhoneNumber?.trim() || entity.ownerPhoneNumber;
    if (!ownerPhoneNumber) {
      throw new Error("Service operator entity has no owner phone number on file.");
    }
    const timestamp = now();

    const contactId = await ctx.db.insert("contacts", {
      entityId: entity._id,
      ownerTokenIdentifier: entity.ownerTokenIdentifier,
      displayName: args.contactName?.trim() || undefined,
      normalizedDisplayName: args.contactName?.trim().toLowerCase() || undefined,
      phoneNumber: args.toPhoneNumber,
      lastInteractionAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const callSessionId = await ctx.db.insert("callSessions", {
      entityId: entity._id,
      ownerTokenIdentifier: entity.ownerTokenIdentifier,
      mode: "call_through",
      status: "connecting",
      industryProfile: entity.defaultIndustryProfile ?? "general",
      callFocusText: args.callFocusText?.trim() || undefined,
      callFocusInputMethod: args.callFocusText?.trim() ? "typed" : undefined,
      consentMode: entity.defaultConsentMode,
      externalIntegration: {
        source: args.externalSource,
        externalId: args.externalId,
        callbackUrl: args.callbackUrl,
        metadata: {
          ...(args.externalMetadata && typeof args.externalMetadata === "object" ? args.externalMetadata : {}),
          operatorPhoneNumber: ownerPhoneNumber
        },
        deliveryStatus: "pending"
      },
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("callParticipants", {
      callSessionId,
      entityId: entity._id,
      ownerTokenIdentifier: entity.ownerTokenIdentifier,
      contactId,
      role: "primary",
      displayNameSnapshot: args.contactName?.trim() || undefined,
      phoneNumberSnapshot: args.toPhoneNumber,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("callLegs", {
      callSessionId,
      entityId: entity._id,
      role: "owner",
      phoneNumber: ownerPhoneNumber,
      status: "ringing",
      startedAt: timestamp
    });

    await ctx.db.insert("callLegs", {
      callSessionId,
      entityId: entity._id,
      role: "external",
      phoneNumber: args.toPhoneNumber,
      status: "ringing",
      startedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: entity._id,
      callSessionId,
      actor: "system",
      type: "call_through.requested",
      message: `Service outbound call requested to ${args.toPhoneNumber} for ${args.externalSource}.`,
      metadata: {
        contactId,
        fromPhoneNumber,
        ownerPhoneNumber,
        operatorPhoneOverrideUsed: Boolean(args.operatorPhoneNumber?.trim()),
        externalSource: args.externalSource,
        externalId: args.externalId
      },
      createdAt: timestamp
    });

    return { callSessionId, fromPhoneNumber, ownerPhoneNumber };
  }
});

export const getExternalCallDeliveryPayload = query({
  args: {
    serviceToken: v.string(),
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const session = await ctx.db.get(args.callSessionId);
    if (!session?.externalIntegration) return null;
    const artifact = await ctx.db
      .query("callArtifacts")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    const recording = await ctx.db
      .query("callRecordings")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .order("desc")
      .first();
    const segments = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_call_session_time", (q) => q.eq("callSessionId", args.callSessionId))
      .take(500);
    const transcript = segments
      .filter((segment) => segment.isFinal)
      .map((segment) => `${segment.speakerLabel ?? segment.speakerTrack}: ${segment.text}`)
      .join("\n")
      .slice(0, 100_000);
    return {
      externalIntegration: session.externalIntegration,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      failureReason: session.failureReason,
      durationSecs:
        session.startedAt && session.endedAt
          ? Math.max(0, Math.round((session.endedAt - session.startedAt) / 1000))
          : undefined,
      recordingUrl:
        recording?.publicRecordingUrls?.mp3 ??
        recording?.recordingUrls?.mp3 ??
        recording?.publicRecordingUrls?.wav ??
        recording?.recordingUrls?.wav,
      recordingStatus: recording?.status,
      transcript: transcript || undefined,
      callUrl:
        session.publicShareEnabled && session.publicShareToken
          ? `${sidetonePublicBaseUrl()}/shared/calls/${session.publicShareToken}`
          : undefined,
      artifact: artifact
        ? {
            title: artifact.title,
            summary: artifact.summary,
            actionItems: artifact.actionItems,
            decisions: artifact.decisions,
            risks: artifact.risks,
            followUpDraft: artifact.followUpDraft,
            nextCallAdvice: artifact.nextCallAdvice,
            status: artifact.status
          }
        : null
    };
  }
});

// Guarantees the shared call page exists before webhook delivery, so the
// external system can link back to the recording, notes, and transcript.
export const ensureExternalCallShare = mutation({
  args: {
    serviceToken: v.string(),
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args): Promise<{ callUrl: string } | null> => {
    requireServiceToken(args.serviceToken);
    const session = await ctx.db.get(args.callSessionId);
    if (!session?.externalIntegration) return null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result: { shareToken?: string } | null = await ctx.runMutation(internal.calls.ensureCallShareForSms, {
        callSessionId: args.callSessionId,
        shareToken: makeShareToken()
      });
      if (result?.shareToken) {
        return { callUrl: `${sidetonePublicBaseUrl()}/shared/calls/${result.shareToken}` };
      }
    }
    return null;
  }
});

export const markExternalCallDelivered = mutation({
  args: {
    serviceToken: v.string(),
    callSessionId: v.id("callSessions"),
    deliveryStatus: v.union(v.literal("delivered"), v.literal("failed"))
  },
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const session = await ctx.db.get(args.callSessionId);
    if (!session?.externalIntegration) return null;
    await ctx.db.patch(args.callSessionId, {
      externalIntegration: {
        ...session.externalIntegration,
        deliveryStatus: args.deliveryStatus,
        deliveredAt: args.deliveryStatus === "delivered" ? now() : session.externalIntegration.deliveredAt
      },
      updatedAt: now()
    });
    return args.callSessionId;
  }
});

// Ended external-integration calls whose webhook was never delivered (e.g. the
// Inngest event was dropped). Swept periodically so deliveries self-heal.
export const listPendingExternalDeliveries = query({
  args: { serviceToken: v.string() },
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const timestamp = now();
    const settleCutoff = timestamp - 5 * 60 * 1000;
    const staleCutoff = timestamp - 7 * 24 * 60 * 60 * 1000;
    const recent = await ctx.db.query("callSessions").order("desc").take(200);
    return recent
      .filter(
        (session) =>
          session.externalIntegration?.deliveryStatus === "pending" &&
          typeof session.endedAt === "number" &&
          session.endedAt < settleCutoff &&
          session.endedAt > staleCutoff &&
          session.status !== "connecting" &&
          session.status !== "live"
      )
      .map((session) => ({ callSessionId: session._id }));
  }
});

// Full call history for the same external record (e.g. one CRM prospect), used to generate next-call advice from prior conversations.
export const externalCallHistoryForAdvice = internalQuery({
  args: { callSessionId: v.id("callSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.callSessionId);
    const integration = session?.externalIntegration;
    if (!session || !integration) return null;

    const siblings = await ctx.db
      .query("callSessions")
      .withIndex("by_external_integration", (q) =>
        q.eq("externalIntegration.source", integration.source).eq("externalIntegration.externalId", integration.externalId)
      )
      .order("desc")
      .take(10);

    const calls = [] as Array<{
      isCurrent: boolean;
      startedAt?: number;
      endedAt?: number;
      status: string;
      failureReason?: string;
      callFocusText?: string;
      artifact: {
        title?: string;
        summary?: string;
        decisions: string[];
        actionItems: string[];
        risks: string[];
      } | null;
    }>;
    for (const call of siblings) {
      const artifact = await ctx.db
        .query("callArtifacts")
        .withIndex("by_call_session", (q) => q.eq("callSessionId", call._id))
        .first();
      calls.push({
        isCurrent: call._id === args.callSessionId,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        status: call.status,
        failureReason: call.failureReason,
        callFocusText: call.callFocusText,
        artifact: artifact
          ? {
              title: artifact.title,
              summary: artifact.summary,
              decisions: artifact.decisions,
              actionItems: artifact.actionItems,
              risks: artifact.risks
            }
          : null
      });
    }

    const segments = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_call_session_time", (q) => q.eq("callSessionId", args.callSessionId))
      .take(500);
    const transcript = segments
      .filter((segment) => segment.isFinal)
      .map((segment) => `${segment.speakerLabel ?? segment.speakerTrack}: ${segment.text}`)
      .join("\n")
      .slice(0, 30_000);

    return {
      source: integration.source,
      metadata: integration.metadata,
      calls,
      transcript: transcript || undefined
    };
  }
});

export const saveNextCallAdviceInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    advice: v.string()
  },
  handler: async (ctx, args) => {
    const artifact = await ctx.db
      .query("callArtifacts")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    if (!artifact) return null;
    await ctx.db.patch(artifact._id, { nextCallAdvice: args.advice, updatedAt: now() });
    return artifact._id;
  }
});

export const generateNextCallAdviceForExternalCall = action({
  args: {
    serviceToken: v.string(),
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args): Promise<{ advice: string | null }> => {
    requireServiceToken(args.serviceToken);
    const history: {
      source: string;
      metadata?: unknown;
      calls: Array<{
        isCurrent: boolean;
        startedAt?: number;
        endedAt?: number;
        status: string;
        failureReason?: string;
        callFocusText?: string;
        artifact: {
          title?: string;
          summary?: string;
          decisions: string[];
          actionItems: string[];
          risks: string[];
        } | null;
      }>;
      transcript?: string;
    } | null = await ctx.runQuery(internal.calls.externalCallHistoryForAdvice, {
      callSessionId: args.callSessionId
    });
    if (!history) return { advice: null };
    const advice = await generateNextCallAdviceWithOpenAI(history);
    if (advice) {
      await ctx.runMutation(internal.calls.saveNextCallAdviceInternal, {
        callSessionId: args.callSessionId,
        advice
      });
    }
    return { advice };
  }
});

export const createSidetoneSession = mutation({
  args: {
    entityId: v.id("entityProfiles"),
    fromPhoneNumber: v.string(),
    ownerPhoneNumber: v.string(),
    industryProfile: v.optional(industryProfile),
    coachMode: v.optional(v.union(coachMode, v.null())),
    consentMode: consentMode,
    callFocusText: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    requireFeature("phone");
    const entity = await requireOwnedEntity(ctx, args.entityId);
    const identity = await requireAuthenticatedIdentity(ctx);
    const timestamp = now();

    await ctx.db.patch(entity._id, {
      defaultIndustryProfile: args.industryProfile ?? entity.defaultIndustryProfile ?? "general",
      defaultCoachMode: args.coachMode ?? undefined,
      defaultConsentMode: args.consentMode,
      ownerPhoneNumber: args.ownerPhoneNumber,
      updatedAt: timestamp
    });

    const callSessionId = await ctx.db.insert("callSessions", {
      entityId: entity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      mode: "sidetone_session",
      status: "connecting",
      industryProfile: args.industryProfile ?? entity.defaultIndustryProfile ?? "general",
      ...(args.coachMode ? { coachMode: args.coachMode } : {}),
      callFocusText: args.callFocusText?.trim() || undefined,
      callFocusInputMethod: args.callFocusText?.trim() ? "typed" : undefined,
      consentMode: args.consentMode,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("callLegs", {
      callSessionId,
      entityId: entity._id,
      role: "owner",
      phoneNumber: args.ownerPhoneNumber,
      status: "ringing",
      startedAt: timestamp
    });

    await ctx.db.insert("consentRecords", {
      entityId: entity._id,
      callSessionId,
      mode: args.consentMode,
      disclosureText: args.consentMode === "conference_disclosure"
        ? "Sidetone disclosure enabled for this workspace."
        : "Owner indicated they will handle consent before using Sidetone.",
      recordedAt: timestamp,
      source: "owner_setting"
    });

    await ctx.db.insert("auditEvents", {
      entityId: entity._id,
      callSessionId,
      actor: "owner",
      type: "sidetone_session.requested",
      message: `Sidetone session requested for ${args.ownerPhoneNumber}.`,
      metadata: {
        fromPhoneNumber: args.fromPhoneNumber,
        industryProfile: args.industryProfile ?? entity.defaultIndustryProfile ?? "general",
        ...(args.coachMode ? { coachMode: args.coachMode } : {}),
        consentMode: args.consentMode
      },
      createdAt: timestamp
    });

    return { callSessionId };
  }
});

export const createConferenceInSessionFromWebhook = mutation({
  args: {
    workerToken: v.string(),
    entityId: v.id("entityProfiles"),
    fromPhoneNumber: v.optional(v.string()),
    toPhoneNumber: v.string(),
    telnyxCallControlId: v.optional(v.string()),
    telnyxCallSessionId: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    requireFeature("phone");
    requireWorkerToken(args.workerToken);
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new Error("Workspace not found.");
    }

    const timestamp = now();
    const shouldPlayOnboardingPrompt = !entity.activationOnboardingPromptPlayedAt;
    const callSessionId = await ctx.db.insert("callSessions", {
      entityId: entity._id,
      ownerTokenIdentifier: entity.ownerTokenIdentifier,
      mode: "conference_in",
      status: "connecting",
      industryProfile: entity.defaultIndustryProfile ?? "general",
      ...(entity.defaultCoachMode ? { coachMode: entity.defaultCoachMode } : {}),
      consentMode: entity.defaultConsentMode,
      telnyxCallControlId: args.telnyxCallControlId,
      telnyxCallSessionId: args.telnyxCallSessionId,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    if (shouldPlayOnboardingPrompt) {
      await ctx.db.patch(entity._id, {
        activationOnboardingPromptPlayedAt: timestamp,
        updatedAt: timestamp
      });
    }

    await ctx.db.insert("callLegs", {
      callSessionId,
      entityId: entity._id,
      role: "external",
      phoneNumber: args.fromPhoneNumber,
      telnyxCallControlId: args.telnyxCallControlId,
      status: "ringing",
      startedAt: timestamp
    });

    const shouldPlayDisclosure = entity.defaultConsentMode !== "owner_acknowledgment";

    await ctx.db.insert("consentRecords", {
      entityId: entity._id,
      callSessionId,
      mode: entity.defaultConsentMode,
      disclosureText: shouldPlayDisclosure
        ? "This call is being recorded and transcribed by Sidetone."
        : "Owner indicated they already handled consent before adding Sidetone.",
      recordedAt: timestamp,
      source: shouldPlayDisclosure ? "voice_prompt" : "owner_setting"
    });

    await ctx.db.insert("auditEvents", {
      entityId: entity._id,
      callSessionId,
      actor: "telnyx",
      type: "conference_in.created",
      message: `Sidetone was added to a call from ${args.fromPhoneNumber ?? "unknown caller"}.`,
      metadata: {
        toPhoneNumber: args.toPhoneNumber,
        telnyxCallControlId: args.telnyxCallControlId,
        telnyxCallSessionId: args.telnyxCallSessionId
      },
      createdAt: timestamp
    });

    await ctx.scheduler.runAfter(45_000, internal.calls.sendMergeReminderSmsInternal, {
      callSessionId,
      reason: "no_audio_after_join"
    });

    return {
      callSessionId,
      consentMode: entity.defaultConsentMode,
      shouldPlayOnboardingPrompt
    };
  }
});

export const attachTelnyxCallIds = mutation({
  args: {
    callSessionId: v.id("callSessions"),
    telnyxCallControlId: v.optional(v.string()),
    telnyxCallSessionId: v.optional(v.string()),
    telnyxConferenceId: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("connecting"),
      v.literal("live"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("cancelled")
    )),
    failureReason: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Call session not found.");
    }

    await ctx.db.patch(args.callSessionId, {
      telnyxCallControlId: args.telnyxCallControlId ?? callSession.telnyxCallControlId,
      telnyxCallSessionId: args.telnyxCallSessionId ?? callSession.telnyxCallSessionId,
      telnyxConferenceId: args.telnyxConferenceId ?? callSession.telnyxConferenceId,
      status: args.status ?? callSession.status,
      failureReason: args.failureReason,
      updatedAt: now()
    });

    return { callSessionId: args.callSessionId };
  }
});

export const callSessionForTelnyxId = query({
  args: {
    workerToken: v.string(),
    telnyxCallSessionId: v.optional(v.string()),
    telnyxCallControlId: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    if (args.telnyxCallSessionId) {
      return await ctx.db
        .query("callSessions")
        .withIndex("by_telnyx_call_session", (q) => q.eq("telnyxCallSessionId", args.telnyxCallSessionId))
        .first();
    }

    if (args.telnyxCallControlId) {
      return await ctx.db
        .query("callSessions")
        .withIndex("by_telnyx_control", (q) => q.eq("telnyxCallControlId", args.telnyxCallControlId))
        .first();
    }

    return null;
  }
});

export const callThroughRoutingContext = query({
  args: {
    workerToken: v.string(),
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      return null;
    }

    const legs = await ctx.db
      .query("callLegs")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .take(16);
    const numberAssignment = await ctx.db
      .query("phoneNumberAssignments")
      .withIndex("by_entity", (q) => q.eq("entityId", callSession.entityId))
      .first();

    return {
      callSession,
      ownerLeg: legs.find((leg) => leg.role === "owner") ?? null,
      externalLeg: legs.find((leg) => leg.role === "external") ?? null,
      numberAssignment
    };
  }
});

export const patchCallLegFromWebhook = mutation({
  args: {
    workerToken: v.string(),
    callSessionId: v.id("callSessions"),
    role: v.union(v.literal("owner"), v.literal("external"), v.literal("sidetone")),
    status: v.union(v.literal("ringing"), v.literal("answered"), v.literal("ended"), v.literal("failed")),
    phoneNumber: v.optional(v.string()),
    telnyxCallControlId: v.optional(v.string()),
    telnyxCallLegId: v.optional(v.string()),
    endedAt: v.optional(v.float64())
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    const existing = await ctx.db
      .query("callLegs")
      .withIndex("by_call_session_role", (q) => q.eq("callSessionId", args.callSessionId).eq("role", args.role))
      .first();
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      throw new Error("Call session not found.");
    }

    const patch = {
      entityId: callSession.entityId,
      phoneNumber: args.phoneNumber ?? existing?.phoneNumber,
      telnyxCallControlId: args.telnyxCallControlId ?? existing?.telnyxCallControlId,
      telnyxCallLegId: args.telnyxCallLegId ?? existing?.telnyxCallLegId,
      status: args.status,
      startedAt: existing?.startedAt ?? now(),
      endedAt: args.endedAt ?? existing?.endedAt
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { callLegId: existing._id };
    }

    const callLegId = await ctx.db.insert("callLegs", {
      callSessionId: args.callSessionId,
      role: args.role,
      ...patch
    });
    return { callLegId };
  }
});

export const recordTelnyxWebhookEvent = mutation({
  args: {
    workerToken: v.string(),
    providerEventId: v.string(),
    eventType: v.string(),
    entityId: v.optional(v.id("entityProfiles")),
    callSessionId: v.optional(v.id("callSessions")),
    payload: v.optional(v.any()),
    status: v.union(v.literal("received"), v.literal("processed"), v.literal("ignored"), v.literal("failed")),
    error: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    const timestamp = now();
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_provider_event", (q) => q.eq("provider", "telnyx").eq("providerEventId", args.providerEventId))
      .first();

    if (existing) {
      return { webhookEventId: existing._id, duplicate: true };
    }

    const webhookEventId = await ctx.db.insert("webhookEvents", {
      provider: "telnyx",
      providerEventId: args.providerEventId,
      eventType: args.eventType,
      entityId: args.entityId,
      callSessionId: args.callSessionId,
      status: args.status,
      payload: args.payload,
      error: args.error,
      receivedAt: timestamp,
      processedAt: args.status === "received" ? undefined : timestamp
    });

    return { webhookEventId, duplicate: false };
  }
});

export const markTelnyxWebhookEventProcessed = mutation({
  args: {
    workerToken: v.string(),
    webhookEventId: v.id("webhookEvents"),
    status: v.union(v.literal("processed"), v.literal("ignored"), v.literal("failed")),
    entityId: v.optional(v.id("entityProfiles")),
    callSessionId: v.optional(v.id("callSessions")),
    error: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    const existing = await ctx.db.get(args.webhookEventId);
    if (!existing || existing.provider !== "telnyx") {
      throw new Error("Webhook event not found.");
    }

    await ctx.db.patch(args.webhookEventId, {
      status: args.status,
      entityId: args.entityId ?? existing.entityId,
      callSessionId: args.callSessionId ?? existing.callSessionId,
      error: args.error,
      processedAt: now()
    });

    if (existing.eventType === "call.hold" && args.callSessionId) {
      await ctx.scheduler.runAfter(30_000, internal.calls.sendMergeReminderSmsInternal, {
        callSessionId: args.callSessionId,
        reason: "call_hold",
        minAgeMs: 0
      });
    }

    return { webhookEventId: args.webhookEventId };
  }
});

export const patchCallFromWebhook = mutation({
  args: {
    workerToken: v.string(),
    callSessionId: v.id("callSessions"),
    status: v.union(
      v.literal("connecting"),
      v.literal("live"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    telnyxCallControlId: v.optional(v.string()),
    telnyxCallSessionId: v.optional(v.string()),
    telnyxConferenceId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    startedAt: v.optional(v.float64()),
    endedAt: v.optional(v.float64())
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      throw new Error("Call session not found.");
    }

    await ctx.db.patch(args.callSessionId, {
      status: args.status,
      telnyxCallControlId: args.telnyxCallControlId ?? callSession.telnyxCallControlId,
      telnyxCallSessionId: args.telnyxCallSessionId ?? callSession.telnyxCallSessionId,
      telnyxConferenceId: args.telnyxConferenceId ?? callSession.telnyxConferenceId,
      failureReason: args.failureReason,
      startedAt: args.startedAt ?? callSession.startedAt,
      endedAt: args.endedAt ?? callSession.endedAt,
      updatedAt: now()
    });
  }
});

export const finalizeCallArtifactFromTranscript = mutation({
  args: {
    workerToken: v.string(),
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      throw new Error("Call session not found.");
    }

    const segments = await readTranscript(ctx, args.callSessionId);
    const timestamp = now();

    if (!segments.length) {
      await ctx.db.patch(args.callSessionId, {
        status: "processing",
        endedAt: callSession.endedAt ?? timestamp,
        updatedAt: timestamp
      });

      await ctx.db.insert("auditEvents", {
        entityId: callSession.entityId,
        callSessionId: args.callSessionId,
        actor: "system",
        type: "call_artifact.waiting_for_transcript",
        message: "Sidetone is waiting for transcript segments before generating the post-call record.",
        metadata: {
          transcriptSegmentCount: 0
        },
        createdAt: timestamp
      });

      return { artifactId: undefined };
    }

    await ctx.db.patch(args.callSessionId, {
      status: "processing",
      endedAt: callSession.endedAt ?? timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "system",
      type: "call_artifact.preparing",
      message: "Sidetone is preparing the post-call record.",
      metadata: {
        transcriptSegmentCount: segments.length
      },
      createdAt: timestamp
    });

    return { artifactId: undefined };
  }
});

export const upsertOwnerReviewedCallArtifact = mutation({
  args: {
    callSessionId: v.id("callSessions"),
    summary: v.string(),
    decisions: v.array(v.string()),
    actionItems: v.array(v.string()),
    risks: v.array(v.string()),
    followUpDraft: v.optional(v.string()),
    crmNoteDraft: v.optional(v.string()),
    promptVersion: v.string(),
    modelName: v.string()
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Call session not found.");
    }

    const timestamp = now();
    const existing = await ctx.db
      .query("callArtifacts")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();

    const patch = {
      entityId: callSession.entityId,
      title: normalizeArtifactTitle(undefined, args.summary),
      callBasis: normalizeCallBasis(undefined, args.summary),
      summary: args.summary,
      decisions: args.decisions,
      actionItems: args.actionItems,
      risks: args.risks,
      followUpDraft: args.followUpDraft,
      crmNoteDraft: args.crmNoteDraft,
      promptVersion: args.promptVersion,
      modelName: args.modelName,
      status: "ready" as const,
      updatedAt: timestamp
    };

    let artifactId = existing?._id;
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      artifactId = await ctx.db.insert("callArtifacts", {
        callSessionId: args.callSessionId,
        createdAt: timestamp,
        ...patch
      });
    }

    await ctx.db.patch(args.callSessionId, {
      status: "ready",
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "owner",
      type: "call_artifact.regenerated",
      message: "Owner regenerated the post-call record.",
      metadata: {
        artifactId,
        modelName: args.modelName,
        promptVersion: args.promptVersion
      },
      createdAt: timestamp
    });

    return { artifactId };
  }
});

export const callRecordForNotes = internalQuery({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      return null;
    }

    const segments = await readTranscript(ctx, args.callSessionId);
    const entity = await ctx.db.get(callSession.entityId);
    const numberAssignment = await ctx.db
      .query("phoneNumberAssignments")
      .withIndex("by_entity", (q) => q.eq("entityId", callSession.entityId))
      .first();
    const ownerLeg = await ctx.db
      .query("callLegs")
      .withIndex("by_call_session_role", (q) => q.eq("callSessionId", args.callSessionId).eq("role", "owner"))
      .first();
    const ownerSummarySmsNotification = await ctx.db
      .query("ownerNotifications")
      .withIndex("by_call_purpose_channel", (q) =>
        q
          .eq("callSessionId", args.callSessionId)
          .eq("purpose", "owner_call_summary")
          .eq("channel", "sms")
      )
      .first();

    return {
      callSession,
      entity,
      numberAssignment,
      ownerLeg,
      ownerSummarySmsNotification,
      callFocusText: callSession.callFocusText,
      transcript: segments.map((segment) => segment.text).join("\n"),
      segmentCount: segments.length,
      latestSegmentCreatedAt: segments.at(-1)?.createdAt
        ?? segments.at(-1)?.endMs
    };
  }
});

export const recordOwnerSummarySmsNotification = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
    toPhoneNumber: v.string(),
    providerMessageId: v.optional(v.string()),
    error: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      throw new Error("Call session not found.");
    }

    const timestamp = now();
    const existing = await ctx.db
      .query("ownerNotifications")
      .withIndex("by_call_purpose_channel", (q) =>
        q
          .eq("callSessionId", args.callSessionId)
          .eq("purpose", "owner_call_summary")
          .eq("channel", "sms")
      )
      .first();

    if (existing?.status === "sent" && args.status === "sent") {
      return { notificationId: existing._id, status: existing.status };
    }

    const patch = {
      status: args.status,
      toPhoneNumber: args.toPhoneNumber,
      provider: "telnyx" as const,
      providerMessageId: args.providerMessageId,
      error: args.error,
      updatedAt: timestamp
    };

    let notificationId = existing?._id;
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      notificationId = await ctx.db.insert("ownerNotifications", {
        entityId: callSession.entityId,
        callSessionId: args.callSessionId,
        channel: "sms",
        purpose: "owner_call_summary",
        createdAt: timestamp,
        ...patch
      });
    }

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "system",
      type: `owner_summary_sms.${args.status}`,
      message: args.status === "sent"
        ? "Sidetone sent the call summary to the owner by text."
        : args.status === "skipped"
          ? "Sidetone skipped the owner summary text."
          : "Sidetone could not send the owner summary text.",
      metadata: {
        notificationId,
        providerMessageId: args.providerMessageId,
        error: args.error
      },
      createdAt: timestamp
    });

    return { notificationId, status: args.status };
  }
});

export const recordOwnerSummarySmsDeliveryEvent = mutation({
  args: {
    workerToken: v.string(),
    providerMessageId: v.string(),
    recipientStatus: v.optional(v.string()),
    eventType: v.optional(v.string()),
    error: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    const notification = await ctx.db
      .query("ownerNotifications")
      .withIndex("by_provider_message", (q) => q.eq("providerMessageId", args.providerMessageId))
      .first();

    if (!notification) {
      return { updated: false as const };
    }

    const failed = Boolean(args.error)
      || args.recipientStatus === "delivery_failed"
      || args.recipientStatus === "failed"
      || args.recipientStatus === "rejected";
    const timestamp = now();

    await ctx.db.patch(notification._id, {
      status: failed ? "failed" : notification.status === "failed" ? "failed" : "sent",
      error: failed ? args.error ?? `Telnyx reported ${args.recipientStatus ?? "delivery failure"}.` : undefined,
      updatedAt: timestamp
    });

    const auditPrefix = notification.purpose === "merge_reminder"
      ? "merge_reminder_sms"
      : "owner_summary_sms";

    await ctx.db.insert("auditEvents", {
      entityId: notification.entityId,
      callSessionId: notification.callSessionId,
      actor: "telnyx",
      type: failed ? `${auditPrefix}.delivery_failed` : `${auditPrefix}.delivery_event`,
      message: failed
        ? "Telnyx reported that the text was not delivered."
        : "Telnyx reported a text delivery event.",
      metadata: {
        notificationId: notification._id,
        providerMessageId: args.providerMessageId,
        recipientStatus: args.recipientStatus,
        eventType: args.eventType,
        error: args.error
      },
      createdAt: timestamp
    });

    return { updated: true as const, status: failed ? "failed" as const : "sent" as const };
  }
});

export const ensureCallShareForSms = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    shareToken: v.string()
  },
  handler: async (ctx, args) => {
    assertValidShareToken(args.shareToken);

    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      throw new Error("Call session not found.");
    }

    if (callSession.publicShareEnabled && callSession.publicShareToken) {
      return { shareToken: callSession.publicShareToken, collision: false };
    }

    const existingForToken = await ctx.db
      .query("callSessions")
      .withIndex("by_public_share_token", (q) => q.eq("publicShareToken", args.shareToken))
      .first();
    if (existingForToken && String(existingForToken._id) !== String(callSession._id)) {
      return { shareToken: undefined, collision: true };
    }

    const timestamp = now();
    await ctx.db.patch(callSession._id, {
      publicShareToken: args.shareToken,
      publicShareEnabled: true,
      publicShareCreatedAt: timestamp,
      publicShareDisabledAt: undefined,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: callSession._id,
      actor: "system",
      type: "call.share_enabled",
      message: "Sidetone created a public share link for the owner summary text.",
      createdAt: timestamp
    });

    return { shareToken: args.shareToken, collision: false };
  }
});

export const mergeReminderContext = internalQuery({
  args: {
    callSessionId: v.id("callSessions"),
    ownerTokenIdentifier: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (
      !callSession
      || (args.ownerTokenIdentifier && callSession.ownerTokenIdentifier !== args.ownerTokenIdentifier)
    ) {
      return null;
    }

    const entity = await ctx.db.get(callSession.entityId);
    const ownerLeg = await ctx.db
      .query("callLegs")
      .withIndex("by_call_session_role", (q) => q.eq("callSessionId", args.callSessionId).eq("role", "owner"))
      .first();
    const segments = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_call_session_time", (q) => q.eq("callSessionId", args.callSessionId))
      .order("asc")
      .take(8);
    const notification = await ctx.db
      .query("ownerNotifications")
      .withIndex("by_call_purpose_channel", (q) =>
        q
          .eq("callSessionId", args.callSessionId)
          .eq("purpose", "merge_reminder")
          .eq("channel", "sms")
      )
      .first();
    const callStateEvents = (await ctx.db
      .query("webhookEvents")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .order("desc")
      .take(20))
      .filter((event) => event.provider === "telnyx")
      .map((event) => ({
        eventType: event.eventType,
        receivedAt: event.receivedAt,
        processedAt: event.processedAt
      }));

    return {
      callSession,
      entity,
      ownerLeg,
      segments,
      notification,
      callStateEvents
    };
  }
});

export const reserveMergeReminderSmsNotification = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    toPhoneNumber: v.string()
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      throw new Error("Call session not found.");
    }

    const timestamp = now();
    const existing = await ctx.db
      .query("ownerNotifications")
      .withIndex("by_call_purpose_channel", (q) =>
        q
          .eq("callSessionId", args.callSessionId)
          .eq("purpose", "merge_reminder")
          .eq("channel", "sms")
      )
      .first();

    if (
      existing?.status === "sent" ||
      (existing?.status === "sending" && timestamp - existing.updatedAt < 5 * 60 * 1000)
    ) {
      return {
        shouldSend: false,
        notificationId: existing._id,
        status: existing.status
      };
    }

    const patch = {
      status: "sending" as const,
      toPhoneNumber: args.toPhoneNumber,
      provider: "telnyx" as const,
      error: undefined,
      updatedAt: timestamp
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return {
        shouldSend: true,
        notificationId: existing._id,
        status: "sending" as const
      };
    }

    const notificationId = await ctx.db.insert("ownerNotifications", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      channel: "sms",
      purpose: "merge_reminder",
      createdAt: timestamp,
      ...patch
    });

    return {
      shouldSend: true,
      notificationId,
      status: "sending" as const
    };
  }
});

export const recordMergeReminderSmsNotification = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
    toPhoneNumber: v.string(),
    providerMessageId: v.optional(v.string()),
    error: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      throw new Error("Call session not found.");
    }

    const timestamp = now();
    const existing = await ctx.db
      .query("ownerNotifications")
      .withIndex("by_call_purpose_channel", (q) =>
        q
          .eq("callSessionId", args.callSessionId)
          .eq("purpose", "merge_reminder")
          .eq("channel", "sms")
      )
      .first();

    const patch = {
      status: args.status,
      toPhoneNumber: args.toPhoneNumber,
      provider: "telnyx" as const,
      providerMessageId: args.providerMessageId,
      error: args.error,
      updatedAt: timestamp
    };

    let notificationId = existing?._id;
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      notificationId = await ctx.db.insert("ownerNotifications", {
        entityId: callSession.entityId,
        callSessionId: args.callSessionId,
        channel: "sms",
        purpose: "merge_reminder",
        createdAt: timestamp,
        ...patch
      });
    }

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "system",
      type: `merge_reminder_sms.${args.status}`,
      message: args.status === "sent"
        ? "Sidetone sent the merge reminder to the owner by text."
        : args.status === "skipped"
          ? "Sidetone skipped the merge reminder text."
          : "Sidetone could not send the merge reminder text.",
      metadata: {
        notificationId,
        providerMessageId: args.providerMessageId,
        error: args.error
      },
      createdAt: timestamp
    });

    return { notificationId, status: args.status };
  }
});

async function sendMergeReminderSmsHandler(
  ctx: any,
  args: {
    callSessionId: any;
    ownerTokenIdentifier?: string;
    reason?: string;
    minAgeMs?: number;
  }
) {
    const context: any = await ctx.runQuery(internal.calls.mergeReminderContext, {
      callSessionId: args.callSessionId,
      ownerTokenIdentifier: args.ownerTokenIdentifier
    });
    if (!context?.callSession) {
      return { status: "skipped" as const, reason: "call_not_found" };
    }

    if (context.callSession.mode !== "conference_in") {
      return { status: "skipped" as const, reason: "not_conference_in" };
    }

    if (!["connecting", "live"].includes(context.callSession.status)) {
      return { status: "skipped" as const, reason: "call_not_active" };
    }

    const startedAt = context.callSession.startedAt ?? context.callSession.createdAt;
    if (Date.now() - startedAt < (args.minAgeMs ?? 30 * 1000)) {
      return { status: "skipped" as const, reason: "too_soon" };
    }

    if (args.reason === "call_hold") {
      const latestHoldState = context.callStateEvents?.find((event: any) =>
        event.eventType === "call.hold" || event.eventType === "call.unhold" || event.eventType === "call.hangup"
      );

      if (latestHoldState?.eventType !== "call.hold") {
        return { status: "skipped" as const, reason: "call_no_longer_held" };
      }
    } else if (context.segments?.some((segment: any) => transcriptTextIsMeaningful(segment.text))) {
      return { status: "skipped" as const, reason: "audio_detected" };
    }

    const toPhoneNumber = configuredCallerPhoneForSummary(context);
    const fromPhoneNumber = ownerSummarySmsFromNumber();
    if (!toPhoneNumber || !fromPhoneNumber) {
      await ctx.runMutation(internal.calls.recordMergeReminderSmsNotification, {
        callSessionId: args.callSessionId,
        status: "skipped",
        toPhoneNumber: toPhoneNumber ?? "unknown",
        error: toPhoneNumber
          ? "Registered SMS sender is unavailable."
          : "Owner phone number is unavailable for merge reminder SMS."
      });
      return { status: "skipped" as const, reason: "missing_phone_number" };
    }

    const reservation: any = await ctx.runMutation(internal.calls.reserveMergeReminderSmsNotification, {
      callSessionId: args.callSessionId,
      toPhoneNumber
    });
    if (!reservation.shouldSend) {
      return { status: "skipped" as const, reason: "already_sent" };
    }

    try {
      const smsResult = await sendTelnyxSms({
        fromPhoneNumber,
        toPhoneNumber,
        text: buildMergeReminderSms({
          callSessionId: String(args.callSessionId),
          reason: args.reason
        })
      });

      await ctx.runMutation(internal.calls.recordMergeReminderSmsNotification, {
        callSessionId: args.callSessionId,
        status: smsResult.status,
        toPhoneNumber,
        providerMessageId: smsResult.providerMessageId,
        error: smsResult.error
      });

      return { status: smsResult.status };
    } catch (error) {
      await ctx.runMutation(internal.calls.recordMergeReminderSmsNotification, {
        callSessionId: args.callSessionId,
        status: "failed",
        toPhoneNumber,
        error: error instanceof Error ? error.message : "Unable to send merge reminder text."
      });
      return { status: "failed" as const };
    }
}

export const sendMergeReminderSms = action({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required.");
    }

    return await sendMergeReminderSmsHandler(ctx, {
      callSessionId: args.callSessionId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      reason: "live_view_no_audio",
      minAgeMs: 30 * 1000
    });
  }
});

export const sendMergeReminderSmsInternal = internalAction({
  args: {
    callSessionId: v.id("callSessions"),
    reason: v.optional(v.string()),
    minAgeMs: v.optional(v.float64())
  },
  handler: async (ctx, args) => {
    return await sendMergeReminderSmsHandler(ctx, {
      callSessionId: args.callSessionId,
      reason: args.reason,
      minAgeMs: args.minAgeMs
    });
  }
});

export const reserveOwnerSummarySmsNotification = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    toPhoneNumber: v.string()
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      throw new Error("Call session not found.");
    }

    const timestamp = now();
    const existing = await ctx.db
      .query("ownerNotifications")
      .withIndex("by_call_purpose_channel", (q) =>
        q
          .eq("callSessionId", args.callSessionId)
          .eq("purpose", "owner_call_summary")
          .eq("channel", "sms")
      )
      .first();

    if (
      existing?.status === "sent" ||
      (existing?.status === "sending" && timestamp - existing.updatedAt < 2 * 60 * 1000)
    ) {
      return {
        shouldSend: false,
        notificationId: existing._id,
        status: existing.status
      };
    }

    const patch = {
      status: "sending" as const,
      toPhoneNumber: args.toPhoneNumber,
      provider: "telnyx" as const,
      error: undefined,
      updatedAt: timestamp
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return {
        shouldSend: true,
        notificationId: existing._id,
        status: "sending" as const
      };
    }

    const notificationId = await ctx.db.insert("ownerNotifications", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      channel: "sms",
      purpose: "owner_call_summary",
      createdAt: timestamp,
      ...patch
    });

    return {
      shouldSend: true,
      notificationId,
      status: "sending" as const
    };
  }
});

export const markNumberAssignmentMessagingAttached = internalMutation({
  args: {
    entityId: v.id("entityProfiles"),
    messagingProfileId: v.string()
  },
  handler: async (ctx, args) => {
    const assignment = await ctx.db
      .query("phoneNumberAssignments")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .first();

    if (!assignment) {
      return { updated: false as const };
    }

    await ctx.db.patch(assignment._id, {
      telnyxMessagingProfileId: args.messagingProfileId,
      smsRoutingStatus: "attached",
      updatedAt: now()
    });

    return { updated: true as const, assignmentId: assignment._id };
  }
});

export const upsertSystemGeneratedCallArtifact = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    artifact: generatedArtifact,
    promptVersion: v.string(),
    modelName: v.string(),
    segmentCount: v.float64(),
    latestSegmentCreatedAt: v.optional(v.float64())
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      throw new Error("Call session not found.");
    }

    const timestamp = now();
    const existing = await ctx.db
      .query("callArtifacts")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();

    const patch = {
      entityId: callSession.entityId,
      title: normalizeArtifactTitle(args.artifact.title, args.artifact.summary),
      callBasis: normalizeCallBasis(args.artifact.callBasis, args.artifact.summary),
      summary: args.artifact.summary,
      decisions: args.artifact.decisions,
      actionItems: args.artifact.actionItems,
      risks: args.artifact.risks,
      followUpDraft: args.artifact.followUpDraft,
      crmNoteDraft: args.artifact.crmNoteDraft,
      promptVersion: args.promptVersion,
      modelName: args.modelName,
      transcriptSegmentCount: args.segmentCount,
      transcriptLatestSegmentCreatedAt: args.latestSegmentCreatedAt,
      status: "ready" as const,
      updatedAt: timestamp
    };

    let artifactId = existing?._id;
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      artifactId = await ctx.db.insert("callArtifacts", {
        callSessionId: args.callSessionId,
        createdAt: timestamp,
        ...patch
      });
    }

    await ctx.db.patch(args.callSessionId, {
      status: "ready",
      endedAt: callSession.endedAt ?? timestamp,
      updatedAt: timestamp
    });

    if (isPhoneCallMode(callSession.mode)) {
      await ctx.runMutation(internal.billing.recordPhoneCallUsageInternal, {
        callSessionId: args.callSessionId
      });
    }

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "system",
      type: "call_artifact.generated",
      message: "Sidetone generated the post-call record.",
      metadata: {
        transcriptSegmentCount: args.segmentCount,
        artifactId,
        modelName: args.modelName,
        promptVersion: args.promptVersion
      },
      createdAt: timestamp
    });

    await ctx.scheduler.runAfter(1_000, internal.intelligence.indexCallTranscriptInternal, {
      callSessionId: args.callSessionId
    });

    return { artifactId };
  }
});

export const recordCallArtifactGenerationFailure = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    error: v.string(),
    segmentCount: v.float64(),
    latestSegmentCreatedAt: v.optional(v.float64())
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      throw new Error("Call session not found.");
    }

    const timestamp = now();
    const existing = await ctx.db
      .query("callArtifacts")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();

    const patch = {
      entityId: callSession.entityId,
      title: "Notes Unavailable",
      callBasis: "Notes could not be generated.",
      summary: NOTES_UNAVAILABLE_SUMMARY,
      decisions: [],
      actionItems: [],
      risks: [],
      followUpDraft: undefined,
      crmNoteDraft: undefined,
      promptVersion: "post-call-gpt-v2",
      modelName: "post-call-generation-failed",
      transcriptSegmentCount: args.segmentCount,
      transcriptLatestSegmentCreatedAt: args.latestSegmentCreatedAt,
      status: "failed" as const,
      updatedAt: timestamp
    };

    let artifactId = existing?._id;
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      artifactId = await ctx.db.insert("callArtifacts", {
        callSessionId: args.callSessionId,
        createdAt: timestamp,
        ...patch
      });
    }

    await ctx.db.patch(args.callSessionId, {
      status: "ready",
      endedAt: callSession.endedAt ?? timestamp,
      updatedAt: timestamp
    });

    if (isPhoneCallMode(callSession.mode)) {
      await ctx.runMutation(internal.billing.recordPhoneCallUsageInternal, {
        callSessionId: args.callSessionId
      });
    }

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "system",
      type: "call_artifact.generation_failed",
      message: "Sidetone could not generate the post-call record.",
      metadata: {
        transcriptSegmentCount: args.segmentCount,
        artifactId,
        error: args.error
      },
      createdAt: timestamp
    });

    return { artifactId };
  }
});

export const recordCallArtifactRun = mutation({
  args: {
    callSessionId: v.id("callSessions"),
    provider: labModelProvider,
    modelId: v.string(),
    modelLabel: v.string(),
    artifact: v.optional(generatedArtifact),
    promptVersion: v.string(),
    segmentCount: v.float64(),
    latestSegmentCreatedAt: v.optional(v.float64()),
    error: v.optional(v.string()),
    status: v.union(v.literal("ready"), v.literal("failed"))
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Call session not found.");
    }

    const timestamp = now();
    const runId = await ctx.db.insert("callArtifactRuns", {
      callSessionId: args.callSessionId,
      entityId: callSession.entityId,
      ownerTokenIdentifier: callSession.ownerTokenIdentifier,
      provider: args.provider,
      modelId: args.modelId,
      modelLabel: args.modelLabel,
      isLabRun: true,
      title: args.artifact?.title,
      summary: args.artifact?.summary,
      decisions: args.artifact?.decisions ?? [],
      actionItems: args.artifact?.actionItems ?? [],
      risks: args.artifact?.risks ?? [],
      followUpDraft: args.artifact?.followUpDraft,
      crmNoteDraft: args.artifact?.crmNoteDraft,
      promptVersion: args.promptVersion,
      transcriptSegmentCount: args.segmentCount,
      transcriptLatestSegmentCreatedAt: args.latestSegmentCreatedAt,
      error: args.error,
      status: args.status,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "owner",
      type: args.status === "ready"
        ? "call_artifact.lab_run_generated"
        : "call_artifact.lab_run_failed",
      message: args.status === "ready"
        ? "Owner generated a lab notes variant."
        : "Owner lab notes generation failed.",
      metadata: {
        runId,
        provider: args.provider,
        modelId: args.modelId,
        modelLabel: args.modelLabel,
        error: args.error,
        transcriptSegmentCount: args.segmentCount
      },
      createdAt: timestamp
    });

    return { runId };
  }
});

export const callArtifactRunsForCall = query({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Call session not found.");
    }

    return await ctx.db
      .query("callArtifactRuns")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .order("desc")
      .take(30);
  }
});

export const recordTelnyxCallRecordingSaved = mutation({
  args: {
    workerToken: v.string(),
    callSessionId: v.id("callSessions"),
    recordingId: v.string(),
    status: v.optional(v.union(v.literal("ready"), v.literal("failed"))),
    source: v.optional(v.union(v.literal("call"), v.literal("conference"))),
    format: v.optional(v.union(v.literal("mp3"), v.literal("wav"))),
    channels: v.optional(v.union(v.literal("single"), v.literal("dual"))),
    telnyxCallControlId: v.optional(v.string()),
    telnyxCallLegId: v.optional(v.string()),
    telnyxCallSessionId: v.optional(v.string()),
    telnyxConferenceId: v.optional(v.string()),
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
    }))
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      throw new Error("Call session not found.");
    }

    const timestamp = now();
    const existing = await ctx.db
      .query("callRecordings")
      .withIndex("by_recording_id", (q) => q.eq("recordingId", args.recordingId))
      .first();

    const patch = {
      callSessionId: args.callSessionId,
      entityId: callSession.entityId,
      ownerTokenIdentifier: callSession.ownerTokenIdentifier,
      provider: "telnyx" as const,
      recordingId: args.recordingId,
      status: args.status ?? ("ready" as const),
      source: args.source,
      format: args.format,
      channels: args.channels,
      telnyxCallControlId: args.telnyxCallControlId,
      telnyxCallLegId: args.telnyxCallLegId,
      telnyxCallSessionId: args.telnyxCallSessionId,
      telnyxConferenceId: args.telnyxConferenceId,
      recordingStartedAt: args.recordingStartedAt,
      recordingEndedAt: args.recordingEndedAt,
      durationMs: args.durationMs,
      recordingUrls: args.recordingUrls,
      publicRecordingUrls: args.publicRecordingUrls,
      updatedAt: timestamp
    };

    const recordingDocId = existing
      ? existing._id
      : await ctx.db.insert("callRecordings", {
        ...patch,
        createdAt: timestamp
      });

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    }

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "telnyx",
      type: "call.recording.saved",
      message: "Telnyx saved the call recording.",
      metadata: {
        recordingId: args.recordingId,
        recordingDocId
      },
      createdAt: timestamp
    });

    return { recordingDocId };
  }
});

export const generateRecordingUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAuthenticatedIdentity(ctx);
    return await ctx.storage.generateUploadUrl();
  }
});

export const createUploadedRecordingCall = mutation({
  args: {
    workerToken: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.float64(),
    entityName: v.optional(v.string()),
    industryProfile: v.optional(industryProfile)
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    const identity = await requireAuthenticatedIdentity(ctx);
    const timestamp = now();
    const entity = await ensureOwnerWorkspace(ctx, {
      ownerTokenIdentifier: identity.tokenIdentifier,
      timestamp
    });
    if (!entity) {
      throw new Error("Workspace not found.");
    }

    const callSessionId = await ctx.db.insert("callSessions", {
      entityId: entity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      mode: "uploaded_recording",
      status: "processing",
      industryProfile: args.industryProfile ?? entity.defaultIndustryProfile ?? "general",
      consentMode: "owner_acknowledgment",
      startedAt: timestamp,
      endedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const externalEntityId = await upsertExternalEntityForCall(ctx, {
      workspaceEntityId: entity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      callSessionId,
      name: args.entityName,
      timestamp
    });

    await ctx.db.insert("uploadedRecordings", {
      callSessionId,
      entityId: entity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      storageId: args.storageId,
      fileName: safeUploadedFileName(args.fileName),
      mimeType: args.mimeType || "application/octet-stream",
      sizeBytes: args.sizeBytes,
      status: "uploaded",
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("callRecordings", {
      callSessionId,
      entityId: entity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      provider: "convex_storage",
      recordingId: String(args.storageId),
      storageId: args.storageId,
      status: "ready",
      source: "upload",
      format: audioFormatFromMime(args.mimeType),
      fileName: safeUploadedFileName(args.fileName),
      mimeType: args.mimeType || "application/octet-stream",
      sizeBytes: args.sizeBytes,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: entity._id,
      callSessionId,
      actor: "owner",
      type: "recording.uploaded",
      message: "Owner uploaded a recording for transcription and notes.",
      metadata: {
        storageId: args.storageId,
        fileName: safeUploadedFileName(args.fileName),
        sizeBytes: args.sizeBytes,
        externalEntityId
      },
      createdAt: timestamp
    });

    return { callSessionId };
  }
});

export const createVexaMeetingCall = mutation({
  args: {
    platform: vexaMeetingPlatform,
    nativeMeetingId: v.string(),
    meetingUrl: v.optional(v.string()),
    botName: v.optional(v.string()),
    language: v.optional(v.string()),
    entityName: v.optional(v.string()),
    callFocusText: v.optional(v.string()),
    industryProfile: v.optional(industryProfile)
  },
  handler: async (ctx, args) => {
    requireFeature("vexa");
    const identity = await requireAuthenticatedIdentity(ctx);
    const timestamp = now();
    const entity = await ensureOwnerWorkspace(ctx, {
      ownerTokenIdentifier: identity.tokenIdentifier,
      timestamp
    });
    if (!entity) {
      throw new Error("Workspace not found.");
    }

    const callSessionId = await ctx.db.insert("callSessions", {
      entityId: entity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      mode: "vexa_meeting",
      status: "connecting",
      industryProfile: args.industryProfile ?? entity.defaultIndustryProfile ?? "general",
      consentMode: "owner_acknowledgment",
      callFocusText: cleanText(args.callFocusText, 500),
      callFocusInputMethod: args.callFocusText ? "typed" : undefined,
      startedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const externalEntityId = await upsertExternalEntityForCall(ctx, {
      workspaceEntityId: entity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      callSessionId,
      name: args.entityName ?? `${vexaPlatformLabel(args.platform)} meeting`,
      timestamp
    });

    const captureId = await ctx.db.insert("vexaMeetingCaptures", {
      callSessionId,
      entityId: entity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      platform: args.platform,
      nativeMeetingId: cleanText(args.nativeMeetingId, 240) ?? args.nativeMeetingId,
      meetingUrl: cleanText(args.meetingUrl, 500),
      botName: cleanText(args.botName, 120),
      language: cleanText(args.language, 24),
      status: "requested",
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: entity._id,
      callSessionId,
      actor: "owner",
      type: "vexa.meeting_requested",
      message: "Owner asked Sidetone to join a meeting with Vexa.",
      metadata: {
        captureId,
        platform: args.platform,
        nativeMeetingId: args.nativeMeetingId,
        externalEntityId
      },
      createdAt: timestamp
    });

    return { callSessionId, captureId };
  }
});

export const createZoomRtmsMeetingCall = mutation({
  args: {
    zoomMeetingId: v.string(),
    meetingUrl: v.optional(v.string()),
    entityName: v.optional(v.string()),
    callFocusText: v.optional(v.string()),
    industryProfile: v.optional(industryProfile)
  },
  handler: async (ctx, args) => {
    requireFeature("zoom");
    const identity = await requireAuthenticatedIdentity(ctx);
    const timestamp = now();
    const entity = await ensureOwnerWorkspace(ctx, {
      ownerTokenIdentifier: identity.tokenIdentifier,
      timestamp
    });
    if (!entity) {
      throw new Error("Workspace not found.");
    }

    const callSessionId = await ctx.db.insert("callSessions", {
      entityId: entity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      mode: "zoom_rtms",
      status: "connecting",
      industryProfile: args.industryProfile ?? entity.defaultIndustryProfile ?? "general",
      consentMode: "owner_acknowledgment",
      callFocusText: cleanText(args.callFocusText, 500),
      callFocusInputMethod: args.callFocusText ? "typed" : undefined,
      startedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const externalEntityId = await upsertExternalEntityForCall(ctx, {
      workspaceEntityId: entity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      callSessionId,
      name: args.entityName ?? "Zoom meeting",
      timestamp
    });

    const captureId = await ctx.db.insert("zoomRtmsCaptures", {
      callSessionId,
      entityId: entity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      zoomMeetingId: cleanText(args.zoomMeetingId, 80) ?? args.zoomMeetingId,
      meetingUrl: cleanText(args.meetingUrl, 500),
      status: "waiting",
      transcriptSegmentCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: entity._id,
      callSessionId,
      actor: "owner",
      type: "zoom_rtms.meeting_requested",
      message: "Owner asked Sidetone to listen for Zoom RTMS.",
      metadata: {
        captureId,
        zoomMeetingId: args.zoomMeetingId,
        externalEntityId
      },
      createdAt: timestamp
    });

    return { callSessionId, captureId };
  }
});

export const zoomRtmsStartAuthorization = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const entity = await ctx.db
      .query("entityProfiles")
      .withIndex("by_owner", (q) => q.eq("ownerTokenIdentifier", identity.tokenIdentifier))
      .first();
    if (!entity) {
      return {
        ok: false,
        code: "workspace_missing",
        error: "Finish Sidetone setup before starting Zoom RTMS."
      };
    }

    const installation = await ctx.db
      .query("zoomInstallations")
      .withIndex("by_owner_entity_status", (q) => q.eq("ownerTokenIdentifier", identity.tokenIdentifier).eq("entityId", entity._id).eq("status", "active"))
      .order("desc")
      .first();
    if (!installation) {
      return {
        ok: false,
        code: "zoom_not_connected",
        error: "Connect Zoom from Sources before starting a Zoom RTMS meeting."
      };
    }
    const hasStoredToken = Boolean(installation.accessToken && installation.refreshToken);
    const hasStartScope = hasZoomRtmsStartScope(installation.scopes);
    if (!hasStoredToken && !hasStartScope) {
      return {
        ok: false,
        code: "zoom_reconnect_required",
        error: `The Zoom app install is missing ${REQUIRED_ZOOM_RTMS_START_SCOPE} and does not have a stored RTMS token. Add that scope in Zoom, then reconnect Zoom from Sources.`
      };
    }
    if (!hasStoredToken) {
      return {
        ok: false,
        code: "zoom_reconnect_required",
        error: "Reconnect Zoom from Sources so Sidetone can store the Zoom RTMS token."
      };
    }
    if (!hasStartScope) {
      return {
        ok: false,
        code: "zoom_scope_missing",
        error: `The Zoom app install is missing ${REQUIRED_ZOOM_RTMS_START_SCOPE}. Add that scope in Zoom, then reconnect Zoom from Sources.`
      };
    }

    return {
      ok: true,
      code: "ready",
      scopes: installation.scopes ?? []
    };
  }
});

export const markVexaMeetingBotRequested = mutation({
  args: {
    callSessionId: v.id("callSessions"),
    vexaMeetingId: v.optional(v.float64()),
    vexaStatus: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Meeting capture not found.");
    }
    const capture = await ctx.db
      .query("vexaMeetingCaptures")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    if (!capture) {
      throw new Error("Vexa meeting capture not found.");
    }

    const timestamp = now();
    await ctx.db.patch(capture._id, {
      status: "joining",
      vexaMeetingId: args.vexaMeetingId,
      vexaStatus: cleanText(args.vexaStatus, 120),
      updatedAt: timestamp
    });
    await ctx.db.patch(args.callSessionId, {
      status: "connecting",
      updatedAt: timestamp
    });
    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "vexa",
      type: "vexa.bot_requested",
      message: "Vexa accepted the meeting bot request.",
      metadata: {
        captureId: capture._id,
        vexaMeetingId: args.vexaMeetingId,
        vexaStatus: args.vexaStatus
      },
      createdAt: timestamp
    });
    return { captureId: capture._id };
  }
});

export const markVexaMeetingRequestFailed = mutation({
  args: {
    callSessionId: v.id("callSessions"),
    error: v.string()
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Meeting capture not found.");
    }
    return await markVexaMeetingFailed(ctx, args.callSessionId, args.error);
  }
});

export const vexaMeetingStopTarget = query({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.ownerTokenIdentifier !== identity.tokenIdentifier || callSession.mode !== "vexa_meeting") {
      throw new Error("Vexa meeting capture not found.");
    }
    const capture = await ctx.db
      .query("vexaMeetingCaptures")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    if (!capture) {
      throw new Error("Vexa meeting capture not found.");
    }
    return {
      callSessionId: args.callSessionId,
      platform: capture.platform,
      nativeMeetingId: capture.nativeMeetingId,
      callStatus: callSession.status,
      captureStatus: capture.status
    };
  }
});

export const markVexaMeetingStopRequested = mutation({
  args: {
    callSessionId: v.id("callSessions"),
    vexaStatus: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.ownerTokenIdentifier !== identity.tokenIdentifier || callSession.mode !== "vexa_meeting") {
      throw new Error("Vexa meeting capture not found.");
    }
    const capture = await ctx.db
      .query("vexaMeetingCaptures")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    if (!capture) {
      throw new Error("Vexa meeting capture not found.");
    }

    const timestamp = now();
    await ctx.db.patch(capture._id, {
      status: capture.status === "ready" || capture.status === "failed" ? capture.status : "processing",
      vexaStatus: cleanText(args.vexaStatus, 120) ?? capture.vexaStatus,
      updatedAt: timestamp
    });
    await ctx.db.patch(args.callSessionId, {
      status: callSession.status === "ready" || callSession.status === "failed" ? callSession.status : "processing",
      endedAt: callSession.endedAt ?? timestamp,
      updatedAt: timestamp
    });
    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "owner",
      type: "vexa.stop_requested",
      message: "Owner asked Sidetone to end meeting notes.",
      metadata: {
        captureId: capture._id,
        platform: capture.platform,
        nativeMeetingId: capture.nativeMeetingId,
        vexaStatus: args.vexaStatus
      },
      createdAt: timestamp
    });
    return { captureId: capture._id };
  }
});

async function markVexaMeetingFailed(ctx: any, callSessionId: any, error: string) {
  const callSession = await ctx.db.get(callSessionId);
  const timestamp = now();
  const capture = await ctx.db
    .query("vexaMeetingCaptures")
    .withIndex("by_call_session", (q: any) => q.eq("callSessionId", callSessionId))
    .first();
  if (capture) {
    await ctx.db.patch(capture._id, {
      status: "failed",
      error: cleanText(error, 500) ?? "Vexa meeting capture failed.",
      updatedAt: timestamp
    });
  }
  if (callSession) {
    await ctx.db.patch(callSessionId, {
      status: "failed",
      failureReason: cleanText(error, 500) ?? "Vexa meeting capture failed.",
      endedAt: callSession.endedAt ?? timestamp,
      updatedAt: timestamp
    });
    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId,
      actor: "vexa",
      type: "vexa.meeting_failed",
      message: "Vexa meeting capture failed.",
      metadata: { error },
      createdAt: timestamp
    });
  }
  return { updated: Boolean(callSession || capture) };
}

export const prepareUploadedRecordingProcessingInternal = internalAction({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const upload: any = await ctx.runMutation(internal.calls.markUploadedRecordingProcessingInternal, {
      callSessionId: args.callSessionId
    });
    const storageUrl = await ctx.storage.getUrl(upload.storageId);
    if (!storageUrl) {
      throw new Error("Uploaded recording file is not available.");
    }
    return {
      callSessionId: args.callSessionId,
      storageUrl,
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes
    };
  }
});

export const markUploadedRecordingProcessingInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || !isStoredRecordingMode(callSession.mode)) {
      throw new Error("Stored recording not found.");
    }
    const upload = await ctx.db
      .query("uploadedRecordings")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    if (!upload) {
      throw new Error("Uploaded recording file not found.");
    }
    const timestamp = now();
    await ctx.db.patch(upload._id, {
      status: "transcribing",
      error: undefined,
      updatedAt: timestamp
    });
    await ctx.db.patch(args.callSessionId, {
      status: "processing",
      updatedAt: timestamp
    });
    return upload;
  }
});

export const recordUploadedRecordingTranscriptInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    assemblyAiTranscriptId: v.optional(v.string()),
    segments: v.array(v.object({
      text: v.string(),
      startMs: v.float64(),
      endMs: v.float64(),
      speakerLabel: v.optional(v.string()),
      confidence: v.optional(v.float64())
    }))
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || !isStoredRecordingMode(callSession.mode)) {
      throw new Error("Stored recording not found.");
    }
    const upload = await ctx.db
      .query("uploadedRecordings")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    if (!upload) {
      throw new Error("Uploaded recording file not found.");
    }

    const existingSegments = await readTranscript(ctx, args.callSessionId);
    await Promise.all(existingSegments.map((segment) => ctx.db.delete(segment._id)));

    const timestamp = now();
    const segmentIds = await Promise.all(normalizeSegments(args.segments)
      .filter((segment) => segment.text.trim())
      .map((segment) => ctx.db.insert("transcriptSegments", {
        callSessionId: args.callSessionId,
        entityId: callSession.entityId,
        provider: "assemblyai" as const,
        speakerLabel: segment.speakerLabel,
        speakerTrack: "mixed" as const,
        text: segment.text.trim(),
        startMs: Math.max(0, segment.startMs),
        endMs: Math.max(segment.startMs, segment.endMs),
        confidence: segment.confidence,
        isFinal: true,
        createdAt: timestamp
      })));

    await ctx.db.patch(callSession._id, { storedTranscriptSegmentCount: segmentIds.length });
    await ctx.db.patch(upload._id, {
      status: "generating_notes",
      assemblyAiTranscriptId: args.assemblyAiTranscriptId,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "assemblyai",
      type: "recording.transcribed",
      message: "AssemblyAI transcribed an uploaded recording.",
      metadata: {
        assemblyAiTranscriptId: args.assemblyAiTranscriptId,
        transcriptSegmentCount: segmentIds.length
      },
      createdAt: timestamp
    });

    return { segmentIds };
  }
});

export const finalizeUploadedRecordingInternal = internalAction({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const result = await generateCallArtifactFromTranscriptHandler(ctx, args);
    await ctx.runMutation(internal.calls.markUploadedRecordingReadyInternal, {
      callSessionId: args.callSessionId,
      status: result.status === "waiting_for_transcript" ? "failed" : "ready",
      error: result.status === "waiting_for_transcript"
        ? "No transcript was returned for the uploaded recording."
        : result.error
    });
    return result;
  }
});

export const markUploadedRecordingReadyInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    status: v.union(v.literal("ready"), v.literal("failed")),
    error: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    const upload = await ctx.db
      .query("uploadedRecordings")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    if (!upload) {
      throw new Error("Uploaded recording file not found.");
    }
    const timestamp = now();
    await ctx.db.patch(upload._id, {
      status: args.status,
      error: args.error,
      updatedAt: timestamp
    });
    if (callSession?.mode === "discord_voice") {
      const capture = await ctx.db
        .query("discordVoiceCaptures")
        .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
        .first();
      if (capture) {
        await ctx.db.patch(capture._id, {
          status: args.status,
          error: args.error,
          updatedAt: timestamp
        });
      }
    }
    return { uploadId: upload._id };
  }
});

export const markUploadedRecordingFailedInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    error: v.string()
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || !isStoredRecordingMode(callSession.mode)) {
      return { updated: false };
    }
    const upload = await ctx.db
      .query("uploadedRecordings")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    const timestamp = now();
    if (upload) {
      await ctx.db.patch(upload._id, {
        status: "failed",
        error: args.error,
        updatedAt: timestamp
      });
    }
    await ctx.db.patch(args.callSessionId, {
      status: "failed",
      failureReason: args.error,
      updatedAt: timestamp
    });
    if (callSession.mode === "discord_voice") {
      const capture = await ctx.db
        .query("discordVoiceCaptures")
        .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
        .first();
      if (capture) {
        await ctx.db.patch(capture._id, {
          status: "failed",
          error: args.error,
          updatedAt: timestamp
        });
      }
    }
    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "system",
      type: "recording.upload_processing_failed",
      message: "Sidetone could not process the uploaded recording.",
      metadata: {
        error: args.error
      },
      createdAt: timestamp
    });
    return { updated: true };
  }
});

export const prepareVexaMeetingProcessingInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.mode !== "vexa_meeting") {
      throw new Error("Vexa meeting capture not found.");
    }
    const capture = await ctx.db
      .query("vexaMeetingCaptures")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    if (!capture) {
      throw new Error("Vexa meeting capture not found.");
    }

    const timestamp = now();
    await ctx.db.patch(capture._id, {
      status: capture.status === "requested" ? "joining" : capture.status,
      error: undefined,
      updatedAt: timestamp
    });
    await ctx.db.patch(args.callSessionId, {
      status: callSession.status === "processing" || callSession.status === "ready" || callSession.status === "failed"
        ? callSession.status
        : "connecting",
      updatedAt: timestamp
    });
    return {
      callSessionId: args.callSessionId,
      platform: capture.platform,
      nativeMeetingId: capture.nativeMeetingId,
      vexaMeetingId: capture.vexaMeetingId
    };
  }
});

export const recordVexaMeetingTranscriptInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    provider: v.optional(v.union(v.literal("vexa"), v.literal("assemblyai"))),
    assemblyAiTranscriptId: v.optional(v.string()),
    vexaStatus: v.optional(v.string()),
    segments: v.array(v.object({
      text: v.string(),
      startMs: v.float64(),
      endMs: v.float64(),
      speakerLabel: v.optional(v.string()),
      confidence: v.optional(v.float64()),
      isFinal: v.optional(v.boolean())
    }))
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.mode !== "vexa_meeting") {
      throw new Error("Vexa meeting capture not found.");
    }
    const capture = await ctx.db
      .query("vexaMeetingCaptures")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    if (!capture) {
      throw new Error("Vexa meeting capture not found.");
    }

    const existingSegments = await readTranscript(ctx, args.callSessionId);
    await Promise.all(existingSegments.map((segment) => ctx.db.delete(segment._id)));

    const timestamp = now();
    const provider = args.provider ?? ("vexa" as const);
    const segmentIds = await Promise.all(normalizeSegments(args.segments)
      .filter((segment) => segment.text.trim())
      .map((segment) => ctx.db.insert("transcriptSegments", {
        callSessionId: args.callSessionId,
        entityId: callSession.entityId,
        provider,
        speakerLabel: cleanText(segment.speakerLabel, 120),
        speakerTrack: "mixed" as const,
        text: segment.text.trim(),
        startMs: Math.max(0, segment.startMs),
        endMs: Math.max(segment.startMs, segment.endMs),
        confidence: segment.confidence,
        isFinal: segment.isFinal ?? true,
        createdAt: timestamp
      })));

    await ctx.db.patch(capture._id, {
      status: segmentIds.length ? "transcribing" : "processing",
      vexaStatus: cleanText(args.vexaStatus, 120),
      lastTranscriptAt: segmentIds.length ? timestamp : capture.lastTranscriptAt,
      segmentCount: segmentIds.length,
      updatedAt: timestamp
    });
    await ctx.db.patch(args.callSessionId, {
      status: callSession.status === "processing" || callSession.status === "ready" || callSession.status === "failed"
        ? callSession.status
        : "live",
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: provider === "assemblyai" ? "assemblyai" : "vexa",
      type: provider === "assemblyai" ? "vexa.recording_transcribed" : "vexa.transcript_updated",
      message: provider === "assemblyai"
        ? "AssemblyAI transcribed the Vexa meeting recording."
        : "Vexa updated the meeting transcript.",
      metadata: {
        assemblyAiTranscriptId: args.assemblyAiTranscriptId,
        vexaStatus: args.vexaStatus,
        transcriptSegmentCount: segmentIds.length
      },
      createdAt: timestamp
    });

    return { segmentIds };
  }
});

export const recordVexaMeetingRecordingInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    vexaRecordingId: v.string(),
    vexaMeetingId: v.optional(v.string()),
    vexaMediaFileId: v.string(),
    status: v.optional(v.union(v.literal("ready"), v.literal("failed"))),
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
    recordingStartedAt: v.optional(v.float64()),
    recordingEndedAt: v.optional(v.float64()),
    durationMs: v.optional(v.float64())
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.mode !== "vexa_meeting") {
      throw new Error("Vexa meeting capture not found.");
    }

    const timestamp = now();
    const existing = (
      await ctx.db
        .query("callRecordings")
        .withIndex("by_recording_id", (q) => q.eq("recordingId", args.vexaRecordingId))
        .take(20)
    ).find((recording) =>
      recording.provider === "vexa"
      && recording.callSessionId === args.callSessionId
    );

    const patch = {
      callSessionId: args.callSessionId,
      entityId: callSession.entityId,
      ownerTokenIdentifier: callSession.ownerTokenIdentifier,
      provider: "vexa" as const,
      recordingId: args.vexaRecordingId,
      status: args.status ?? ("ready" as const),
      source: "vexa_meeting" as const,
      format: args.format,
      fileName: cleanText(args.fileName, 160),
      mimeType: cleanText(args.mimeType, 120),
      sizeBytes: args.sizeBytes,
      vexaMeetingId: cleanText(args.vexaMeetingId, 80),
      vexaMediaFileId: cleanText(args.vexaMediaFileId, 80),
      recordingStartedAt: args.recordingStartedAt,
      recordingEndedAt: args.recordingEndedAt,
      durationMs: args.durationMs,
      updatedAt: timestamp
    };

    const recordingDocId = existing
      ? existing._id
      : await ctx.db.insert("callRecordings", {
        ...patch,
        createdAt: timestamp
      });

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    }

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "vexa",
      type: "vexa.recording.saved",
      message: "Vexa saved the meeting recording.",
      metadata: {
        vexaRecordingId: args.vexaRecordingId,
        vexaMeetingId: args.vexaMeetingId,
        vexaMediaFileId: args.vexaMediaFileId,
        recordingDocId
      },
      createdAt: timestamp
    });

    return { recordingDocId };
  }
});

export const finalizeVexaMeetingInternal = internalAction({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const result = await generateCallArtifactFromTranscriptHandler(ctx, args);
    await ctx.runMutation(internal.calls.markVexaMeetingReadyInternal, {
      callSessionId: args.callSessionId,
      status: result.status === "waiting_for_transcript" ? "failed" : "ready",
      error: result.status === "waiting_for_transcript"
        ? "No transcript was returned for the Vexa meeting."
        : result.error
    });
    return result;
  }
});

export const markVexaMeetingReadyInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    status: v.union(v.literal("ready"), v.literal("failed")),
    error: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.mode !== "vexa_meeting") {
      throw new Error("Vexa meeting capture not found.");
    }
    const capture = await ctx.db
      .query("vexaMeetingCaptures")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    const timestamp = now();
    if (capture) {
      await ctx.db.patch(capture._id, {
        status: args.status,
        error: args.error,
        updatedAt: timestamp
      });
    }
    await ctx.db.patch(args.callSessionId, {
      status: args.status,
      failureReason: args.status === "failed" ? args.error : undefined,
      endedAt: callSession.endedAt ?? timestamp,
      updatedAt: timestamp
    });
    return { captureId: capture?._id };
  }
});

export const markVexaMeetingFailedInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    error: v.string()
  },
  handler: async (ctx, args) => {
    return await markVexaMeetingFailed(ctx, args.callSessionId, args.error);
  }
});

export const claimZoomRtmsStartInternal = internalMutation({
  args: {
    zoomMeetingId: v.string(),
    zoomMeetingUuid: v.optional(v.string()),
    rtmsStreamId: v.string(),
    serverUrls: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const captures = await ctx.db
      .query("zoomRtmsCaptures")
      .withIndex("by_zoom_meeting", (q) => q.eq("zoomMeetingId", args.zoomMeetingId))
      .take(32);
    const capture = captures
      .filter((candidate) => ["waiting", "streaming"].includes(candidate.status))
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    if (!capture) {
      throw new Error(`No waiting Zoom RTMS capture found for meeting ${args.zoomMeetingId}.`);
    }

    const callSession = await ctx.db.get(capture.callSessionId);
    if (!callSession || callSession.mode !== "zoom_rtms") {
      throw new Error("Zoom RTMS call session not found.");
    }

    const timestamp = now();
    await ctx.db.patch(capture._id, {
      status: "streaming",
      zoomMeetingUuid: cleanText(args.zoomMeetingUuid, 240) ?? capture.zoomMeetingUuid,
      rtmsStreamId: cleanText(args.rtmsStreamId, 160),
      serverUrls: cleanText(args.serverUrls, 1000),
      startedAt: capture.startedAt ?? timestamp,
      updatedAt: timestamp
    });
    await ctx.db.patch(capture.callSessionId, {
      status: "live",
      startedAt: callSession.startedAt ?? timestamp,
      updatedAt: timestamp
    });
    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: capture.callSessionId,
      actor: "zoom",
      type: "zoom_rtms.started",
      message: "Zoom started the RTMS stream.",
      metadata: {
        captureId: capture._id,
        zoomMeetingId: args.zoomMeetingId,
        zoomMeetingUuid: args.zoomMeetingUuid,
        rtmsStreamId: args.rtmsStreamId
      },
      createdAt: timestamp
    });

    return {
      captureId: capture._id,
      callSessionId: capture.callSessionId,
      ownerTokenIdentifier: callSession.ownerTokenIdentifier
    };
  }
});

export const zoomRtmsOauthForCallInternal = internalQuery({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.mode !== "zoom_rtms") {
      throw new Error("Zoom RTMS call session not found.");
    }

    const installation = await ctx.db
      .query("zoomInstallations")
      .withIndex("by_owner_entity_status", (q) => q.eq("ownerTokenIdentifier", callSession.ownerTokenIdentifier).eq("entityId", callSession.entityId).eq("status", "active"))
      .order("desc")
      .first();

    return installation
      ? {
        installationId: installation._id,
        zoomClientId: installation.zoomClientId,
        accessToken: installation.accessToken,
        refreshToken: installation.refreshToken,
        tokenType: installation.tokenType,
        scopes: installation.scopes ?? [],
        expiresAt: installation.expiresAt
      }
      : null;
  }
});

export const updateZoomOauthTokensInternal = internalMutation({
  args: {
    installationId: v.id("zoomInstallations"),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    tokenType: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
    expiresInSeconds: v.optional(v.float64())
  },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get(args.installationId);
    if (!installation) {
      throw new Error("Zoom installation not found.");
    }

    const timestamp = now();
    await ctx.db.patch(args.installationId, {
      accessToken: args.accessToken,
      refreshToken: args.refreshToken ?? installation.refreshToken,
      tokenType: args.tokenType ?? installation.tokenType,
      scopes: args.scopes ?? installation.scopes,
      expiresAt: args.expiresInSeconds ? timestamp + args.expiresInSeconds * 1000 : installation.expiresAt,
      updatedAt: timestamp
    });

    return { installationId: args.installationId };
  }
});

export const markZoomRtmsStartRequestedInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.mode !== "zoom_rtms") {
      throw new Error("Zoom RTMS call session not found.");
    }

    const capture = await ctx.db
      .query("zoomRtmsCaptures")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    const timestamp = now();
    await ctx.db.patch(args.callSessionId, {
      status: "connecting",
      updatedAt: timestamp
    });
    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "zoom",
      type: "zoom_rtms.start_requested",
      message: "Sidetone asked Zoom to start RTMS for the live meeting.",
      metadata: {
        captureId: capture?._id,
        zoomMeetingId: capture?.zoomMeetingId
      },
      createdAt: timestamp
    });

    return { captureId: capture?._id };
  }
});

export const appendZoomRtmsTranscriptSegmentInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    text: v.string(),
    speakerLabel: v.optional(v.string()),
    startMs: v.float64(),
    endMs: v.float64(),
    confidence: v.optional(v.float64()),
    isFinal: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.mode !== "zoom_rtms") {
      throw new Error("Zoom RTMS call session not found.");
    }
    const capture = await ctx.db
      .query("zoomRtmsCaptures")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    if (!capture) {
      throw new Error("Zoom RTMS capture not found.");
    }
    const text = args.text.trim();
    if (!text) {
      return { segmentId: undefined };
    }

    if (Array.from(args.text).length > 1024) throw new Error("Transcript segment exceeds 1024 characters.");
    const storedCount = callSession.storedTranscriptSegmentCount ?? 0;
    if (storedCount >= MAX_TRANSCRIPT_SEGMENTS) throw new Error("Transcript limit reached. Start a new recording.");
    await ctx.db.patch(callSession._id, { storedTranscriptSegmentCount: storedCount + 1 });
    const timestamp = now();
    const segmentId = await ctx.db.insert("transcriptSegments", {
      callSessionId: args.callSessionId,
      entityId: callSession.entityId,
      provider: "zoom_rtms" as const,
      speakerLabel: cleanText(args.speakerLabel, 120),
      speakerTrack: "mixed" as const,
      text,
      startMs: Math.max(0, args.startMs),
      endMs: Math.max(args.startMs + 1, args.endMs),
      confidence: args.confidence,
      isFinal: args.isFinal ?? true,
      createdAt: timestamp
    });

    const nextCount = (capture.transcriptSegmentCount ?? 0) + 1;
    await ctx.db.patch(capture._id, {
      status: capture.status === "waiting" ? "streaming" : capture.status,
      lastTranscriptAt: timestamp,
      transcriptSegmentCount: nextCount,
      updatedAt: timestamp
    });
    await ctx.db.patch(args.callSessionId, {
      status: callSession.status === "processing" || callSession.status === "ready" || callSession.status === "failed"
        ? callSession.status
        : "live",
      updatedAt: timestamp
    });

    await ctx.scheduler.runAfter(0, internal.intelligence.enqueueLiveCardSegmentInternal, {
      callSessionId: args.callSessionId,
      segmentId
    });

    return { segmentId, segmentCount: nextCount };
  }
});

export const completeZoomRtmsRecordingInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    storageId: v.id("_storage"),
    recordingId: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.float64(),
    format: v.optional(v.union(
      v.literal("mp3"),
      v.literal("wav"),
      v.literal("m4a"),
      v.literal("webm"),
      v.literal("ogg")
    )),
    recordingStartedAt: v.optional(v.float64()),
    recordingEndedAt: v.optional(v.float64()),
    durationMs: v.optional(v.float64())
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.mode !== "zoom_rtms") {
      throw new Error("Zoom RTMS call session not found.");
    }
    const capture = await ctx.db
      .query("zoomRtmsCaptures")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    if (!capture) {
      throw new Error("Zoom RTMS capture not found.");
    }

    const timestamp = now();
    const existing = (
      await ctx.db
        .query("callRecordings")
        .withIndex("by_recording_id", (q) => q.eq("recordingId", args.recordingId))
        .take(20)
    ).find((recording) =>
      recording.provider === "zoom_rtms"
      && recording.callSessionId === args.callSessionId
    );

    const patch = {
      callSessionId: args.callSessionId,
      entityId: callSession.entityId,
      ownerTokenIdentifier: callSession.ownerTokenIdentifier,
      provider: "zoom_rtms" as const,
      recordingId: cleanText(args.recordingId, 160) ?? args.recordingId,
      storageId: args.storageId,
      status: "ready" as const,
      source: "zoom_rtms" as const,
      format: args.format,
      fileName: cleanText(args.fileName, 160),
      mimeType: cleanText(args.mimeType, 120),
      sizeBytes: args.sizeBytes,
      recordingStartedAt: args.recordingStartedAt,
      recordingEndedAt: args.recordingEndedAt,
      durationMs: args.durationMs,
      updatedAt: timestamp
    };

    const recordingDocId = existing
      ? existing._id
      : await ctx.db.insert("callRecordings", {
        ...patch,
        createdAt: timestamp
      });

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    }

    await ctx.db.patch(capture._id, {
      recordingId: args.recordingId,
      updatedAt: timestamp
    });
    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "zoom",
      type: "zoom_rtms.recording_saved",
      message: "Zoom RTMS audio recording was saved.",
      metadata: {
        captureId: capture._id,
        recordingDocId,
        recordingId: args.recordingId
      },
      createdAt: timestamp
    });

    return { recordingDocId };
  }
});

export const markZoomRtmsStoppedInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    reason: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.mode !== "zoom_rtms") {
      throw new Error("Zoom RTMS call session not found.");
    }
    const capture = await ctx.db
      .query("zoomRtmsCaptures")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    const timestamp = now();
    if (capture) {
      await ctx.db.patch(capture._id, {
        status: capture.status === "failed" ? "failed" : "processing",
        stoppedAt: capture.stoppedAt ?? timestamp,
        updatedAt: timestamp
      });
    }
    await ctx.db.patch(args.callSessionId, {
      status: callSession.status === "ready" || callSession.status === "failed" ? callSession.status : "processing",
      endedAt: callSession.endedAt ?? timestamp,
      updatedAt: timestamp
    });
    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "zoom",
      type: "zoom_rtms.stopped",
      message: "Zoom RTMS stream stopped.",
      metadata: {
        captureId: capture?._id,
        reason: args.reason
      },
      createdAt: timestamp
    });
    return { captureId: capture?._id };
  }
});

export const markZoomRtmsReadyInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    status: v.union(v.literal("ready"), v.literal("failed")),
    error: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.mode !== "zoom_rtms") {
      throw new Error("Zoom RTMS call session not found.");
    }
    const capture = await ctx.db
      .query("zoomRtmsCaptures")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    const timestamp = now();
    if (capture) {
      await ctx.db.patch(capture._id, {
        status: args.status,
        error: args.error,
        updatedAt: timestamp
      });
    }
    await ctx.db.patch(args.callSessionId, {
      status: args.status,
      failureReason: args.status === "failed" ? args.error : undefined,
      endedAt: callSession.endedAt ?? timestamp,
      updatedAt: timestamp
    });
    return { captureId: capture?._id };
  }
});

export const markZoomRtmsFailedInternal = internalMutation({
  args: {
    callSessionId: v.id("callSessions"),
    error: v.string()
  },
  handler: async (ctx, args) => {
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.mode !== "zoom_rtms") {
      throw new Error("Zoom RTMS call session not found.");
    }
    const capture = await ctx.db
      .query("zoomRtmsCaptures")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    const timestamp = now();
    if (capture) {
      await ctx.db.patch(capture._id, {
        status: "failed",
        error: cleanText(args.error, 500) ?? "Zoom RTMS failed.",
        stoppedAt: capture.stoppedAt ?? timestamp,
        updatedAt: timestamp
      });
    }
    await ctx.db.patch(args.callSessionId, {
      status: "failed",
      failureReason: cleanText(args.error, 500) ?? "Zoom RTMS failed.",
      endedAt: callSession.endedAt ?? timestamp,
      updatedAt: timestamp
    });
    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "zoom",
      type: "zoom_rtms.failed",
      message: "Zoom RTMS capture failed.",
      metadata: {
        captureId: capture?._id,
        error: args.error
      },
      createdAt: timestamp
    });
    return { captureId: capture?._id };
  }
});

export const finalizeZoomRtmsMeetingInternal = internalAction({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const result = await generateCallArtifactFromTranscriptHandler(ctx, args);
    await ctx.runMutation(internal.calls.markZoomRtmsReadyInternal, {
      callSessionId: args.callSessionId,
      status: result.status === "waiting_for_transcript" ? "failed" : "ready",
      error: result.status === "waiting_for_transcript"
        ? "No transcript was returned for the Zoom RTMS meeting."
        : result.error
    });
    return result;
  }
});

async function ensureShareUrlForOwnerSummary(ctx: any, callSessionId: any) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result: any = await ctx.runMutation(internal.calls.ensureCallShareForSms, {
      callSessionId,
      shareToken: makeShareToken()
    });
    if (result?.shareToken) {
      return `${sidetonePublicBaseUrl()}/shared/calls/${result.shareToken}`;
    }
  }

  throw new Error("Unable to create a share link for the call summary.");
}

async function generateCallArtifactFromTranscriptHandler(
  ctx: any,
  args: { callSessionId: any }
): Promise<{
    artifactId?: unknown;
    status: "waiting_for_transcript" | "ready" | "failed";
    modelName?: string;
    error?: string;
  }> {
    let record: any = await ctx.runQuery(internal.calls.callRecordForNotes, {
      callSessionId: args.callSessionId
    });

    const transcriptQuietMs = 8000;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const hasTranscript = Boolean(record?.transcript?.trim());
      const latestSegmentCreatedAt = Number(record?.latestSegmentCreatedAt ?? 0);
      const transcriptIsStillArriving = isPhoneCallMode(record?.callSession?.mode) && hasTranscript
        && latestSegmentCreatedAt > 0
        && Date.now() - latestSegmentCreatedAt < transcriptQuietMs;

      if (hasTranscript && !transcriptIsStillArriving) {
        break;
      }

      await sleep(hasTranscript ? 750 : 1000);
      record = await ctx.runQuery(internal.calls.callRecordForNotes, {
        callSessionId: args.callSessionId
      });
    }

    if (!record || !record.transcript.trim()) {
      return { artifactId: undefined, status: "waiting_for_transcript" as const };
    }

    let artifact: {
      title?: string;
      summary: string;
      decisions: string[];
      actionItems: string[];
      risks: string[];
      followUpDraft?: string;
      crmNoteDraft?: string;
    };
    let modelName: string;

    try {
      const generated = await generateArtifactWithOpenAI({
        transcript: record.transcript,
        industryProfile: record.callSession.industryProfile ?? "general",
        coachMode: normalizeTuningMode(record.callSession.coachMode),
        callFocusText: record.callFocusText,
        startedAt: record.callSession.startedAt
      });
      artifact = generated.artifact;
      modelName = generated.modelName;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate post-call notes.";
      console.warn("Post-call note generation failed.", message);
      const result: any = await ctx.runMutation(internal.calls.recordCallArtifactGenerationFailure, {
        callSessionId: args.callSessionId,
        error: message,
        segmentCount: record.segmentCount,
        latestSegmentCreatedAt: record.latestSegmentCreatedAt
      });
      return { ...result, status: "failed" as const, error: message };
    }

    const result: any = await ctx.runMutation(internal.calls.upsertSystemGeneratedCallArtifact, {
      callSessionId: args.callSessionId,
      artifact,
      promptVersion: modelName === "sidetone-deterministic" ? "deterministic-call-packet-v1" : "post-call-profile-gpt-v1",
      modelName,
      segmentCount: record.segmentCount,
      latestSegmentCreatedAt: record.latestSegmentCreatedAt
    });

    if (process.env.SIDETONE_SMS_ENABLED === "true" && isPhoneCallMode(record.callSession.mode) && record.ownerSummarySmsNotification?.status !== "sent") {
      const toPhoneNumber = configuredCallerPhoneForSummary(record);
      const fromPhoneNumber = ownerSummarySmsFromNumber()
        ?? record.numberAssignment?.e164
        ?? record.numberAssignment?.phoneNumber;

      if (toPhoneNumber && fromPhoneNumber) {
        try {
          const reservation: any = await ctx.runMutation(internal.calls.reserveOwnerSummarySmsNotification, {
            callSessionId: args.callSessionId,
            toPhoneNumber
          });

          if (!reservation.shouldSend) {
            return { ...result, status: "ready" as const, modelName };
          }

          const shareUrl = await ensureShareUrlForOwnerSummary(ctx, args.callSessionId);
          const smsText = buildOwnerSummarySms({ shareUrl, artifact });
          const messagingProfileId = record.numberAssignment?.telnyxMessagingProfileId?.trim()
            || process.env.TELNYX_MESSAGING_PROFILE_ID?.trim();
          if (messagingProfileId && record.numberAssignment?.telnyxPhoneNumberId) {
            await attachTelnyxNumberToMessagingProfile({
              telnyxPhoneNumberId: record.numberAssignment.telnyxPhoneNumberId,
              messagingProfileId
            });
            await ctx.runMutation(internal.calls.markNumberAssignmentMessagingAttached, {
              entityId: record.callSession.entityId,
              messagingProfileId
            });
          }

          const smsResult = await sendTelnyxSms({
            fromPhoneNumber,
            toPhoneNumber,
            text: smsText,
            messagingProfileId
          });

          await ctx.runMutation(internal.calls.recordOwnerSummarySmsNotification, {
            callSessionId: args.callSessionId,
            status: smsResult.status,
            toPhoneNumber,
            providerMessageId: smsResult.providerMessageId,
            error: smsResult.error
          });
        } catch (error) {
          await ctx.runMutation(internal.calls.recordOwnerSummarySmsNotification, {
            callSessionId: args.callSessionId,
            status: "failed",
            toPhoneNumber,
            error: error instanceof Error ? error.message : "Unable to send owner summary text."
          });
        }
      } else {
        await ctx.runMutation(internal.calls.recordOwnerSummarySmsNotification, {
          callSessionId: args.callSessionId,
          status: "skipped",
          toPhoneNumber: toPhoneNumber ?? "unknown",
          error: toPhoneNumber
            ? "Sidetone phone number is unavailable for outbound SMS."
            : "Owner phone number is unavailable for summary SMS."
        });
      }
    }

    return { ...result, status: "ready" as const, modelName };
}

export const generateCallArtifactFromTranscript = action({
  args: {
    callSessionId: v.id("callSessions"),
    workerToken: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    if (args.workerToken !== undefined) {
      requireWorkerToken(args.workerToken);
    } else {
      const record = await ctx.runQuery(api.calls.callRecordView, { callSessionId: args.callSessionId });
      if (!record) throw new Error("Call session not found.");
    }
    return await generateCallArtifactFromTranscriptHandler(ctx, { callSessionId: args.callSessionId });
  }
});

export const generateCallArtifactFromTranscriptInternal = internalAction({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: generateCallArtifactFromTranscriptHandler
});

export const appendTranscriptSegmentFromRealtime = mutation({
  args: {
    workerToken: v.string(),
    callSessionId: v.id("callSessions"),
    provider: v.union(v.literal("assemblyai"), v.literal("telnyx"), v.literal("other")),
    speakerTrack: v.union(v.literal("inbound"), v.literal("outbound"), v.literal("mixed"), v.literal("unknown")),
    speakerLabel: v.optional(v.string()),
    text: v.string(),
    startMs: v.float64(),
    endMs: v.float64(),
    confidence: v.optional(v.float64()),
    isFinal: v.boolean()
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      throw new Error("Call session not found.");
    }

    if (Array.from(args.text).length > 1024) throw new Error("Transcript segment exceeds 1024 characters.");
    const storedCount = callSession.storedTranscriptSegmentCount ?? 0;
    if (storedCount >= MAX_TRANSCRIPT_SEGMENTS) throw new Error("Transcript limit reached. Start a new recording.");
    await ctx.db.patch(callSession._id, { storedTranscriptSegmentCount: storedCount + 1 });
    const timestamp = now();
    const segmentId = await ctx.db.insert("transcriptSegments", {
      callSessionId: args.callSessionId,
      entityId: callSession.entityId,
      provider: args.provider,
      speakerLabel: args.speakerLabel,
      speakerTrack: args.speakerTrack,
      text: args.text,
      startMs: args.startMs,
      endMs: args.endMs,
      confidence: args.confidence,
      isFinal: args.isFinal,
      createdAt: timestamp
    });

    await ctx.scheduler.runAfter(0, internal.intelligence.enqueueLiveCardSegmentInternal, {
      callSessionId: args.callSessionId,
      segmentId
    });

    if (callSession.status === "ready" || callSession.status === "processing") {
      const existingArtifact = await ctx.db
        .query("callArtifacts")
        .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
        .first();
      const segmentCount = storedCount + 1;
      const artifactSegmentCount = existingArtifact?.transcriptSegmentCount ?? 0;
      const shouldRefresh = !existingArtifact || (
        existingArtifact.status === "ready"
        && segmentCount > artifactSegmentCount
      );

      if (shouldRefresh) {
        if (existingArtifact) {
          await ctx.db.patch(existingArtifact._id, {
            status: "draft",
            updatedAt: timestamp
          });
        }
        await ctx.db.patch(args.callSessionId, {
          status: "processing",
          updatedAt: timestamp
        });
        await ctx.scheduler.runAfter(10_000, internal.calls.generateCallArtifactFromTranscriptInternal, {
          callSessionId: args.callSessionId
        });
        await ctx.db.insert("auditEvents", {
          entityId: callSession.entityId,
          callSessionId: args.callSessionId,
          actor: "system",
          type: "call_artifact.transcript_updated",
          message: "Sidetone received more transcript after notes were generated and scheduled a refresh.",
          metadata: {
            priorTranscriptSegmentCount: artifactSegmentCount,
            transcriptSegmentCount: segmentCount,
            artifactId: existingArtifact?._id
          },
          createdAt: timestamp
        });
      }
    }

    return { segmentId };
  }
});

export const callSessionForRealtime = query({
  args: {
    workerToken: v.string(),
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    requireWorkerToken(args.workerToken);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession) {
      return null;
    }

    return {
      mode: callSession.mode,
      industryProfile: callSession.industryProfile ?? "general",
      coachMode: callSession.coachMode,
      status: callSession.status
    };
  }
});

export const callSessionLiveView = query({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.ownerTokenIdentifier !== identity.tokenIdentifier) {
      return null;
    }

    const entity = await ctx.db.get(callSession.entityId);
    const segments = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_call_session_time", (q) => q.eq("callSessionId", args.callSessionId))
      .order("desc")
      .take(12);
    const conversationCards = await ctx.db
      .query("conversationCards")
      .withIndex("by_call_session_status", (q) => q.eq("callSessionId", args.callSessionId).eq("status", "new"))
      .order("desc")
      .take(3);
    const artifact = await ctx.db
      .query("callArtifacts")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    const recordings = await ctx.db
      .query("callRecordings")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .order("desc")
      .take(20);
    const legs = await ctx.db
      .query("callLegs")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .take(16);

    return {
      callSession,
      entity,
      segments: segments.reverse(),
      cards: conversationCards,
      artifact,
      recordings,
      legs
    };
  }
});

export const callRecordView = query({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Call session not found.");
    }

    const entity = await ctx.db.get(callSession.entityId);
    const numberAssignment = await ctx.db
      .query("phoneNumberAssignments")
      .withIndex("by_entity", (q) => q.eq("entityId", callSession.entityId))
      .first();
    const segments = await readTranscript(ctx, args.callSessionId);
    const cards = await ctx.db
      .query("conversationCards")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .order("desc")
      .take(8);
    const artifact = await ctx.db
      .query("callArtifacts")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    const recordings = await ctx.db
      .query("callRecordings")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .order("desc")
      .take(20);
    const legs = await ctx.db
      .query("callLegs")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .take(16);
    const primaryParticipant = await ctx.db
      .query("callParticipants")
      .withIndex("by_call_role", (q) => q.eq("callSessionId", args.callSessionId).eq("role", "primary"))
      .first();
    const primaryContact = primaryParticipant?.contactId
      ? await ctx.db.get(primaryParticipant.contactId)
      : null;
    const primaryExternalEntity = primaryParticipant?.externalEntityId
      ? await ctx.db.get(primaryParticipant.externalEntityId)
      : callSession.primaryExternalEntityId
        ? await ctx.db.get(callSession.primaryExternalEntityId)
        : null;
    const primaryParticipantRawPhone = primaryContact?.phoneNumber ?? primaryParticipant?.phoneNumberSnapshot;
    const primaryParticipantHasInfrastructurePhone = isInfrastructurePhone(
      primaryParticipantRawPhone,
      entity,
      numberAssignment
    );
    const callTagLinks = await ctx.db
      .query("callTags")
      .withIndex("by_call", (q) => q.eq("callSessionId", args.callSessionId))
      .take(50);
    const tags = (
      await Promise.all(callTagLinks.map((link) => ctx.db.get(link.tagId)))
    ).filter((tag): tag is NonNullable<typeof tag> => Boolean(tag && tag.status === "active"));
    const identityPhoneNumber = legs
      .map((leg) => callLegIdentityPhone(leg.phoneNumber, callSession.mode, entity, numberAssignment))
      .find(Boolean);
    const contacts = (
      await Promise.all(
        [identityPhoneNumber]
          .filter((phoneNumber): phoneNumber is string => Boolean(phoneNumber))
          .map((phoneNumber) =>
            ctx.db
              .query("contacts")
              .withIndex("by_phone_entity", (q) => q.eq("phoneNumber", phoneNumber).eq("entityId", callSession.entityId))
              .first()
          )
      )
    ).filter(Boolean);

    return {
      callSession,
      entity,
      numberAssignment,
      segments,
      cards,
      artifact,
      recordings,
      legs,
      identityPhoneNumber,
      contacts,
      primaryParticipant,
      primaryContact,
      primaryParticipantHasInfrastructurePhone,
      primaryExternalEntity,
      tags
    };
  }
});

function assertValidShareToken(shareToken: string) {
  if (!isValidShareToken(shareToken)) {
    throw new Error("Share token is invalid.");
  }
}

function isValidShareToken(shareToken: string) {
  return /^[a-zA-Z0-9_-]{32,96}$/.test(shareToken);
}

export const enableCallShare = mutation({
  args: {
    callSessionId: v.id("callSessions"),
    shareToken: v.string()
  },
  handler: async (ctx, args) => {
    if (!isValidShareToken(args.shareToken)) {
      return null;
    }

    const identity = await requireAuthenticatedIdentity(ctx);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Call session not found.");
    }

    if (callSession.publicShareEnabled && callSession.publicShareToken) {
      return { shareToken: callSession.publicShareToken };
    }

    const existingForToken = await ctx.db
      .query("callSessions")
      .withIndex("by_public_share_token", (q) => q.eq("publicShareToken", args.shareToken))
      .first();
    if (existingForToken && existingForToken._id !== args.callSessionId) {
      throw new Error("Share link collision. Try again.");
    }

    const timestamp = now();
    await ctx.db.patch(args.callSessionId, {
      publicShareToken: args.shareToken,
      publicShareEnabled: true,
      publicShareCreatedAt: callSession.publicShareCreatedAt ?? timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "owner",
      type: "call.share_enabled",
      message: "Owner created a public share link for the call record.",
      createdAt: timestamp
    });

    return { shareToken: args.shareToken };
  }
});

export const disableCallShare = mutation({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Call session not found.");
    }

    const timestamp = now();
    await ctx.db.patch(args.callSessionId, {
      publicShareEnabled: false,
      publicShareDisabledAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "owner",
      type: "call.share_disabled",
      message: "Owner turned off the public share link for the call record.",
      createdAt: timestamp
    });

    return { ok: true };
  }
});

export const importSharedCall = mutation({
  args: {
    shareToken: v.string()
  },
  handler: async (ctx, args) => {
    assertValidShareToken(args.shareToken);
    const identity = await requireAuthenticatedIdentity(ctx);
    const timestamp = now();

    const sourceCallSession = await ctx.db
      .query("callSessions")
      .withIndex("by_public_share_token", (q) => q.eq("publicShareToken", args.shareToken))
      .first();
    if (!sourceCallSession || !sourceCallSession.publicShareEnabled) {
      throw new Error("This shared call is not available.");
    }

    if (sourceCallSession.ownerTokenIdentifier === identity.tokenIdentifier) {
      return {
        callSessionId: sourceCallSession._id,
        alreadyOwned: true,
        imported: false
      };
    }

    const existingImport = await ctx.db
      .query("callImports")
      .withIndex("by_owner_source_call", (q) =>
        q.eq("ownerTokenIdentifier", identity.tokenIdentifier).eq("sourceCallSessionId", sourceCallSession._id)
      )
      .first();
    if (existingImport) {
      return {
        callSessionId: existingImport.importedCallSessionId,
        alreadyImported: true,
        imported: false
      };
    }

    const targetEntity = await ensureOwnerWorkspace(ctx, {
      ownerTokenIdentifier: identity.tokenIdentifier,
      timestamp
    });
    if (!targetEntity) {
      throw new Error("Workspace not found.");
    }

    const sourceSegments = await readTranscript(ctx, sourceCallSession._id);
    const sourceArtifact = await ctx.db
      .query("callArtifacts")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", sourceCallSession._id))
      .first();
    const sourceTitle = sourceArtifact?.callBasis ?? sourceArtifact?.title ?? "Shared Sidetone call";
    const importedCallSessionId = await ctx.db.insert("callSessions", {
      entityId: targetEntity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      mode: "shared_import",
      status: sourceArtifact ? "ready" : sourceSegments.length ? "processing" : "ready",
      industryProfile: sourceCallSession.industryProfile ?? targetEntity.defaultIndustryProfile ?? "general",
      ...(sourceCallSession.coachMode ? { coachMode: sourceCallSession.coachMode } : {}),
      callFocusText: sourceCallSession.callFocusText,
      callFocusInputMethod: sourceCallSession.callFocusInputMethod,
      consentMode: "owner_acknowledgment",
      startedAt: sourceCallSession.startedAt ?? sourceCallSession.createdAt,
      endedAt: sourceCallSession.endedAt ?? sourceCallSession.startedAt ?? sourceCallSession.createdAt,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await Promise.all(sourceSegments.map((segment) =>
      ctx.db.insert("transcriptSegments", {
        callSessionId: importedCallSessionId,
        entityId: targetEntity._id,
        provider: segment.provider,
        speakerLabel: segment.speakerLabel,
        speakerTrack: segment.speakerTrack,
        text: segment.text,
        startMs: segment.startMs,
        endMs: segment.endMs,
        confidence: segment.confidence,
        isFinal: segment.isFinal,
        createdAt: timestamp
      })
    ));

    if (sourceArtifact) {
      await ctx.db.insert("callArtifacts", {
        callSessionId: importedCallSessionId,
        entityId: targetEntity._id,
        title: sourceArtifact.title,
        callBasis: sourceArtifact.callBasis,
        summary: sourceArtifact.summary,
        decisions: sourceArtifact.decisions,
        actionItems: sourceArtifact.actionItems,
        risks: sourceArtifact.risks,
        followUpDraft: sourceArtifact.followUpDraft,
        crmNoteDraft: sourceArtifact.crmNoteDraft,
        promptVersion: `shared-import:${sourceArtifact.promptVersion}`,
        modelName: sourceArtifact.modelName,
        transcriptSegmentCount: sourceSegments.length,
        transcriptLatestSegmentCreatedAt: timestamp,
        status: sourceArtifact.status,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }

    await ctx.db.insert("callImports", {
      entityId: targetEntity._id,
      ownerTokenIdentifier: identity.tokenIdentifier,
      sourceCallSessionId: sourceCallSession._id,
      sourceOwnerTokenIdentifier: sourceCallSession.ownerTokenIdentifier,
      sourceShareToken: args.shareToken,
      importedCallSessionId,
      sourceTitle,
      importedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await ctx.db.insert("auditEvents", {
      entityId: targetEntity._id,
      callSessionId: importedCallSessionId,
      actor: "owner",
      type: "call.shared_imported",
      message: "Owner saved a shared Sidetone call to their call records.",
      metadata: {
        sourceCallSessionId: sourceCallSession._id,
        sourceOwnerTokenIdentifier: sourceCallSession.ownerTokenIdentifier,
        sourceShareToken: args.shareToken
      },
      createdAt: timestamp
    });

    if (sourceSegments.length) {
      await ctx.scheduler.runAfter(1_000, internal.intelligence.indexCallTranscriptInternal, {
        callSessionId: importedCallSessionId
      });
    }
    if (!sourceArtifact && sourceSegments.length) {
      await ctx.scheduler.runAfter(1_000, internal.calls.generateCallArtifactFromTranscriptInternal, {
        callSessionId: importedCallSessionId
      });
    }

    return {
      callSessionId: importedCallSessionId,
      alreadyImported: false,
      imported: true
    };
  }
});

export const publicCallRecordByShareToken = query({
  args: {
    shareToken: v.string()
  },
  handler: async (ctx, args) => {
    if (!isValidShareToken(args.shareToken)) {
      return null;
    }

    const callSession = await ctx.db
      .query("callSessions")
      .withIndex("by_public_share_token", (q) => q.eq("publicShareToken", args.shareToken))
      .first();
    if (!callSession || !callSession.publicShareEnabled) {
      return null;
    }

    const entity = await ctx.db.get(callSession.entityId);
    const numberAssignment = await ctx.db
      .query("phoneNumberAssignments")
      .withIndex("by_entity", (q) => q.eq("entityId", callSession.entityId))
      .first();
    const segments = await readTranscript(ctx, callSession._id);
    const artifact = await ctx.db
      .query("callArtifacts")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", callSession._id))
      .first();
    const recordings = await ctx.db
      .query("callRecordings")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", callSession._id))
      .order("desc")
      .take(20);
    const legs = await ctx.db
      .query("callLegs")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", callSession._id))
      .take(16);
    const identityPhoneNumber = legs
      .map((leg) => callLegIdentityPhone(leg.phoneNumber, callSession.mode, entity, numberAssignment))
      .find(Boolean);
    const contacts = (
      await Promise.all(
        [identityPhoneNumber]
          .filter((phoneNumber): phoneNumber is string => Boolean(phoneNumber))
          .map((phoneNumber) =>
            ctx.db
              .query("contacts")
              .withIndex("by_phone_entity", (q) => q.eq("phoneNumber", phoneNumber).eq("entityId", callSession.entityId))
              .first()
          )
      )
    ).filter(Boolean);

    return {
      callSession: {
        _id: callSession._id,
        mode: callSession.mode,
        status: callSession.status,
        industryProfile: callSession.industryProfile ?? "general",
        coachMode: callSession.coachMode,
        startedAt: callSession.startedAt,
        endedAt: callSession.endedAt,
        createdAt: callSession.createdAt
      },
      entity: entity
        ? {
            name: entity.name,
            timezone: entity.timezone
          }
        : null,
      segments,
      artifact,
      recordings: recordings.map((recording) => ({
        _id: recording._id,
        status: recording.status,
        format: recording.format,
        durationMs: recording.durationMs,
        recordingStartedAt: recording.recordingStartedAt,
        recordingEndedAt: recording.recordingEndedAt
      })),
      legs: legs.map((leg) => ({
        role: leg.role,
        phoneNumber: leg.phoneNumber,
        status: leg.status,
        startedAt: leg.startedAt,
        endedAt: leg.endedAt
      })),
      contacts: contacts.map((contact) => ({
        displayName: contact?.displayName,
        phoneNumber: contact?.phoneNumber
      })),
      identityPhoneNumber
    };
  }
});

export const recordingAccessForOwner = query({
  args: {
    callSessionId: v.id("callSessions"),
    recordingDocId: v.string()
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const callSession = await ctx.db.get(args.callSessionId);
    if (!callSession || callSession.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Call session not found.");
    }
    const recording = (
      await ctx.db
        .query("callRecordings")
        .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
        .take(20)
    ).find((item) => item._id === args.recordingDocId);
    if (!recording || recording.status !== "ready") {
      return null;
    }

    const storageUrl = (recording.provider === "convex_storage" || recording.provider === "zoom_rtms") && recording.storageId
      ? await ctx.storage.getUrl(recording.storageId)
      : undefined;

    return {
      callSessionId: callSession._id,
      provider: recording.provider,
      status: recording.status,
      recordingId: recording.recordingId,
      vexaMediaFileId: recording.vexaMediaFileId,
      storageUrl,
      format: recording.format,
      fileName: recording.fileName,
      mimeType: recording.mimeType,
      sizeBytes: recording.sizeBytes
    };
  }
});

export const publicRecordingByShareToken = query({
  args: {
    shareToken: v.string(),
    recordingDocId: v.string()
  },
  handler: async (ctx, args) => {
    assertValidShareToken(args.shareToken);

    const callSession = await ctx.db
      .query("callSessions")
      .withIndex("by_public_share_token", (q) => q.eq("publicShareToken", args.shareToken))
      .first();
    if (!callSession || !callSession.publicShareEnabled) {
      return null;
    }

    const recording = (
      await ctx.db
        .query("callRecordings")
        .withIndex("by_call_session", (q) => q.eq("callSessionId", callSession._id))
        .take(20)
    ).find((item) => item._id === args.recordingDocId);
    if (!recording || recording.status !== "ready") {
      return null;
    }

    const storageUrl = (recording.provider === "convex_storage" || recording.provider === "zoom_rtms") && recording.storageId
      ? await ctx.storage.getUrl(recording.storageId)
      : undefined;

    return {
      callSessionId: callSession._id,
      provider: recording.provider,
      status: recording.status,
      recordingId: recording.recordingId,
      vexaMediaFileId: recording.vexaMediaFileId,
      storageUrl,
      format: recording.format,
      fileName: recording.fileName,
      mimeType: recording.mimeType,
      recordingStartedAt: recording.recordingStartedAt
    };
  }
});
