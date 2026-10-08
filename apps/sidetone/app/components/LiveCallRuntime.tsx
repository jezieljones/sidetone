"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { PhoneOff, Sparkles } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CallRecordPreview } from "./CallRecordPreview";
import { LiveNotesPreview } from "./LiveNotesPreview";
import { IndustryProfileBadge, IndustryProfileCard } from "./IndustryProfileCard";
import { dashboardIndustryProfileForId } from "../lib/brand-system";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "primary" | "accent";

type CallLeg = {
  _id: string;
  role: "owner" | "external" | "sidetone";
  phoneNumber?: string;
  status: "ringing" | "answered" | "ended" | "failed";
};

function statusView(status?: string): { label: string; variant: BadgeVariant; canEnd: boolean } {
  switch (status) {
    case "connecting":
      return { label: "Starting", variant: "warning", canEnd: true };
    case "live":
      return { label: "Live", variant: "success", canEnd: true };
    case "processing":
      return { label: "Writing notes", variant: "accent", canEnd: false };
    case "ready":
      return { label: "Notes ready", variant: "success", canEnd: false };
    case "failed":
      return { label: "Call failed", variant: "danger", canEnd: false };
    case "cancelled":
      return { label: "Ended", variant: "neutral", canEnd: false };
    case undefined:
      return { label: "Loading", variant: "neutral", canEnd: false };
    default:
      return { label: status, variant: "neutral", canEnd: false };
  }
}

function transcriptTextIsMeaningful(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized.length < 12) {
    return false;
  }

  return !/this call is being recorded and transcribed by (sidetone|scitone|cytone)|welcome to sidetone|tap add call|merge calls|start taking notes/i.test(normalized);
}

function activeCallStatusLabel(
  status: string | undefined,
  hasMeaningfulSpeech: boolean,
  hasAnyTranscript: boolean,
  callMode?: string
) {
  if (status === "ready") {
    return { label: "Notes ready", variant: "success" as BadgeVariant };
  }
  if (status === "connecting" && callMode === "vexa_meeting") {
    return { label: "Joining meeting", variant: "warning" as BadgeVariant };
  }
  if (status === "connecting" && callMode === "zoom_rtms") {
    return { label: "Waiting for Zoom RTMS", variant: "warning" as BadgeVariant };
  }
  if (status === "processing") {
    return { label: "Writing notes", variant: "accent" as BadgeVariant };
  }
  if (status === "failed") {
    return { label: "Call failed", variant: "danger" as BadgeVariant };
  }
  if (status === "cancelled") {
    return { label: "Ended", variant: "neutral" as BadgeVariant };
  }
  if (hasMeaningfulSpeech) {
    return { label: "Hearing audio", variant: "success" as BadgeVariant };
  }
  if (hasAnyTranscript) {
    return { label: "Sidetone connected", variant: "warning" as BadgeVariant };
  }
  return { label: "Waiting to hear the conversation", variant: "warning" as BadgeVariant };
}

function personaRuntimeCopy(input: {
  personaName: string;
  profileLabel: string;
  status?: string;
  callMode?: string;
  showMergeReminder?: boolean;
  callFocusText?: string | null;
}) {
  if (input.status === "connecting" && input.callMode === "vexa_meeting") {
    return {
      title: `${input.personaName} is joining the meeting.`,
      description: "Admit Sidetone when the waiting room prompt appears. Notes will start after the bot is admitted."
    };
  }

  if (input.status === "connecting" && input.callMode === "zoom_rtms") {
    return {
      title: `${input.personaName} is waiting for Zoom RTMS.`,
      description: "Start the Sidetone RTMS app in Zoom. Notes begin when Zoom sends transcript and audio."
    };
  }

  if (input.status === "connecting" || input.status === "live") {
    return {
      title: `${input.personaName} is on the line.`,
      description: input.showMergeReminder
        ? "If this is part of another phone call, tap Merge in your phone app."
        : input.callFocusText
          ? `${input.profileLabel} profile is on. Sidetone is listening for ${input.callFocusText}.`
          : `${input.profileLabel} profile is on. Sidetone is listening and writing notes from this call only.`
    };
  }

  if (input.status === "processing") {
    return {
      title: `${input.personaName} is writing it up.`,
      description: "The call has ended. Sidetone is turning the captured audio into a call record."
    };
  }

  if (input.status === "ready") {
    return {
      title: `${input.personaName} finished the record.`,
      description: "The call has ended. Your call record is ready."
    };
  }

  if (input.status === "failed") {
    return {
      title: `${input.personaName} dropped.`,
      description: "This call did not finish cleanly. Check the call path before trying again."
    };
  }

  return {
    title: `${input.personaName} left the call.`,
    description: "This Sidetone session is no longer active."
  };
}

