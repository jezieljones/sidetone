import {
  buildSidetonePromptContext,
  coachLensPromptFor,
  industryProfileFor,
  normalizeIndustryProfileId,
  normalizeTuningMode
} from "@sidetone/contracts";
import type { NotesLabModelOption } from "./notes-lab-models";

export type NotesLabArtifact = {
  title?: string;
  summary: string;
  decisions: string[];
  actionItems: string[];
  risks: string[];
  followUpDraft?: string;
  crmNoteDraft?: string;
};

const artifactSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    decisions: { type: "array", items: { type: "string" } },
    actionItems: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    followUpDraft: { type: "string" },
    crmNoteDraft: { type: "string" }
  },
  required: ["title", "summary", "decisions", "actionItems", "risks", "followUpDraft", "crmNoteDraft"]
};

type NotesLabGenerationInput = {
  transcript: string;
  coachMode?: string;
  industryProfile?: string;
  startedAt?: number;
};

function systemPrompt(input: NotesLabGenerationInput) {
  return [
    "You are Sidetone, a private phone-call scribe.",
    "Turn raw phone transcripts into a clean call record, not a transcript excerpt.",
    normalizeTuningMode(input.coachMode)
      ? "Use the selected industry profile as the domain lens and the legacy conversation lens as secondary context."
      : "Use the selected industry profile as the domain lens.",
    buildSidetonePromptContext({
      industryProfile: normalizeIndustryProfileId(input.industryProfile),
      coachMode: normalizeTuningMode(input.coachMode)
    }),
    "Ignore recording disclosures, product-testing chatter, repeated filler, and false starts unless they are the actual purpose of the call.",
    "Never invent names, dates, amounts, commitments, or owners.",
    "Action items must be real next steps from the call. Do not include disclosure statements or generic review tasks.",
    "For legal, insurance, financial-services, or healthcare-sensitive calls, capture facts and follow-up only; do not give legal, clinical, financial, insurance, or coverage advice.",
    "If the call was mostly a product test, say that plainly and capture only the concrete next steps.",
    "Return title as a short noun phrase that summarizes the call, such as Schedule Follow-Up or Closing Repair Details.",
    "Return only valid JSON matching this shape: {\"title\":\"\",\"summary\":\"\",\"decisions\":[],\"actionItems\":[],\"risks\":[],\"followUpDraft\":\"\",\"crmNoteDraft\":\"\"}."
  ].join(" ");
}

function userPrompt(input: NotesLabGenerationInput) {
  const profile = industryProfileFor(input.industryProfile);
  const tuningMode = normalizeTuningMode(input.coachMode);
  const lens = tuningMode ? coachLensPromptFor(tuningMode) : undefined;
  return [
    "Create the post-call record.",
    `Industry profile: ${profile.label}`,
    lens ? `Conversation lens: ${lens.label}` : "",
    input.startedAt ? `Started at: ${new Date(input.startedAt).toISOString()}` : "",
    "",
    "Transcript:",
    input.transcript
  ].join("\n");
}

function responseTextFromOpenAI(response: any) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const chunks = response.output
    ?.flatMap((item: any) => item.content ?? [])
    ?.map((content: any) => content.text)
    ?.filter(Boolean);
  return chunks?.join("\n") ?? "";
}

function responseTextFromAnthropic(response: any) {
  return response.content
    ?.map((content: any) => content?.text)
    ?.filter(Boolean)
    ?.join("\n") ?? "";
}

function responseTextFromGemini(response: any) {
  return response.candidates
    ?.flatMap((candidate: any) => candidate?.content?.parts ?? [])
    ?.map((part: any) => part?.text)
    ?.filter(Boolean)
    ?.join("\n") ?? "";
}

function extractJson(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]?.trim().startsWith("{")) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function requireStringArray(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Model returned invalid ${field}.`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function parseArtifact(text: string): NotesLabArtifact {
  const parsed = JSON.parse(extractJson(text));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model did not return a notes object.");
  }
  if (typeof parsed.summary !== "string" || !parsed.summary.trim()) {
    throw new Error("Model returned an invalid summary.");
  }

  return {
    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : undefined,
    summary: parsed.summary.trim(),
    decisions: requireStringArray(parsed.decisions, "decisions"),
    actionItems: requireStringArray(parsed.actionItems, "actionItems"),
    risks: requireStringArray(parsed.risks, "risks"),
    followUpDraft: typeof parsed.followUpDraft === "string" ? parsed.followUpDraft.trim() : undefined,
    crmNoteDraft: typeof parsed.crmNoteDraft === "string" ? parsed.crmNoteDraft.trim() : undefined
  };
}

async function readFailure(response: Response) {
  const detail = await response.text().catch(() => "");
  if (!detail.trim()) {
    return `${response.status}`;
  }
  return `${response.status}: ${detail.slice(0, 500)}`;
}

async function generateWithOpenAI(model: NotesLabModelOption, input: NotesLabGenerationInput) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model.modelId,
      input: [
        { role: "system", content: systemPrompt(input) },
        { role: "user", content: userPrompt(input) }
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

  if (!response.ok) {
    throw new Error(`OpenAI lab generation failed (${await readFailure(response)}).`);
  }

  return parseArtifact(responseTextFromOpenAI(await response.json()));
}

async function generateWithAnthropic(model: NotesLabModelOption, input: NotesLabGenerationInput) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model.modelId,
      max_tokens: 4000,
      temperature: 0.2,
      system: systemPrompt(input),
      messages: [
        { role: "user", content: userPrompt(input) }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Anthropic lab generation failed (${await readFailure(response)}).`);
  }

  return parseArtifact(responseTextFromAnthropic(await response.json()));
}

async function generateWithGemini(model: NotesLabModelOption, input: NotesLabGenerationInput) {
  const apiKey = process.env.GOOGLE_API_KEY?.trim()
    || process.env.GEMINI_API_KEY?.trim()
    || process.env.GOOGLE_GENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY, GEMINI_API_KEY, or GOOGLE_GENAI_API_KEY is not configured.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model.modelId}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: `${systemPrompt(input)}\n\n${userPrompt(input)}` }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini lab generation failed (${await readFailure(response)}).`);
  }

  return parseArtifact(responseTextFromGemini(await response.json()));
}

export async function generateNotesLabArtifact(model: NotesLabModelOption, input: NotesLabGenerationInput) {
  if (model.provider === "openai") {
    return generateWithOpenAI(model, input);
  }
  if (model.provider === "anthropic") {
    return generateWithAnthropic(model, input);
  }
  return generateWithGemini(model, input);
}
