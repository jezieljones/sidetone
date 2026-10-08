"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { AlertTriangle, ArrowLeft, Bold, CheckCircle2, ChevronDown, ChevronRight, Copy, Download, FileAudio, FileText, FlaskConical, Heading1, Heading2, Italic, Link2, List, LoaderCircle, Pencil, Plus, Printer, Quote, Share2, Tag, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatUsPhone } from "../lib/phone-format";
import { NOTES_LAB_PROVIDERS, notesLabModelsForProvider, type NotesLabProvider } from "../lib/notes-lab-models";
import { dashboardIndustryProfileForId } from "../lib/brand-system";
import { IndustryProfileBadge, IndustryProfileCard } from "./IndustryProfileCard";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";

function formatTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function EmptyList({ text }: { text: string }) {
  return (
    <div className="border-t border-border py-4 text-sm leading-6 text-muted-foreground">
      {text}
    </div>
  );
}

function isRecordingDisclosure(text: string) {
  return /this call is being recorded and transcribed by (sidetone|scitone|cytone)|welcome to sidetone|tap add call|merge calls|start taking notes/i.test(text);
}

function formatDateTime(timestamp?: number) {
  if (!timestamp) {
    return "Time unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatDuration(ms?: number) {
  if (!ms || ms <= 0) {
    return null;
  }

  return formatTime(ms);
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

function makeShareToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function shareUrlForToken(token: string) {
  const origin = typeof window === "undefined" ? "http://localhost:3000" : window.location.origin;
  return `${origin}/shared/calls/${token}`;
}

function escapeDocumentText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeFileName(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "sidetone-call-doc";
}

function readableTextFromHtml(value: string) {
  if (typeof document === "undefined") {
    return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const element = document.createElement("div");
  element.innerHTML = value;
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function isTiptapDoc(value: unknown): value is JSONContent {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value)
      && (value as JSONContent).type === "doc"
  );
}

function callDocHtmlDocument(title: string, contentHtml: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeDocumentText(title)}</title>
  <style>
    body {
      margin: 0;
      background: #f8f4ec;
      color: #111827;
      font-family: Inter, sans-serif;
      line-height: 1.55;
    }
    main {
      box-sizing: border-box;
      max-width: 760px;
      margin: 0 auto;
      padding: 48px 28px;
    }
    h1 {
      font-family: Fraunces, serif;
      font-size: 40px;
      font-style: italic;
      font-weight: 700;
      line-height: 1.05;
      margin: 0 0 20px;
    }
    h2 {
      border-top: 1px solid #d8cfc0;
      font-family: Inter, sans-serif;
      font-size: 13px;
      letter-spacing: 0.12em;
      margin: 32px 0 12px;
      padding-top: 18px;
      text-transform: uppercase;
    }
    code, pre {
      font-family: "JetBrains Mono", monospace;
    }
    p, li { font-size: 16px; }
    ul { padding-left: 22px; }
    @media print {
      body { background: #fff; }
      main { max-width: none; padding: 0; }
    }
  </style>
</head>
<body>
  <main>${contentHtml}</main>
</body>
</html>`;
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  }
}

type LabRun = {
  _id: string;
  provider: NotesLabProvider;
  modelId: string;
  modelLabel: string;
  title?: string;
  summary?: string;
  decisions: string[];
  actionItems: string[];
  risks: string[];
  followUpDraft?: string;
  crmNoteDraft?: string;
  error?: string;
  status: "ready" | "failed";
  createdAt: number;
};

function labRunText(run: LabRun) {
  return [
    run.title ?? run.modelLabel,
    "",
    run.summary ? `Summary:\n${run.summary}` : null,
    run.actionItems.length ? `Action items:\n${run.actionItems.map((item) => `- ${item}`).join("\n")}` : null,
    run.decisions.length ? `Decisions:\n${run.decisions.map((item) => `- ${item}`).join("\n")}` : null,
    run.risks.length ? `Risks:\n${run.risks.map((item) => `- ${item}`).join("\n")}` : null,
    run.crmNoteDraft ? `CRM note:\n${run.crmNoteDraft}` : null,
    run.error ? `Error:\n${run.error}` : null
  ].filter(Boolean).join("\n\n");
}

export function CallRecordRuntime({
  callSessionId,
  notesLabEnabled = false
}: {
  callSessionId: string;
  notesLabEnabled?: boolean;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const enableCallShare = useMutation(api.calls.enableCallShare);
  const updateCallEntity = useMutation(api.crm.updateCallEntity);
  const upsertTag = useMutation(api.crm.upsertTag);
  const attachTagToCall = useMutation(api.crm.attachTagToCall);
  const detachTagFromCall = useMutation(api.crm.detachTagFromCall);
  const generateCallDoc = useMutation(api.callDocs.generateCallDoc);
  const updateCallDoc = useMutation(api.callDocs.updateCallDoc);
  const data = useQuery(
    api.calls.callRecordView,
    isLoading || !isAuthenticated ? "skip" : { callSessionId: callSessionId as Id<"callSessions"> }
  );
  const callDoc = useQuery(
    api.callDocs.callDocForCall,
    isLoading || !isAuthenticated ? "skip" : { callSessionId: callSessionId as Id<"callSessions"> }
  );
  const tagOptions = useQuery(
    api.crm.listTagsForEntity,
    data?.callSession?.entityId ? { entityId: data.callSession.entityId } : "skip"
  );
  const [transcriptCopyState, setTranscriptCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [shareState, setShareState] = useState<"idle" | "working" | "copied" | "disabled" | "failed">("idle");
  const [hasRequestedNotes, setHasRequestedNotes] = useState(false);
  const [labProvider, setLabProvider] = useState<NotesLabProvider>("openai");
  const [labModelId, setLabModelId] = useState<string>(notesLabModelsForProvider("openai")[0]?.modelId ?? "");
  const [labRuns, setLabRuns] = useState<LabRun[]>([]);
  const [labListState, setLabListState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [labGenerateState, setLabGenerateState] = useState<"idle" | "working" | "done" | "failed">("idle");
  const [labError, setLabError] = useState<string | null>(null);
  const [expandedLabRunIds, setExpandedLabRunIds] = useState<Set<string>>(new Set());
  const [labCopyRunId, setLabCopyRunId] = useState<string | null>(null);
  const [identityDraft, setIdentityDraft] = useState("");
  const [identityEditing, setIdentityEditing] = useState(false);
  const [identityState, setIdentityState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [tagDraft, setTagDraft] = useState("");
  const [tagState, setTagState] = useState<"idle" | "saving" | "failed">("idle");
  const [docDraft, setDocDraft] = useState("");
  const [docState, setDocState] = useState<"idle" | "working" | "saved" | "failed">("idle");
  const [docExportState, setDocExportState] = useState<"idle" | "downloaded" | "printing" | "failed">("idle");
  const [notesEditorOpen, setNotesEditorOpen] = useState(false);
  const artifact = data?.artifact;
  const docEditor = useEditor({
    extensions: [StarterKit],
    content: "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": "Editable call doc",
        class: "min-h-[320px] bg-[#FCF9F2] px-3 py-3 text-base leading-7 text-[#0A192F] outline-none transition focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[420px] sm:px-5 sm:py-4 [&_blockquote]:border-l-4 [&_blockquote]:border-[#D7CBB9] [&_blockquote]:pl-3 sm:[&_blockquote]:pl-4 [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-black [&_h1]:italic [&_h1]:leading-tight sm:[&_h1]:text-3xl [&_h2]:mt-6 [&_h2]:border-t [&_h2]:border-[#D7CBB9] [&_h2]:pt-4 [&_h2]:font-sans [&_h2]:text-xs [&_h2]:font-black [&_h2]:uppercase [&_h2]:tracking-[0.14em] sm:[&_h2]:mt-7 [&_li]:my-1 [&_ol]:my-3 [&_ol]:pl-5 [&_p]:my-3 [&_ul]:my-3 [&_ul]:pl-5"
      }
    },
    onUpdate: ({ editor }) => {
      setDocDraft(editor.getHTML());
      setDocState("idle");
    }
  });

  const transcript = useMemo(() => {
    return data?.segments.map((segment: { text: string }) => segment.text).join(" ") ?? "";
  }, [data?.segments]);
  const transcriptForCopy = useMemo(() => {
    return data?.segments
      .map((segment: { startMs: number; text: string }) => `${formatTime(segment.startMs)} ${segment.text}`)
      .join("\n") ?? "";
  }, [data?.segments]);
  const disclosureOnlyTranscript = useMemo(() => {
    const segments = data?.segments ?? [];
    return segments.length > 0 && segments.every((segment: { text: string }) => isRecordingDisclosure(segment.text));
  }, [data?.segments]);

  const identityPhoneNumber = data?.identityPhoneNumber;
  const primaryParticipantHasInfrastructurePhone = data?.primaryParticipantHasInfrastructurePhone === true;
  const safePrimaryContact = primaryParticipantHasInfrastructurePhone ? undefined : data?.primaryContact;
  const safePrimaryDisplayName = primaryParticipantHasInfrastructurePhone
    ? undefined
    : data?.primaryParticipant?.displayNameSnapshot;
  const safePrimaryPhoneNumber = primaryParticipantHasInfrastructurePhone
    ? undefined
    : data?.primaryParticipant?.phoneNumberSnapshot;
  const curatedPhoneNumber = safePrimaryContact?.phoneNumber ?? safePrimaryPhoneNumber;

  const matchingContact = useMemo(() => {
    if (!identityPhoneNumber) {
      return undefined;
    }
    return data?.contacts?.find((contact) => contact?.phoneNumber === identityPhoneNumber);
  }, [data?.contacts, identityPhoneNumber]);
  const callDocId = callDoc?._id;
  const callDocVersion = callDoc?.version;
  const callDocContentJson = callDoc?.contentJson;
  const callDocContentHtml = callDoc?.contentHtml ?? "";

  useEffect(() => {
    if (!docEditor) {
      return;
    }
    if (!callDocId) {
      docEditor.commands.setContent("", { emitUpdate: false });
      queueMicrotask(() => setDocDraft(""));
      return;
    }

    const content = isTiptapDoc(callDocContentJson) ? callDocContentJson : callDocContentHtml;
    docEditor.commands.setContent(content ?? "", { emitUpdate: false });
    queueMicrotask(() => setDocDraft(docEditor.getHTML()));
  }, [callDocContentHtml, callDocContentJson, callDocId, callDocVersion, docEditor]);

  useEffect(() => {
    if (!notesEditorOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setNotesEditorOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [notesEditorOpen]);

  const transcriptSegmentCount = data?.segments.length ?? 0;
  const artifactSegmentCount = artifact?.transcriptSegmentCount ?? 0;
  const artifactFailed = artifact?.status === "failed";
  const artifactIsStale = Boolean(
    artifact?.status === "ready"
    && transcriptSegmentCount > 0
    && (
      artifact.transcriptSegmentCount === undefined
        ? transcriptSegmentCount > 1
        : transcriptSegmentCount > artifactSegmentCount
    )
  );
  const identityTitle = data?.primaryExternalEntity?.name
    ?? safePrimaryContact?.displayName
    ?? data?.primaryParticipant?.externalEntityNameSnapshot
    ?? safePrimaryDisplayName
    ?? matchingContact?.displayName
    ?? formatUsPhone(curatedPhoneNumber ?? identityPhoneNumber)
    ?? "Sidetone call";
  const callTitle = identityTitle;
  const callSubtitle = [
    callModeLabel(data?.callSession.mode),
    artifact?.callBasis ?? artifact?.title,
    formatDateTime(data?.callSession.startedAt ?? data?.callSession.createdAt)
  ].filter(Boolean).join(" · ");
  const callFailed = data?.callSession.status === "failed";
  const readyRecordings = (data?.recordings ?? []).filter(
    (recording: { status: string }) => recording.status === "ready"
  );
  const failedRecordings = (data?.recordings ?? []).filter(
    (recording: { status: string }) => recording.status === "failed"
  );
  const recordingPlaceholderText = failedRecordings.length
    ? "Recording could not be saved for this call."
    : (data?.callSession.mode === "vexa_meeting" || data?.callSession.mode === "zoom_rtms") && data.callSession.status === "ready"
      ? "No meeting recording is available for this record."
      : data?.callSession.status === "ready" || data?.callSession.status === "processing"
        ? "Recording is being saved. Refresh in a moment."
        : "Recording will appear here after the call ends.";
  const badge = callFailed
    ? { label: "Call failed", variant: "danger" as const }
    : artifactFailed
      ? { label: "Notes unavailable", variant: "danger" as const }
    : artifact?.status === "ready"
      ? { label: "Notes ready", variant: "success" as const }
      : { label: "Writing notes", variant: "accent" as const };
  const shareToken = data?.callSession.publicShareEnabled ? data.callSession.publicShareToken : undefined;
  const shareUrl = shareToken ? shareUrlForToken(shareToken) : undefined;
  const labModelOptions = notesLabModelsForProvider(labProvider);
  const selectedLabModel = labModelOptions.find((model) => model.modelId === labModelId) ?? labModelOptions[0];
  const docReadableText = useMemo(() => readableTextFromHtml(docDraft), [docDraft]);
  const docHasContent = docEditor ? !docEditor.isEmpty && docReadableText.length > 0 : docReadableText.length > 0;

  useEffect(() => {
    if (!identityEditing) {
      setIdentityDraft(callTitle === "Sidetone call" ? "" : callTitle);
    }
  }, [callTitle, identityEditing]);

  useEffect(() => {
    if (!data || hasRequestedNotes || !transcript.trim()) {
      return;
    }

    if (!artifact || artifact.status === "draft" || artifact.modelName === "sidetone-deterministic" || artifactIsStale) {
      setHasRequestedNotes(true);
      void fetch("/api/calls/generate-notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callSessionId })
      }).catch(() => undefined);
    }
  }, [artifact, artifactIsStale, callSessionId, data, hasRequestedNotes, transcript]);

  useEffect(() => {
    const firstModelForProvider = notesLabModelsForProvider(labProvider)[0];
    if (firstModelForProvider && !notesLabModelsForProvider(labProvider).some((model) => model.modelId === labModelId)) {
      setLabModelId(firstModelForProvider.modelId);
    }
  }, [labModelId, labProvider]);

  useEffect(() => {
    if (!notesLabEnabled || !data) {
      return;
    }

    let cancelled = false;
    setLabListState("loading");
    void fetch(`/api/calls/notes-lab?callSessionId=${encodeURIComponent(callSessionId)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error ?? "Unable to load lab notes.");
        }
        if (!cancelled) {
          setLabRuns(Array.isArray(payload?.runs) ? payload.runs : []);
          setLabListState("ready");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLabError(error instanceof Error ? error.message : "Unable to load lab notes.");
          setLabListState("failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [callSessionId, data, notesLabEnabled]);

  async function generateLabNotes() {
    if (!transcript.trim() || !selectedLabModel) {
      return;
    }

    setLabGenerateState("working");
    setLabError(null);
    try {
      const response = await fetch("/api/calls/generate-notes-lab", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          callSessionId,
          provider: selectedLabModel.provider,
          modelId: selectedLabModel.modelId
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (payload?.run) {
          setLabRuns((runs) => [payload.run, ...runs.filter((run) => run._id !== payload.run._id)]);
        }
        throw new Error(payload?.error ?? "Unable to generate lab notes.");
      }

      if (payload?.run) {
        setLabRuns((runs) => [payload.run, ...runs.filter((run) => run._id !== payload.run._id)]);
        setExpandedLabRunIds((ids) => new Set(ids).add(payload.run._id));
      }
      setLabGenerateState("done");
      window.setTimeout(() => setLabGenerateState("idle"), 1800);
    } catch (error) {
      setLabError(error instanceof Error ? error.message : "Unable to generate lab notes.");
      setLabGenerateState("failed");
    }
  }

  function toggleLabRun(runId: string) {
    setExpandedLabRunIds((ids) => {
      const next = new Set(ids);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }

  async function copyLabRun(run: LabRun) {
    const copied = await writeClipboard(labRunText(run));
    if (copied) {
      setLabCopyRunId(run._id);
      window.setTimeout(() => setLabCopyRunId(null), 1500);
    }
  }

  async function copyTranscript() {
    if (!transcriptForCopy.trim()) {
      return;
    }

    const copied = await writeClipboard(transcriptForCopy);
    setTranscriptCopyState(copied ? "copied" : "failed");
    window.setTimeout(() => setTranscriptCopyState("idle"), 1800);
  }

  async function createShareLink() {
    if (!data) {
      return;
    }

    setShareState("working");
    try {
      const result = await enableCallShare({
        callSessionId: data.callSession._id,
        shareToken: makeShareToken()
      });
      if (!result?.shareToken) {
        throw new Error("Share link was not created.");
      }
      await writeClipboard(shareUrlForToken(result.shareToken));
      setShareState("copied");
      window.setTimeout(() => setShareState("idle"), 1800);
    } catch {
      setShareState("failed");
    }
  }

  async function copyShareLink() {
    if (!shareUrl) {
      return;
    }

    setShareState("working");
    const copied = await writeClipboard(shareUrl);
    setShareState(copied ? "copied" : "failed");
    window.setTimeout(() => setShareState("idle"), 1800);
  }

  async function saveIdentity(nextIdentity = identityDraft) {
    if (!data) {
      return;
    }
    const trimmedIdentity = nextIdentity.trim();
    setIdentityEditing(false);
    if (!trimmedIdentity || trimmedIdentity === callTitle) {
      setIdentityDraft(trimmedIdentity || (callTitle === "Sidetone call" ? "" : callTitle));
      setIdentityState("idle");
      return;
    }
    setIdentityState("saving");
    try {
      await updateCallEntity({
        callSessionId: data.callSession._id,
        entityName: trimmedIdentity
      });
      setIdentityDraft(trimmedIdentity);
      setIdentityState("saved");
      window.setTimeout(() => setIdentityState("idle"), 1500);
    } catch {
      setIdentityState("failed");
      setIdentityEditing(true);
    }
  }

  async function addTag() {
    if (!data || !tagDraft.trim()) {
      return;
    }
    setTagState("saving");
    try {
      const result = await upsertTag({
        entityId: data.callSession.entityId,
        label: tagDraft.trim()
      });
      await attachTagToCall({
        callSessionId: data.callSession._id,
        tagId: result.tagId
      });
      setTagDraft("");
      setTagState("idle");
    } catch {
      setTagState("failed");
    }
  }

  async function toggleExistingTag(tagId: Id<"tags">, attached: boolean) {
    if (!data) {
      return;
    }
    if (attached) {
      await detachTagFromCall({ callSessionId: data.callSession._id, tagId });
    } else {
      await attachTagToCall({ callSessionId: data.callSession._id, tagId });
    }
  }

  async function generateDoc() {
    if (!data) {
      return;
    }
    setDocState("working");
    try {
      await generateCallDoc({ callSessionId: data.callSession._id });
      setDocState("saved");
      window.setTimeout(() => setDocState("idle"), 1500);
    } catch {
      setDocState("failed");
    }
  }

  async function saveDoc() {
    const contentHtml = docEditor?.getHTML() ?? docDraft;
    const contentJson = docEditor?.getJSON();
    if (!callDoc || !readableTextFromHtml(contentHtml)) {
      return;
    }
    setDocState("working");
    try {
      await updateCallDoc({
        callDocId: callDoc._id,
        title: callTitle,
        contentHtml,
        contentJson
      });
      setDocDraft(contentHtml);
      setDocState("saved");
      window.setTimeout(() => setDocState("idle"), 1500);
    } catch {
      setDocState("failed");
    }
  }

  function downloadDoc() {
    if (!callDoc || !docHasContent) {
      return;
    }
    const contentHtml = docEditor?.getHTML() ?? docDraft;
    const blob = new Blob([callDocHtmlDocument(callTitle, contentHtml)], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFileName(callTitle)}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setDocExportState("downloaded");
    window.setTimeout(() => setDocExportState("idle"), 1500);
  }

  function printDoc() {
    if (!callDoc || !docHasContent) {
      return;
    }
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setDocExportState("failed");
      return;
    }
    setDocExportState("printing");
    const contentHtml = docEditor?.getHTML() ?? docDraft;
    printWindow.document.open();
    printWindow.document.write(callDocHtmlDocument(callTitle, contentHtml));
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => {
      printWindow.print();
      setDocExportState("idle");
    }, 250);
  }

  if (isLoading || data === undefined) {
    return (
      <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 pb-20 pt-6 md:px-6">
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Loading call record...
          </CardContent>
        </Card>
      </main>
    );
  }

  if (data === null) {
    return (
      <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 pb-20 pt-6 md:px-6">
        <Card>
          <CardHeader>
            <Badge variant="primary" className="w-fit">Not found</Badge>
            <CardTitle>We could not find that call.</CardTitle>
            <CardDescription>Go back to the dashboard and open a recent call.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="secondary">
              <a href="/dashboard">
                <ArrowLeft className="size-4" />
                Back to dashboard
              </a>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const recordProfile = dashboardIndustryProfileForId(data.callSession.industryProfile);
  const attachedTagIds = new Set((data.tags ?? []).map((tag: { _id: string }) => tag._id));
  const tagList = (tagOptions ?? []) as Array<{ _id: Id<"tags">; label: string; color?: string }>;
  const attachedTags = tagList.filter((tag) => attachedTagIds.has(tag._id));
  const docToolbarButtonClass = (active: boolean) => active
    ? "size-11 shrink-0 border-[#0A192F] bg-[#0A192F] text-[#F6EFE2] hover:border-[#0A192F] hover:bg-[#0A192F] hover:text-[#F6EFE2] sm:size-9"
    : "size-11 shrink-0 border-[#D7CBB9] bg-transparent text-[#0A192F] hover:border-[#B9AD9C] hover:bg-[#EFE5D3] hover:text-[#0A192F] sm:size-9";

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 pb-20 pt-6 md:px-6">
      <Card
        style={{
          "--mode-accent": recordProfile.accent,
          "--mode-card-bg": recordProfile.accent
        } as CSSProperties}
      >
        <CardHeader className="gap-5 p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <Button asChild className="-ml-2 px-2" size="sm" variant="ghost">
              <a href="/dashboard">
                <ArrowLeft className="size-4" />
                Dashboard
              </a>
            </Button>
            <div className="flex items-center gap-2">
              <Badge variant={badge.variant}>
                {badge.label}
              </Badge>
              {shareUrl ? (
                <Button
                  disabled={shareState === "working"}
                  onClick={copyShareLink}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <Link2 className="size-4" />
                  {shareState === "copied" ? "Copied" : "Copy link"}
                </Button>
              ) : (
                <Button
                  disabled={shareState === "working"}
                  onClick={createShareLink}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <Share2 className="size-4" />
                  {shareState === "working" ? "Creating" : "Share"}
                </Button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-4 sm:grid-cols-[80px_minmax(0,1fr)] sm:items-center">
            <IndustryProfileCard
              className="size-16 !rounded-md sm:size-20"
              profile={recordProfile}
              type="div"
            />
            <div className="grid min-w-0 gap-2">
              <IndustryProfileBadge className="w-fit" profile={recordProfile} />
              <CardTitle className="max-w-3xl text-2xl sm:text-3xl md:text-4xl">
                {identityEditing ? (
                  <Input
                    autoFocus
                    aria-label="Call identity"
                    className="h-auto rounded-none border-0 border-b border-primary/60 bg-transparent p-0 text-left font-[inherit] text-[length:inherit] leading-[inherit] text-card-foreground shadow-none outline-none focus-visible:border-primary focus-visible:ring-0 focus-visible:ring-offset-0"
                    onBlur={(event) => void saveIdentity(event.currentTarget.value)}
                    onChange={(event) => setIdentityDraft(event.target.value)}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setIdentityDraft(callTitle === "Sidetone call" ? "" : callTitle);
                        setIdentityEditing(false);
                        setIdentityState("idle");
                      }
                    }}
                    placeholder="Name this call"
                    value={identityDraft}
                  />
                ) : (
                  <button
                    aria-label="Edit call identity"
                    className="group/title inline-flex max-w-full cursor-text items-start gap-2 border-b border-dashed border-current/35 pb-1 text-left transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    onClick={() => {
                      setIdentityDraft(callTitle === "Sidetone call" ? "" : callTitle);
                      setIdentityEditing(true);
                      setIdentityState("idle");
                    }}
                    type="button"
                  >
                    <span className="min-w-0 break-words">
                      {identityState === "saving" ? "Saving..." : callTitle}
                    </span>
                    <Pencil className="mt-1 size-5 shrink-0 opacity-55 transition group-hover/title:opacity-100" aria-hidden="true" />
                  </button>
                )}
              </CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-6 sm:text-base">
                {callSubtitle}
              </CardDescription>
              <div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
                <Tag className="size-4 shrink-0 text-primary" />
                {attachedTags.map((tag) => (
                  <Button
                    className="h-7 gap-1.5 rounded-full px-2.5 text-xs"
                    key={tag._id}
                    onClick={() => toggleExistingTag(tag._id, true)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {tag.label}
                    <X className="size-3" />
                  </Button>
                ))}
                <details className="group w-full">
                  <summary className="flex h-7 w-fit cursor-pointer list-none items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-semibold text-muted-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                    <Plus className="size-3.5" />
                    Tags
                  </summary>
                  <div className="mt-2 grid max-w-md gap-3 rounded-md border border-border bg-card p-3">
                    {tagList.length ? (
                      <div className="flex flex-wrap gap-2">
                        {tagList.map((tag) => {
                          const attached = attachedTagIds.has(tag._id);
                          return (
                            <Button
                              className="h-8 gap-1.5 rounded-full px-3 text-xs"
                              key={tag._id}
                              onClick={() => toggleExistingTag(tag._id, attached)}
                              size="sm"
                              type="button"
                              variant={attached ? "secondary" : "ghost"}
                            >
                              {attached ? <X className="size-3" /> : <Plus className="size-3" />}
                              {tag.label}
                            </Button>
                          );
                        })}
                      </div>
                    ) : null}
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        className="h-10"
                        onChange={(event) => setTagDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void addTag();
                          }
                        }}
                        placeholder="Add tag"
                        value={tagDraft}
                      />
                      <Button disabled={!tagDraft.trim() || tagState === "saving"} onClick={addTag} type="button" variant="secondary">
                        {tagState === "saving" ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                        {tagState === "failed" ? "Try again" : "Add"}
                      </Button>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </div>
          {shareUrl || shareState === "failed" || shareState === "disabled" ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {shareUrl ? "Anyone with the share link can view this call record." : null}
              {shareState === "disabled" ? " Sharing is off." : null}
              {shareState === "failed" ? " Could not update the link. Try again." : null}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-5 px-4 pb-4 sm:px-6 sm:pb-6">
          <section className="grid gap-3 border-t border-border pt-4">
            {readyRecordings.length ? (
              readyRecordings.map((recording: {
                _id: string;
                durationMs?: number;
                recordingStartedAt?: number;
                format?: string;
              }, index: number) => {
                const recordingUrl = `/api/calls/${callSessionId}/recording?recordingId=${recording._id}`;
                const downloadUrl = `${recordingUrl}&download=1`;
                const meta = [
                  formatDuration(recording.durationMs),
                  (recording.format ?? "mp3").toUpperCase()
                ].filter(Boolean).join(" · ");
                return (
                  <div className="grid gap-3" key={recording._id}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                        <FileAudio aria-hidden="true" className="size-4 text-primary" />
                        <span>
                          {readyRecordings.length > 1 ? `Recording ${index + 1}` : "Recording"}
                          {meta ? <span className="text-muted-foreground/70"> &middot; {meta}</span> : null}
                        </span>
                      </div>
                      <Button asChild size="sm" variant="secondary">
                        <a href={downloadUrl}>
                          <Download className="size-4" />
                          Download recording
                        </a>
                      </Button>
                    </div>
                    <audio className="w-full" controls preload="metadata" src={recordingUrl}>
                      <a href={downloadUrl}>Download the call recording</a>
                    </audio>
                  </div>
                );
              })
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileAudio aria-hidden="true" className="size-4 text-primary" />
                <span>{recordingPlaceholderText}</span>
              </div>
            )}
          </section>

          <section className="grid gap-5 border-t border-border pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Notes</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => setNotesEditorOpen(true)} size="sm" type="button">
                  <FileText className="size-4" />
                  Edit notes
                </Button>
              </div>
            </div>
            {disclosureOnlyTranscript ? (
              <div className="flex gap-3 border border-warning/40 bg-warning/10 p-4 text-sm leading-6 text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <div className="grid gap-1">
                  <p className="font-semibold text-foreground">No conversation audio was captured.</p>
                  <p>
                    Sidetone only heard its own setup prompt. The phone participant may still appear joined
                    in Meet or your dialer, but the Sidetone phone leg did not receive the conversation audio. This
                    usually means the leg was held, muted, or not connected to the active audio mix.
                  </p>
                </div>
              </div>
            ) : null}
            {artifactIsStale ? (
              <p className="text-sm leading-6 text-accent">
                More transcript arrived after these notes were written. Sidetone is refreshing them.
              </p>
            ) : null}
            <div className="grid gap-5">
              <div className="grid gap-3">
                <p className="font-semibold">Summary</p>
                {artifact?.summary ? (
                  <p className="text-base leading-8 text-muted-foreground">
                    {artifact.summary}
                  </p>
                ) : callFailed ? (
                  <EmptyList text={data.callSession.failureReason ?? "This call did not connect. Try again from the dashboard."} />
                ) : (
                  <EmptyList
                    text={
                      data.segments.length
                        ? "Sidetone is turning the transcript into notes."
                        : "Sidetone is still waiting for transcript from this call."
                    }
                  />
                )}
              </div>
              <div className="grid gap-5 md:grid-cols-3">
                <div className="grid gap-3 border-t border-border pt-4">
                  <p className="font-semibold">Action items</p>
                  {artifact?.actionItems.length ? (
                    artifact.actionItems.map((item: string) => (
                      <div className="flex items-start gap-2 text-sm leading-6" key={item}>
                        <CheckCircle2 className="mt-1 size-4 shrink-0 text-success" />
                        <span>{item}</span>
                      </div>
                    ))
                  ) : callFailed ? (
                    <EmptyList text="Start a new call once the phone setup is ready." />
                  ) : (
                    <EmptyList text="No clear action items found yet." />
                  )}
                </div>
                <div className="grid gap-3 border-t border-border pt-4">
                  <p className="font-semibold">Decisions</p>
                  {artifact?.decisions.length ? (
                    artifact.decisions.map((decision: string) => (
                      <p className="text-sm leading-6 text-muted-foreground" key={decision}>
                        {decision}
                      </p>
                    ))
                  ) : (
                    <EmptyList text="No explicit decisions captured." />
                  )}
                </div>
                <div className="grid gap-3 border-t border-border pt-4">
                  <p className="font-semibold">Risks</p>
                  {artifact?.risks.length ? (
                    artifact.risks.map((risk: string) => (
                      <p className="text-sm leading-6 text-muted-foreground" key={risk}>
                        {risk}
                      </p>
                    ))
                  ) : (
                    <EmptyList text="No obvious blockers captured." />
                  )}
                </div>
              </div>
            </div>
          </section>
        </CardContent>
      </Card>

      {notesLabEnabled ? (
        <section className="grid gap-6">
          <Card>
            <CardHeader className="gap-3 p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <FlaskConical className="size-4 text-primary" />
                  <CardTitle className="text-3xl">Notes lab</CardTitle>
                </div>
                <Badge variant="primary">Private</Badge>
              </div>
              <CardDescription>
                Generate saved comparison notes without changing the active notes or share link.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 px-6 pb-6 md:px-8 md:pb-8">
              <div className="grid gap-4 border-t border-border pt-5 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
                <div className="grid gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Provider</p>
                  <div className="flex flex-wrap gap-2">
                    {NOTES_LAB_PROVIDERS.map((provider) => (
                      <Button
                        key={provider.provider}
                        onClick={() => setLabProvider(provider.provider)}
                        size="sm"
                        type="button"
                        variant={labProvider === provider.provider ? "secondary" : "ghost"}
                      >
                        {provider.providerLabel}
                      </Button>
                    ))}
                  </div>
                </div>
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Model</span>
                  <select
                    className="h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onChange={(event) => setLabModelId(event.target.value)}
                    value={selectedLabModel?.modelId ?? ""}
                  >
                    {labModelOptions.map((model) => (
                      <option key={model.modelId} value={model.modelId}>
                        {model.modelLabel} · {model.tierLabel}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  disabled={!transcript.trim() || labGenerateState === "working" || !selectedLabModel}
                  onClick={generateLabNotes}
                  type="button"
                >
                  {labGenerateState === "working" ? <LoaderCircle className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
                  {labGenerateState === "done"
                    ? "Saved"
                    : labGenerateState === "failed"
                      ? "Try again"
                      : "Generate lab notes"}
                </Button>
              </div>

              {labError ? (
                <p className="text-sm leading-6 text-destructive">{labError}</p>
              ) : null}

              <div className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold">Lab generations</p>
                  {labListState === "loading" ? (
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <LoaderCircle className="size-3 animate-spin" />
                      Loading
                    </span>
                  ) : null}
                </div>
                {labRuns.length ? (
                  <div className="grid border-t border-border">
                    {labRuns.map((run) => {
                      const expanded = expandedLabRunIds.has(run._id);
                      return (
                        <div className="grid gap-3 border-b border-border py-4" key={run._id}>
                          <button
                            className="flex w-full items-start justify-between gap-3 text-left"
                            onClick={() => toggleLabRun(run._id)}
                            type="button"
                          >
                            <span className="grid gap-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">{run.modelLabel}</span>
                                <Badge variant={run.status === "ready" ? "success" : "danger"}>
                                  {run.status === "ready" ? "Ready" : "Failed"}
                                </Badge>
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {formatDateTime(run.createdAt)}
                                {run.summary ? ` · ${run.summary.slice(0, 120)}${run.summary.length > 120 ? "..." : ""}` : null}
                                {run.error ? ` · ${run.error.slice(0, 120)}${run.error.length > 120 ? "..." : ""}` : null}
                              </span>
                            </span>
                            {expanded ? (
                              <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                            )}
                          </button>

                          {expanded ? (
                            <div className="grid gap-4 pl-1">
                              {run.summary ? (
                                <p className="text-sm leading-6 text-muted-foreground">{run.summary}</p>
                              ) : null}
                              {run.actionItems.length ? (
                                <div className="grid gap-2">
                                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Action items</p>
                                  {run.actionItems.map((item) => (
                                    <div className="flex items-start gap-2 text-sm leading-6" key={item}>
                                      <CheckCircle2 className="mt-1 size-4 shrink-0 text-success" />
                                      <span>{item}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {run.decisions.length ? (
                                <div className="grid gap-2">
                                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Decisions</p>
                                  {run.decisions.map((decision) => (
                                    <p className="text-sm leading-6" key={decision}>{decision}</p>
                                  ))}
                                </div>
                              ) : null}
                              {run.risks.length ? (
                                <div className="grid gap-2">
                                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Risks</p>
                                  {run.risks.map((risk) => (
                                    <p className="text-sm leading-6" key={risk}>{risk}</p>
                                  ))}
                                </div>
                              ) : null}
                              {run.error ? (
                                <p className="text-sm leading-6 text-destructive">{run.error}</p>
                              ) : null}
                              <div className="flex flex-wrap gap-2">
                                <Button onClick={() => copyLabRun(run)} size="sm" type="button" variant="secondary">
                                  <Copy className="size-4" />
                                  {labCopyRunId === run._id ? "Copied" : "Copy lab notes"}
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyList
                    text={
                      labListState === "failed"
                        ? "Could not load lab generations."
                        : "No lab generations saved yet."
                    }
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {notesEditorOpen ? (
        <div
          aria-labelledby="notes-editor-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#061426]/70 p-3 backdrop-blur-sm sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setNotesEditorOpen(false);
            }
          }}
          role="dialog"
        >
          <div className="grid max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
              <div className="grid gap-1">
                <h2 className="text-lg font-black" id="notes-editor-title">Edit notes</h2>
                <p className="text-sm text-muted-foreground">{callTitle}</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button disabled={docState === "working"} onClick={generateDoc} size="sm" type="button" variant="secondary">
                  {docState === "working" ? <LoaderCircle className="size-4 animate-spin" /> : <FileText className="size-4" />}
                  {callDoc ? "Regenerate" : "Generate"}
                </Button>
                {callDoc ? (
                  <Button disabled={docState === "working" || !docHasContent} onClick={saveDoc} size="sm" type="button">
                    {docState === "saved" ? "Saved" : docState === "failed" ? "Try again" : "Save"}
                  </Button>
                ) : null}
                {callDoc ? (
                  <>
                    <Button disabled={!docHasContent} onClick={downloadDoc} size="sm" type="button" variant="ghost">
                      <Download className="size-4" />
                      {docExportState === "downloaded" ? "Downloaded" : "Download"}
                    </Button>
                    <Button disabled={!docHasContent || docExportState === "printing"} onClick={printDoc} size="sm" type="button" variant="ghost">
                      {docExportState === "printing" ? <LoaderCircle className="size-4 animate-spin" /> : <Printer className="size-4" />}
                      PDF
                    </Button>
                  </>
                ) : null}
                <Button aria-label="Close notes editor" onClick={() => setNotesEditorOpen(false)} size="icon" type="button" variant="ghost">
                  <X className="size-4" />
                </Button>
              </div>
            </div>
            <div className="grid max-h-[calc(92vh-6rem)] gap-4 overflow-y-auto p-4 sm:p-5">
              {callDoc ? (
                <>
                  <div className="overflow-hidden rounded-md border border-border bg-[#FCF9F2]">
                    <div className="flex items-center gap-2 overflow-x-auto border-b border-[#D7CBB9] bg-[#F6EFE2] px-2 py-2 sm:flex-wrap sm:px-3">
                      <Button
                        aria-label="Heading 1"
                        className={docToolbarButtonClass(Boolean(docEditor?.isActive("heading", { level: 1 })))}
                        disabled={!docEditor}
                        onClick={() => docEditor?.chain().focus().toggleHeading({ level: 1 }).run()}
                        size="icon"
                        title="Heading 1"
                        type="button"
                        variant="ghost"
                      >
                        <Heading1 className="size-4" />
                      </Button>
                      <Button
                        aria-label="Heading 2"
                        className={docToolbarButtonClass(Boolean(docEditor?.isActive("heading", { level: 2 })))}
                        disabled={!docEditor}
                        onClick={() => docEditor?.chain().focus().toggleHeading({ level: 2 }).run()}
                        size="icon"
                        title="Heading 2"
                        type="button"
                        variant="ghost"
                      >
                        <Heading2 className="size-4" />
                      </Button>
                      <Button
                        aria-label="Bold"
                        className={docToolbarButtonClass(Boolean(docEditor?.isActive("bold")))}
                        disabled={!docEditor}
                        onClick={() => docEditor?.chain().focus().toggleBold().run()}
                        size="icon"
                        title="Bold"
                        type="button"
                        variant="ghost"
                      >
                        <Bold className="size-4" />
                      </Button>
                      <Button
                        aria-label="Italic"
                        className={docToolbarButtonClass(Boolean(docEditor?.isActive("italic")))}
                        disabled={!docEditor}
                        onClick={() => docEditor?.chain().focus().toggleItalic().run()}
                        size="icon"
                        title="Italic"
                        type="button"
                        variant="ghost"
                      >
                        <Italic className="size-4" />
                      </Button>
                      <Button
                        aria-label="Bullet list"
                        className={docToolbarButtonClass(Boolean(docEditor?.isActive("bulletList")))}
                        disabled={!docEditor}
                        onClick={() => docEditor?.chain().focus().toggleBulletList().run()}
                        size="icon"
                        title="Bullet list"
                        type="button"
                        variant="ghost"
                      >
                        <List className="size-4" />
                      </Button>
                      <Button
                        aria-label="Quote"
                        className={docToolbarButtonClass(Boolean(docEditor?.isActive("blockquote")))}
                        disabled={!docEditor}
                        onClick={() => docEditor?.chain().focus().toggleBlockquote().run()}
                        size="icon"
                        title="Quote"
                        type="button"
                        variant="ghost"
                      >
                        <Quote className="size-4" />
                      </Button>
                    </div>
                    <EditorContent editor={docEditor} />
                  </div>
                  {docState === "failed" ? (
                    <p className="text-sm text-destructive">Could not save these notes. Try again.</p>
                  ) : null}
                  {docExportState === "failed" ? (
                    <p className="text-sm text-destructive">Could not open print. Check popup settings, or download the notes instead.</p>
                  ) : null}
                </>
              ) : (
                <div className="grid gap-4 border-t border-border py-5">
                  <div className="grid gap-2">
                    <p className="text-lg font-black text-foreground">No editable notes yet.</p>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      Generate editable notes from this call, then refine them here before exporting or sharing.
                    </p>
                  </div>
                  <Button className="w-fit" disabled={docState === "working"} onClick={generateDoc} type="button" variant="secondary">
                    {docState === "working" ? <LoaderCircle className="size-4 animate-spin" /> : <FileText className="size-4" />}
                    Generate notes
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <section className="grid gap-6">
        <Card>
          <CardHeader className="gap-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Transcript</CardTitle>
              <Button
                disabled={!transcriptForCopy.trim()}
                onClick={copyTranscript}
                size="sm"
                type="button"
                variant="secondary"
              >
                <Copy className="size-4" />
                {transcriptCopyState === "copied"
                  ? "Transcript copied"
                  : transcriptCopyState === "failed"
                    ? "Copy failed"
                    : "Copy transcript"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 px-6 pb-6">
            {data.segments.length ? (
              <div className="grid max-h-[420px] overflow-auto border-t border-border">
                {data.segments.map((segment: { _id: string; startMs: number; text: string }) => (
                  <div className="grid gap-1 border-b border-border py-3 text-sm leading-6" key={segment._id}>
                    <span className="font-mono text-xs uppercase tracking-[0.18em] text-primary">
                      {formatTime(segment.startMs)}
                    </span>
                    <span className="text-muted-foreground">{segment.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyList text={transcript || "No transcript segments have arrived yet."} />
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
