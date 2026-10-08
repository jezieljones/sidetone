import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAuthenticatedIdentity } from "./auth";
import sanitizeHtml from "sanitize-html";

type RichTextMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

type RichTextNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
};

type RichTextDocument = {
  type: "doc";
  content: RichTextNode[];
};

const editableHtmlOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    "a",
    "blockquote",
    "br",
    "code",
    "em",
    "h1",
    "h2",
    "h3",
    "hr",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "strong",
    "ul"
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"]
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }, true)
  }
};

function now() {
  return Date.now();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraph(value?: string | null) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned ? `<p>${escapeHtml(cleaned)}</p>` : "";
}

function sanitizeEditableHtml(value: string) {
  return sanitizeHtml(value, editableHtmlOptions).trim();
}

function textNode(text: string, marks?: RichTextMark[]): RichTextNode {
  return marks?.length ? { type: "text", text, marks } : { type: "text", text };
}

function paragraphNode(value?: string | null, marks?: RichTextMark[]): RichTextNode | null {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned ? { type: "paragraph", content: [textNode(cleaned, marks)] } : null;
}

function paragraphFromContent(content: RichTextNode[]): RichTextNode | null {
  return content.length ? { type: "paragraph", content } : null;
}

function headingNode(level: 1 | 2 | 3, value?: string | null): RichTextNode | null {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned ? { type: "heading", attrs: { level }, content: [textNode(cleaned)] } : null;
}

function bulletListNode(items: string[]): RichTextNode | null {
  const listItems = items
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((item) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [textNode(item)] }]
    }));
  return listItems.length ? { type: "bulletList", content: listItems } : null;
}

function isRichTextDocument(value: unknown): value is RichTextDocument {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value)
      && (value as { type?: unknown }).type === "doc"
      && Array.isArray((value as { content?: unknown }).content)
  );
}

function fallbackJsonFromHtml(contentHtml: string): RichTextDocument {
  const text = htmlToMarkdown(contentHtml);
  return {
    type: "doc",
    content: text ? [{ type: "paragraph", content: [textNode(text)] }] : []
  };
}

function htmlToMarkdown(value: string) {
  return sanitizeEditableHtml(value)
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1\n\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<\/ul>/gi, "\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function listBlock(title: string, items: string[]) {
  if (!items.length) {
    return "";
  }
  return [
    `<h2>${escapeHtml(title)}</h2>`,
    "<ul>",
    ...items.map((item) => `<li>${escapeHtml(item)}</li>`),
    "</ul>"
  ].join("");
}