function formatTimestamp(startMs: number) {
  const totalSeconds = Math.max(0, Math.floor(startMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function legStatusLabel(status?: string) {
  switch (status) {
    case "ringing":
      return "Calling";
    case "answered":
      return "Connected";
    case "ended":
      return "Ended";
    case "failed":
      return "Could not connect";
    default:
      return "Waiting";
  }
}

function legStatusVariant(status?: string): BadgeVariant {
  switch (status) {
    case "answered":
      return "success";
    case "ringing":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

function RealConnectionPanel({
  failureReason,
  legs,
  mode,
  status
}: {
  failureReason?: string;
  legs: CallLeg[];
  mode?: string;
  status?: string;
}) {
  const ownerLeg = legs.find((leg) => leg.role === "owner");
  const externalLeg = legs.find((leg) => leg.role === "external");
  const externalEndedBeforeAnswer = externalLeg?.status === "ended" && status === "failed";
  const sidetoneSession = mode === "sidetone_session";
  const conferenceIn = mode === "conference_in";
  const meetingMode = mode === "vexa_meeting" || mode === "zoom_rtms";
  const discordMode = mode === "discord_voice";
  const callPathCopy = sidetoneSession
    ? status === "ready"
      ? "Sidetone has finished this session and saved the record."
      : status === "processing"
        ? "Sidetone is turning the captured audio into notes."
        : "Sidetone is on your phone. Add people from your normal call screen whenever you are ready."
    : mode === "zoom_rtms"
      ? status === "ready"
        ? "Zoom RTMS has finished and Sidetone saved the record."
        : status === "processing"
          ? "Sidetone is turning the Zoom RTMS transcript and audio into notes."
          : status === "connecting"
            ? "Sidetone is waiting for Zoom to start the RTMS stream."
            : "Zoom is streaming transcript and audio to Sidetone."
    : mode === "vexa_meeting"
      ? status === "ready"
        ? "Sidetone has finished this meeting and saved the record."
        : status === "processing"
          ? "Sidetone is turning the meeting transcript into notes."
          : "Sidetone is capturing this meeting."
    : discordMode
      ? status === "ready"
        ? "Sidetone has finished this Discord voice capture and saved the record."
        : status === "processing"
          ? "Sidetone is turning the Discord voice recording into notes."
          : "Sidetone is recording this Discord voice channel for notes."
    : conferenceIn
      ? status === "ready"
        ? "Sidetone has finished this call and saved the record."
        : status === "processing"
          ? "Sidetone is turning the captured audio into notes."
          : "Sidetone joined an existing phone call and is writing the notes."
      : externalEndedBeforeAnswer
        ? failureReason ?? "The other person did not answer."
        : externalLeg?.status === "answered"
          ? status === "ready"
            ? "Both sides were connected. The call record is ready."
            : "Both sides are connected."
          : externalLeg?.status === "ringing"
            ? "Calling the other person now."
            : "Sidetone is preparing the call.";
  const pathLabel = mode === "zoom_rtms"
    ? "Zoom RTMS"
    : meetingMode
      ? "Meeting"
      : discordMode
        ? "Discord voice"
        : "Call path";

  return (
    <div className="grid gap-4 border-y border-border py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
            {pathLabel}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {callPathCopy}
          </p>
        </div>
        {failureReason && status === "failed" ? (
          <Badge variant="danger">Needs retry</Badge>
        ) : null}
      </div>
      {meetingMode || discordMode ? null : (
        <div className={`grid divide-y divide-border border-t border-border ${sidetoneSession || conferenceIn ? "" : "md:grid-cols-2 md:divide-x md:divide-y-0"}`}>
          <div className="py-3 md:pr-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{conferenceIn ? "Caller" : "Your phone"}</span>
              <Badge variant={legStatusVariant((conferenceIn ? externalLeg : ownerLeg)?.status)}>
                {legStatusLabel((conferenceIn ? externalLeg : ownerLeg)?.status)}
              </Badge>
            </div>
            {(conferenceIn ? externalLeg : ownerLeg)?.phoneNumber ? (
              <p className="mt-2 text-sm text-muted-foreground">{(conferenceIn ? externalLeg : ownerLeg)?.phoneNumber}</p>
            ) : null}
          </div>
          {sidetoneSession || conferenceIn ? null : (
            <div className="py-3 md:pl-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">Other person</span>
                <Badge variant={legStatusVariant(externalLeg?.status)}>{legStatusLabel(externalLeg?.status)}</Badge>
              </div>
              {externalLeg?.phoneNumber ? (
                <p className="mt-2 text-sm text-muted-foreground">{externalLeg.phoneNumber}</p>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RealLiveNotes({
  segments,
  showMergeReminder
}: {
  segments: Array<{ _id: string; startMs: number; text: string; speakerLabel?: string }>;
  showMergeReminder?: boolean;
}) {
  if (!segments.length) {
    return (
      <div className="border-t border-border pt-5">
        <div className="flex items-center justify-between gap-3">
          <Badge variant="accent">Live notes</Badge>
          <Sparkles className="size-5 text-accent" />
        </div>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">
          {showMergeReminder
            ? "If you're on another call, tap Merge so Sidetone can hear both sides."
            : "Sidetone is connected. Notes will appear after it hears the conversation."}
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-border pt-5">
      <div className="flex items-center justify-between gap-3">
        <Badge variant="accent">Live notes</Badge>
        <Sparkles className="size-5 text-accent" />
      </div>
      {showMergeReminder ? (
        <div className="mt-4 border-l-2 border-primary bg-primary/10 px-4 py-3 text-sm leading-6 text-muted-foreground">
          If you&apos;re on another call, tap Merge so Sidetone can hear both sides.
        </div>
      ) : null}
      <div className="mt-4 grid">
        {segments.slice(-4).map((segment) => (
          <div className="border-t border-border/70 py-4 first:border-t-0 first:pt-0 last:pb-0" key={segment._id}>
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-primary">
              <span className="rounded-full bg-primary/10 px-2 py-1 font-mono text-xs uppercase tracking-[0.18em]">
                {formatTimestamp(segment.startMs)}
              </span>
              <span>{segment.speakerLabel ?? "Call note"}</span>
            </div>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">{segment.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConversationEnhancementCards({
  cards
}: {
  cards: Array<{
    _id: string;
    kind?: string;
    title?: string;
    body?: string;
    reason: string;
    priority: string;
    actionLabel?: string;
    actionHref?: string;
  }>;
}) {
  const cardText = (card: { title?: string; body?: string; reason: string }) =>
    `${card.title ?? ""} ${card.body ?? ""} ${card.reason}`;
  const cardFingerprint = (card: { title?: string; body?: string; reason: string }) => cardText(card)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const visibleCards = cards.filter((card, index) => {
    const fingerprint = cardFingerprint(card);
    return cards.findIndex((candidate) => cardFingerprint(candidate) === fingerprint) === index;
  });

  if (!visibleCards.length) {
    return (
      <Card>
        <CardHeader>
          <Badge variant="neutral" className="w-fit">Live signals</Badge>
          <CardTitle className="text-2xl">Nothing to show yet.</CardTitle>
          <CardDescription>
            Sidetone will show a private card only when it has a specific, useful signal from this call.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="enamel-panel overflow-hidden">
      {visibleCards.map((card, index) => (
        <div
          className={index === 0 ? "grid gap-3 bg-primary/10 p-4" : "grid gap-3 border-t border-border p-4"}
          key={card._id}
        >
          <Badge variant={index === 0 ? "accent" : "neutral"} className="w-fit">
            Live signal
          </Badge>
          <p className="text-lg font-semibold">{card.title}</p>
          {card.body ? <p className="text-sm leading-6 text-foreground">{card.body}</p> : null}
          <p className="text-sm leading-6 text-muted-foreground">{card.reason}</p>
          {card.actionHref && card.actionLabel ? (
            <Button asChild className="w-fit" size="sm" variant="secondary">
              <a href={card.actionHref}>{card.actionLabel}</a>
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RealAfterCallPanel({
  status,
  artifact
}: {
  status?: string;
  artifact?: {
    status: string;
    summary?: string;
    actionItems: string[];
  } | null;
}) {
  if (artifact?.status === "ready") {
    return (
      <Card>
        <CardHeader>
          <Badge variant="success" className="w-fit">Ready after call</Badge>
          <CardTitle className="text-2xl">Call record</CardTitle>
          <CardDescription>{artifact.summary ?? "The post-call record is ready."}</CardDescription>
        </CardHeader>
        {artifact.actionItems.length ? (
          <CardContent className="grid gap-2">
            {artifact.actionItems.slice(0, 3).map((item) => (
              <p className="border-t border-border pt-3 text-sm leading-6 text-muted-foreground" key={item}>
                {item}
              </p>
            ))}
          </CardContent>
        ) : null}
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <Badge variant={status === "processing" ? "accent" : "neutral"} className="w-fit">
          {status === "processing" ? "Writing notes" : "After the call"}
        </Badge>
        <CardTitle className="text-2xl">
          {status === "processing" ? "Building the record." : "End the call when you are done."}
        </CardTitle>
        <CardDescription>
          {status === "processing"
            ? "Summary and action items will appear on the call record."
            : "Sidetone will turn the real transcript into a clean summary and next steps."}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function LiveCallLoading() {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 pb-20 pt-6 md:px-6">
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
          <Sparkles className="size-4 animate-pulse" />
          Loading live call...
        </CardContent>
      </Card>
    </main>
  );
}

function LiveCallUnavailable() {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 pb-20 pt-6 md:px-6">
      <Card>
        <CardHeader>
          <Badge variant="danger" className="w-fit">Call unavailable</Badge>
          <CardTitle>We could not find that live call.</CardTitle>
          <CardDescription>Go back to the dashboard and open a recent call.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="secondary">
            <a href="/dashboard">Back to dashboard</a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function DemoLiveCall() {
  const currentProfile = dashboardIndustryProfileForId("general");

  return (
    <main
      className="mx-auto grid w-full max-w-7xl gap-6 px-4 pb-20 pt-6 md:px-6"
      style={{
        "--mode-accent": currentProfile.accent,
        "--mode-card-bg": currentProfile.accent
      } as CSSProperties}
    >
      <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader className="gap-5 p-6 md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge variant="success">Live call</Badge>
              <span className="font-mono text-sm text-muted-foreground">demo</span>
            </div>
            <div className="grid gap-5 sm:grid-cols-[180px_1fr] sm:items-center">
              <IndustryProfileCard active profile={currentProfile} type="div" />
              <div>
                <IndustryProfileBadge className="mb-3 w-fit" profile={currentProfile} />
                <CardTitle className="text-5xl md:text-6xl">
                  {currentProfile.personaName} is on the line.
                </CardTitle>
                <CardDescription className="mt-3 text-lg leading-8">
                  {currentProfile.compactLabel} profile is on. Sidetone is listening for the call record.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5 px-6 pb-6 md:px-8 md:pb-8">
            <div>
              <p className="roster-eyebrow">Current profile</p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Persona-led call intelligence is ready. Add a Listen For note before the call to sharpen what Sidetone notices.
              </p>
            </div>
            <LiveNotesPreview framed={false} showTitle={false} variant="soccer" />
            <Button className="w-full" disabled variant="danger">
              <PhoneOff className="size-4" />
              Stop notes
            </Button>
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <CallRecordPreview variant="soccer" />
        </div>
      </section>
    </main>
  );
}

function AuthenticatedLiveCall({ callId }: { callId: string }) {
  const [isEnding, setIsEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [liveFocusText, setLiveFocusText] = useState("");
  const [focusState, setFocusState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const reminderSentRef = useRef(false);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const updateCallFocus = useMutation(api.crm.updateCallFocus);
  const data = useQuery(
    api.calls.callSessionLiveView,
    isLoading || !isAuthenticated ? "skip" : { callSessionId: callId as Id<"callSessions"> }
  );

  const meaningfulSegmentCount = useMemo(() => {
    if (!data || data === null) {
      return 0;
    }
    return (data.segments ?? []).filter((segment: { text: string }) => transcriptTextIsMeaningful(segment.text)).length;
  }, [data]);
  const hasAnyTranscript = Boolean(data && data !== null && (data.segments ?? []).length);
  const activeStartedAt = data && data !== null
    ? data.callSession.startedAt ?? data.callSession.createdAt
    : nowMs;
  const activeStatus = data && data !== null ? data.callSession.status : undefined;
  const callIsActive = activeStatus === "connecting" || activeStatus === "live";
  const showMergeReminder = Boolean(
    data
      && data !== null
      && callIsActive
      && !["vexa_meeting", "zoom_rtms", "discord_voice"].includes(data.callSession.mode)
      && meaningfulSegmentCount === 0
      && nowMs - activeStartedAt >= 30 * 1000
  );

  useEffect(() => {
    if (!callIsActive) {
      return;
    }

    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [callIsActive]);

  useEffect(() => {
    if (data && data !== null) {
      setLiveFocusText(data.callSession.callFocusText ?? "");
    }
  }, [data && data !== null ? data.callSession.callFocusText : undefined]);

  useEffect(() => {
    if (!showMergeReminder || reminderSentRef.current) {
      return;
    }

    reminderSentRef.current = true;
    void fetch(`/api/calls/${callId}/merge-reminder`, {
      method: "POST"
    }).catch((error) => {
      console.warn("Unable to send Sidetone merge reminder.", error);
    });
  }, [callId, showMergeReminder]);

  if (isLoading || data === undefined) {
    return <LiveCallLoading />;
  }

  if (data === null) {
    return <LiveCallUnavailable />;
  }

  const status = data.callSession.status;
  const callMode = data.callSession.mode;
  const currentStatus = statusView(status);
  const activityStatus = activeCallStatusLabel(status, meaningfulSegmentCount > 0, hasAnyTranscript, callMode);
  const currentProfile = dashboardIndustryProfileForId(data.callSession.industryProfile);
  const canStopNotes = currentStatus.canEnd;
  const personaCopy = personaRuntimeCopy({
    personaName: currentProfile.personaName,
    profileLabel: currentProfile.compactLabel,
    status,
    callMode,
    showMergeReminder,
    callFocusText: data.callSession.callFocusText
  });

  async function stopNotes() {
    setIsEnding(true);
    setEndError(null);
    try {
      const response = await fetch(callMode === "vexa_meeting" ? "/api/meetings/vexa/stop" : "/api/telnyx/stop-notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callSessionId: callId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to stop notes.");
      }
      window.location.href = `/calls/${callId}`;
    } catch (error) {
      setEndError(error instanceof Error ? error.message : "Unable to stop notes.");
    } finally {
      setIsEnding(false);
    }
  }

  async function saveFocus() {
    setFocusState("saving");
    try {
      await updateCallFocus({
        callSessionId: callId as Id<"callSessions">,
        callFocusText: liveFocusText.trim() || undefined,
        inputMethod: "typed"
      });
      setFocusState("saved");
      window.setTimeout(() => setFocusState("idle"), 1400);
    } catch {
      setFocusState("failed");
    }
  }

  return (
    <main
      className="mx-auto grid w-full max-w-6xl gap-6 px-4 pb-20 pt-6 md:px-6"
      style={{
        "--mode-accent": currentProfile.accent,
        "--mode-card-bg": currentProfile.accent
      } as CSSProperties}
    >
      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader className="gap-5 p-6 md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge variant={activityStatus.variant}>{activityStatus.label}</Badge>
              <div className="flex flex-wrap gap-2">
                <IndustryProfileBadge profile={currentProfile} />
                <Badge variant="accent">Call Intelligence</Badge>
                {canStopNotes ? (
                  <Button disabled={isEnding} onClick={stopNotes} size="sm" type="button" variant="danger">
                    {isEnding ? <Sparkles className="size-4 animate-pulse" /> : <PhoneOff className="size-4" />}
                    Stop notes
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-[180px_1fr] sm:items-center">
              <IndustryProfileCard active={callIsActive} profile={currentProfile} type="div" />
              <div>
                <CardTitle className="text-5xl md:text-6xl">
                  {personaCopy.title}
                </CardTitle>
                <CardDescription className="mt-3 text-lg leading-8">
                  {personaCopy.description}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5 px-6 pb-6 md:px-8 md:pb-8">
            <RealConnectionPanel
              failureReason={data.callSession.failureReason}
              legs={data.legs ?? []}
              mode={callMode}
              status={status}
            />
            <div className="grid gap-3 border-y border-border py-5">
              <label className="grid gap-2">
                <span className="text-sm font-semibold">Listen For</span>
                <textarea
                  className="min-h-20 rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onChange={(event) => setLiveFocusText(event.target.value)}
                  placeholder="What should Sidetone notice on this call?"
                  value={liveFocusText}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={focusState === "saving"} onClick={saveFocus} size="sm" type="button" variant="secondary">
                  {focusState === "saving" ? <Sparkles className="size-4 animate-pulse" /> : <Sparkles className="size-4" />}
                  {focusState === "saved" ? "Saved" : focusState === "failed" ? "Try again" : "Save Listen For"}
                </Button>
                <p className="text-xs leading-5 text-muted-foreground">
                  This sharpens future live signals without changing the persona.
                </p>
              </div>
            </div>
            <RealLiveNotes segments={data.segments ?? []} showMergeReminder={showMergeReminder} />
            {endError ? (
              <p className="text-sm leading-6 text-destructive">{endError}</p>
            ) : null}
            {!canStopNotes && callMode === "zoom_rtms" && callIsActive ? (
              <div className="border-t border-border pt-5 text-sm leading-6 text-muted-foreground">
                Stop the Sidetone RTMS app or end the Zoom meeting when you are done. Sidetone will write the record after Zoom closes the stream.
              </div>
            ) : !canStopNotes ? (
              <Button asChild className="w-full" variant="secondary">
                <a href={`/calls/${callId}`}>Open call record</a>
              </Button>
            ) : null}
            {canStopNotes ? (
              <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 shadow-lg backdrop-blur md:hidden">
                <Button className="w-full" disabled={isEnding} onClick={stopNotes} type="button" variant="danger">
                  {isEnding ? <Sparkles className="size-4 animate-pulse" /> : <PhoneOff className="size-4" />}
                  Stop notes
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <ConversationEnhancementCards cards={data.cards ?? []} />
          <RealAfterCallPanel artifact={data.artifact} status={status} />
        </div>
      </section>
    </main>
  );
}

export function LiveCallRuntime({ callId }: { callId: string }) {
  if (callId === "demo") {
    return <DemoLiveCall />;
  }

  return <AuthenticatedLiveCall callId={callId} />;
}
