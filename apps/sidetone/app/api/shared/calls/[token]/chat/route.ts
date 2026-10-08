import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../../../convex/_generated/api";

type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

const DEFAULT_SHARED_CHAT_MODEL = "gpt-5.4-mini";

function formatTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function compactText(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
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

async function answerWithOpenAI(input: {
  callContext: string;
  history: ChatHistoryMessage[];
  question: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Call chat is not configured yet.");
  }

  const configuredModelName = process.env.SIDETONE_SHARED_CHAT_MODEL?.trim();
  const modelNames = Array.from(
    new Set([configuredModelName, DEFAULT_SHARED_CHAT_MODEL].filter((modelName): modelName is string => Boolean(modelName)))
  );
  let lastStatus = 0;
  let lastDetail = "";

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
              "You are Sidetone's shared-call assistant.",
              "Answer questions using only the shared call record and transcript provided.",
              "Do not invent facts, names, commitments, dates, or motivations.",
              "If the transcript does not support an answer, say that the call record does not show it.",
              "Be concise. Use bullets when they make the answer easier to scan on a phone."
            ].join(" ")
          },
          {
            role: "user",
            content: input.callContext
          },
          ...input.history.map((message) => ({
            role: message.role,
            content: message.content
          })),
          {
            role: "user",
            content: input.question
          }
        ]
      })
    });

    if (response.ok) {
      const body = await response.json();
      return compactText(readOutputText(body), 2000);
    }

    lastStatus = response.status;
    lastDetail = await response.text().catch(() => "");
    if (!isMissingModelError(lastDetail)) {
      break;
    }
  }

  console.warn("Shared call chat failed.", lastStatus, lastDetail.slice(0, 500));
  throw new Error("Sidetone could not answer from this call right now.");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json().catch(() => null);
  const question = String(body?.question ?? "").trim();
  const history = Array.isArray(body?.history)
    ? body.history
      .filter((message: any) =>
        (message?.role === "user" || message?.role === "assistant")
        && typeof message?.content === "string"
        && message.content.trim()
      )
      .slice(-10)
      .map((message: any) => ({
        role: message.role,
        content: compactText(message.content, 1000)
      }))
    : [];

  if (!question) {
    return NextResponse.json({ error: "Ask a question about the call." }, { status: 400 });
  }
  if (question.length > 1200) {
    return NextResponse.json({ error: "Keep the question shorter." }, { status: 400 });
  }

  const record = await fetchQuery(api.calls.publicCallRecordByShareToken, { shareToken: token });
  if (!record) {
    return NextResponse.json({ error: "This shared call is not available." }, { status: 404 });
  }
  if (!record.segments.length) {
    return NextResponse.json({ error: "This shared call does not have a transcript yet." }, { status: 409 });
  }

  const transcript = record.segments
    .map((segment: { startMs: number; text: string }) => `${formatTime(segment.startMs)} ${segment.text}`)
    .join("\n");
  const callContext = [
    "Shared Sidetone call record:",
    record.entity?.name ? `Workspace: ${record.entity.name}` : null,
    record.artifact?.summary ? `Summary: ${record.artifact.summary}` : null,
    record.artifact?.actionItems?.length ? `Action items:\n${record.artifact.actionItems.map((item: string) => `- ${item}`).join("\n")}` : null,
    record.artifact?.decisions?.length ? `Decisions:\n${record.artifact.decisions.map((item: string) => `- ${item}`).join("\n")}` : null,
    record.artifact?.risks?.length ? `Risks:\n${record.artifact.risks.map((item: string) => `- ${item}`).join("\n")}` : null,
    "",
    "Transcript:",
    transcript.length > 60000 ? transcript.slice(-60000) : transcript
  ].filter((line): line is string => line !== null).join("\n");

  try {
    const answer = await answerWithOpenAI({
      callContext,
      history,
      question
    });
    return NextResponse.json({ answer });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to answer from this call." },
      { status: 500 }
    );
  }
}
