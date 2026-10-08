import { fetchQuery } from "convex/nextjs";
import { CheckCircle2, Download, FileAudio } from "lucide-react";
import { notFound } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import { formatUsPhone } from "../../../lib/phone-format";
import { Badge } from "../../../components/ui/badge";
import { BrandLockup } from "../../../components/BrandMark";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { SharedCallTools } from "../../../components/SharedCallTools";
import { IndustryProfileBadge, IndustryProfileCard } from "../../../components/IndustryProfileCard";
import { dashboardIndustryProfileForId } from "../../../lib/brand-system";

export const dynamic = "force-dynamic";

function formatTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDateTime(timestamp?: number, timeZone?: string) {
  if (!timestamp) {
    return "Time unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone
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

function EmptyList({ text }: { text: string }) {
  return (
    <div className="border-t border-border py-4 text-sm leading-6 text-muted-foreground">
      {text}
    </div>
  );
}

type SharedContact = { displayName?: string; phoneNumber?: string };
type SharedRecording = {
  _id: string;
  status: string;
  recordingStartedAt?: number;
  durationMs?: number;
  format?: string;
};
type SharedSegment = { _id: string; startMs: number; text: string };

export default async function SharedCallRecordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const record = await fetchQuery(api.calls.publicCallRecordByShareToken, { shareToken: token });

  if (!record) {
    notFound();
  }

  const identityPhoneNumber = record.identityPhoneNumber;
  const matchingContact = identityPhoneNumber
    ? record.contacts.find((contact: SharedContact) => contact?.phoneNumber === identityPhoneNumber)
    : undefined;
  const artifact = record.artifact;
  const callTitle = matchingContact?.displayName
    || formatUsPhone(identityPhoneNumber)
    || callModeLabel(record.callSession.mode)
    || "Sidetone call";
  const callSubtitle = [
    callModeLabel(record.callSession.mode),
    matchingContact?.displayName ? formatUsPhone(identityPhoneNumber) : null,
    formatDateTime(record.callSession.startedAt ?? record.callSession.createdAt, record.entity?.timezone)
  ].filter(Boolean).join(" · ");
  const notesBadge = artifact?.status === "ready"
    ? { label: "Notes ready", variant: "success" as const }
    : artifact?.status === "failed"
      ? { label: "Notes unavailable", variant: "danger" as const }
      : { label: "Shared call", variant: "accent" as const };
  const readyRecordings = record.recordings.filter((recording: SharedRecording) => recording.status === "ready");
  const transcriptText = record.segments
    .map((segment: SharedSegment) => `${formatTime(segment.startMs)} ${segment.text}`)
    .join("\n");
  const recordProfile = dashboardIndustryProfileForId(record.callSession.industryProfile);

  return (
    <main className="theme-archive min-h-screen text-foreground">
      <header className="shared-call-header">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-5 md:px-6">
          <a className="shared-call-header__brand" href="/">
            <BrandLockup />
          </a>
          <Button asChild size="sm" variant="secondaryOnCream">
            <a href="/">Get Sidetone</a>
          </Button>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 pb-20 md:px-6">
        <Card>
          <CardHeader className="gap-4 p-4 sm:p-6 md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge variant={notesBadge.variant}>{notesBadge.label}</Badge>
              <p className="text-xs leading-5 text-muted-foreground">
                Anyone with this link can view this record.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-[88px_1fr] sm:items-center md:grid-cols-[120px_1fr]">
              <IndustryProfileCard
                className="size-20 !rounded-md sm:size-[88px] md:size-[120px]"
                profile={recordProfile}
                type="div"
              />
              <div className="grid gap-3">
                <IndustryProfileBadge className="w-fit" profile={recordProfile} />
                <CardTitle className="max-w-3xl text-3xl sm:text-4xl md:text-5xl">
                  {callTitle}
                </CardTitle>
                <CardDescription className="max-w-2xl text-base leading-7">
                  {callSubtitle}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5 px-4 pb-4 sm:px-6 sm:pb-6 md:px-8 md:pb-8">
            <div className="grid gap-3 border-t border-border pt-5">
              {readyRecordings.length ? (
                readyRecordings.map((recording: SharedRecording, index: number) => {
                  const recordingUrl = `/api/shared/calls/${token}/recording?recordingId=${recording._id}`;
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
                  <span>No recording is available on this shared record.</span>
                </div>
              )}
            </div>

            <div className="grid gap-3 border-t border-border pt-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Summary</p>
              {artifact?.summary ? (
                <p className="text-base leading-8 text-muted-foreground">{artifact.summary}</p>
              ) : (
                <EmptyList text="The shared notes are still being prepared." />
              )}
            </div>

            <div className="grid gap-3">
              <p className="font-semibold">Action items</p>
              {artifact?.actionItems.length ? (
                artifact.actionItems.map((item: string) => (
                  <div className="flex items-center gap-2 text-sm" key={item}>
                    <CheckCircle2 className="size-4 shrink-0 text-success" />
                    {item}
                  </div>
                ))
              ) : (
                <EmptyList text="No clear action items were captured." />
              )}
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="p-6 md:p-8">
              <CardTitle className="text-3xl">Decisions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 px-6 pb-6 md:px-8 md:pb-8">
              {artifact?.decisions.length ? (
                artifact.decisions.map((decision: string) => (
                  <div className="border-t border-border py-3 text-sm leading-6 first:mt-3" key={decision}>
                    {decision}
                  </div>
                ))
              ) : (
                <EmptyList text="No explicit decisions captured." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-6 md:p-8">
              <CardTitle className="text-3xl">Risks</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 px-6 pb-6 md:px-8 md:pb-8">
              {artifact?.risks.length ? (
                artifact.risks.map((risk: string) => (
                  <div className="border-t border-border py-3 text-sm leading-6 first:mt-3" key={risk}>
                    {risk}
                  </div>
                ))
              ) : (
                <EmptyList text="No obvious blockers captured." />
              )}
            </CardContent>
          </Card>
        </section>

        <SharedCallTools callTitle={callTitle} token={token} transcriptText={transcriptText} />

        <Card>
          <CardHeader className="p-6">
            <CardTitle>Transcript</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 px-6 pb-6">
            {record.segments.length ? (
              <div className="grid max-h-[420px] overflow-auto border-t border-border">
                {record.segments.map((segment: SharedSegment) => (
                  <div className="grid gap-1 border-b border-border py-3 text-sm leading-6" key={segment._id}>
                    <span className="font-mono text-xs uppercase tracking-[0.18em] text-primary">
                      {formatTime(segment.startMs)}
                    </span>
                    <span className="text-muted-foreground">{segment.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyList text="No transcript is available on this shared record." />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