function callModeLabel(mode?: string) {
  if (mode === "sidetone_session") {
    return "Sidetone session";
  }
  if (mode === "conference_in") {
    return "Conference-in";
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
  return "Call-through";
}

function generatedCallDocJson({
  title,
  callBasis,
  detailItems,
  focus,
  summary,
  actionItems,
  decisions,
  risks,
  followUpDraft,
  crmNoteDraft
}: {
  title: string;
  callBasis?: string;
  detailItems: string[];
  focus?: string;
  summary?: string;
  actionItems: string[];
  decisions: string[];
  risks: string[];
  followUpDraft?: string;
  crmNoteDraft?: string;
}): RichTextDocument {
  const nodes = [
    headingNode(1, title),
    paragraphNode(callBasis, [{ type: "italic" }]),
    headingNode(2, "Call Details"),
    bulletListNode(detailItems),
    focus
      ? paragraphFromContent([
          textNode("Listen For: ", [{ type: "bold" }]),
          textNode(focus.replace(/\s+/g, " ").trim())
        ])
      : null,
    headingNode(2, "Summary"),
    paragraphNode(summary),
    headingNode(2, actionItems.length ? "Action Items" : undefined),
    bulletListNode(actionItems),
    headingNode(2, decisions.length ? "Decisions" : undefined),
    bulletListNode(decisions),
    headingNode(2, risks.length ? "Risks And Open Questions" : undefined),
    bulletListNode(risks),
    headingNode(2, followUpDraft ? "Follow-Up Draft" : undefined),
    paragraphNode(followUpDraft),
    headingNode(2, crmNoteDraft ? "Entity Note" : undefined),
    paragraphNode(crmNoteDraft)
  ].filter((node): node is RichTextNode => Boolean(node));

  return { type: "doc", content: nodes };
}

function callDateLabel(timestamp?: number) {
  if (!timestamp) {
    return undefined;
  }
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

async function requireOwnedCallSession(ctx: QueryCtx | MutationCtx, callSessionId: Id<"callSessions">) {
  const identity = await requireAuthenticatedIdentity(ctx);
  const callSession = await ctx.db.get(callSessionId);
  if (!callSession || callSession.ownerTokenIdentifier !== identity.tokenIdentifier) {
    throw new Error("Call session not found.");
  }
  return { identity, callSession };
}

export const callDocForCall = query({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    await requireOwnedCallSession(ctx, args.callSessionId);
    return await ctx.db
      .query("callDocs")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
  }
});

export const generateCallDoc = mutation({
  args: {
    callSessionId: v.id("callSessions")
  },
  handler: async (ctx, args) => {
    const { identity, callSession } = await requireOwnedCallSession(ctx, args.callSessionId);
    const timestamp = now();
    const artifact = await ctx.db
      .query("callArtifacts")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    const participant = await ctx.db
      .query("callParticipants")
      .withIndex("by_call_role", (q) => q.eq("callSessionId", args.callSessionId).eq("role", "primary"))
      .first();
    const contact = participant?.contactId ? await ctx.db.get(participant.contactId) : null;
    const sessionExternalEntityId = callSession.primaryExternalEntityId as Id<"externalEntities"> | undefined;
    const participantExternalEntityId = participant?.externalEntityId as Id<"externalEntities"> | undefined;
    const sessionExternalEntity = sessionExternalEntityId ? await ctx.db.get(sessionExternalEntityId) : null;
    const participantExternalEntity = participantExternalEntityId ? await ctx.db.get(participantExternalEntityId) : null;
    const externalEntity = sessionExternalEntity ?? participantExternalEntity;
    const callTags = await ctx.db
      .query("callTags")
      .withIndex("by_call", (q) => q.eq("callSessionId", args.callSessionId))
      .take(20);
    const tags = (await Promise.all(callTags.map((callTag) => ctx.db.get(callTag.tagId))))
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag && tag.status === "active"))
      .map((tag) => tag.label);
    const title = externalEntity?.name
      ?? contact?.displayName
      ?? participant?.externalEntityNameSnapshot
      ?? participant?.displayNameSnapshot
      ?? callModeLabel(callSession.mode);
    const focus = callSession.callFocusText ? `<p><strong>Listen For:</strong> ${escapeHtml(callSession.callFocusText)}</p>` : "";
    const detailItems = [
      `Call type: ${callModeLabel(callSession.mode)}`,
      callDateLabel(callSession.startedAt ?? callSession.createdAt) ? `Date: ${callDateLabel(callSession.startedAt ?? callSession.createdAt)}` : null,
      callSession.industryProfile ? `Profile: ${callSession.industryProfile}` : null,
      tags.length ? `Tags: ${tags.join(", ")}` : null
    ].filter((item): item is string => Boolean(item));
    const contentHtml = sanitizeEditableHtml([
      `<h1>${escapeHtml(title)}</h1>`,
      artifact?.callBasis ? `<p><em>${escapeHtml(artifact.callBasis)}</em></p>` : "",
      listBlock("Call Details", detailItems),
      focus,
      "<h2>Summary</h2>",
      paragraph(artifact?.summary),
      listBlock("Action Items", artifact?.actionItems ?? []),
      listBlock("Decisions", artifact?.decisions ?? []),
      listBlock("Risks And Open Questions", artifact?.risks ?? []),
      artifact?.followUpDraft ? "<h2>Follow-Up Draft</h2>" : "",
      paragraph(artifact?.followUpDraft),
      artifact?.crmNoteDraft ? "<h2>Entity Note</h2>" : "",
      paragraph(artifact?.crmNoteDraft)
    ].filter(Boolean).join("\n"));
    const contentJson = generatedCallDocJson({
      title,
      callBasis: artifact?.callBasis,
      detailItems,
      focus: callSession.callFocusText,
      summary: artifact?.summary,
      actionItems: artifact?.actionItems ?? [],
      decisions: artifact?.decisions ?? [],
      risks: artifact?.risks ?? [],
      followUpDraft: artifact?.followUpDraft,
      crmNoteDraft: artifact?.crmNoteDraft
    });

    const existing = await ctx.db
      .query("callDocs")
      .withIndex("by_call_session", (q) => q.eq("callSessionId", args.callSessionId))
      .first();
    const patch = {
      entityId: callSession.entityId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      title,
      contentJson,
      contentHtml,
      contentMarkdown: htmlToMarkdown(contentHtml),
      version: existing ? existing.version + 1 : 1,
      generatedFromArtifactId: artifact?._id,
      updatedAt: timestamp
    };

    const docId = existing
      ? (await ctx.db.patch(existing._id, patch), existing._id)
      : await ctx.db.insert("callDocs", {
        callSessionId: args.callSessionId,
        createdAt: timestamp,
        ...patch
      });

    await ctx.db.insert("auditEvents", {
      entityId: callSession.entityId,
      callSessionId: args.callSessionId,
      actor: "owner",
      type: "call_doc.generated",
      message: "Owner generated an editable call doc.",
      metadata: { docId },
      createdAt: timestamp
    });

    return { docId };
  }
});

export const updateCallDoc = mutation({
  args: {
    callDocId: v.id("callDocs"),
    title: v.optional(v.string()),
    contentHtml: v.string(),
    contentJson: v.optional(v.any())
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedIdentity(ctx);
    const doc = await ctx.db.get(args.callDocId);
    if (!doc || doc.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Call doc not found.");
    }
    const timestamp = now();
    const contentHtml = sanitizeEditableHtml(args.contentHtml);
    const contentJson = isRichTextDocument(args.contentJson)
      ? args.contentJson
      : fallbackJsonFromHtml(contentHtml);
    await ctx.db.patch(args.callDocId, {
      title: args.title?.replace(/\s+/g, " ").trim() || doc.title,
      contentHtml,
      contentJson,
      contentMarkdown: htmlToMarkdown(contentHtml),
      version: doc.version + 1,
      updatedAt: timestamp
    });
    await ctx.db.insert("auditEvents", {
      entityId: doc.entityId,
      callSessionId: doc.callSessionId,
      actor: "owner",
      type: "call_doc.updated",
      message: "Owner edited a call doc.",
      metadata: { docId: args.callDocId },
      createdAt: timestamp
    });
    return { callDocId: args.callDocId };
  }
});
