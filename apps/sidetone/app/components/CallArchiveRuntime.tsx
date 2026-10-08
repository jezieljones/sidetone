"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Search,
  Upload
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { IndustryProfileCard } from "./IndustryProfileCard";
import { Input } from "./ui/input";
import { dashboardIndustryProfileForId } from "../lib/brand-system";

type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "primary" | "accent";

type ArchiveCall = {
  _id: string;
  mode: string;
  status: string;
  industryProfile?: string;
  createdAt: number;
  displayTimestamp?: number;
  summaryTitle?: string;
  callBasis?: string;
  primaryExternalEntityId?: string;
  identityTitle?: string;
  contactName?: string;
  externalEntityName?: string;
  phoneNumber?: string;
  latestRecording?: {
    _id: string;
    status: "ready" | "failed";
    durationMs?: number;
    format?: string;
  } | null;
  tags?: Array<{ _id: string; label: string; color?: string }>;
};

type ArchiveWorkspace = {
  entity: { _id: string };
  savedEntities?: Array<{ _id: string; name: string }>;
  recentCalls: ArchiveCall[];
};

type ArchivePayload = {
  workspaces: ArchiveWorkspace[];
};

function callIdentityLabel(call: ArchiveCall) {
  return call.identityTitle
    ?? call.externalEntityName
    ?? call.contactName
    ?? call.phoneNumber
    ?? callModeLabel(call.mode);
}

function callModeLabel(mode: string) {
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

function callStatusView(status: string): { label: string; variant: BadgeVariant } {
  switch (status) {
    case "connecting":
      return { label: "Starting", variant: "warning" };
    case "live":
      return { label: "Live", variant: "success" };
    case "processing":
      return { label: "Writing notes", variant: "accent" };
    case "ready":
      return { label: "Notes ready", variant: "success" };
    case "failed":
      return { label: "Failed", variant: "danger" };
    case "cancelled":
      return { label: "Ended", variant: "neutral" };
    default:
      return { label: status, variant: "neutral" };
  }
}

function callHref(call: { _id: string; status: string }) {
  return call.status === "live" || call.status === "connecting"
    ? `/calls/live/${call._id}`
    : `/calls/${call._id}`;
}

const callRowInteractiveSelector = "a,button,input,textarea,select,[contenteditable='true']";

function shouldSkipCallRowNavigation(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest(callRowInteractiveSelector));
}

function formatDuration(ms?: number) {
  if (!ms || ms <= 0) {
    return null;
  }
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function startOfLocalDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

type DateBucket = "today" | "yesterday" | "this_week" | "this_month" | "earlier";

function bucketFor(timestamp: number, now: number): DateBucket {
  const day = 24 * 60 * 60 * 1000;
  const todayStart = startOfLocalDay(now);
  if (timestamp >= todayStart) return "today";
  if (timestamp >= todayStart - day) return "yesterday";
  if (timestamp >= todayStart - 7 * day) return "this_week";
  if (timestamp >= todayStart - 30 * day) return "this_month";
  return "earlier";
}

const bucketLabel: Record<DateBucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  this_month: "This month",
  earlier: "Earlier"
};

const bucketOrder: DateBucket[] = ["today", "yesterday", "this_week", "this_month", "earlier"];

function formatCallTime(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

export function CallArchiveRuntime() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const home = useQuery(
    api.entities.ownerHome,
    !isLoading && isAuthenticated ? {} : "skip"
  ) as ArchivePayload | undefined;
  const updateCallEntity = useMutation(api.crm.updateCallEntity);
  const workspace = home?.workspaces[0] ?? null;
  const allCalls = useMemo(() => workspace?.recentCalls ?? [], [workspace?.recentCalls]);
  const savedContacts = useMemo(() => workspace?.savedEntities ?? [], [workspace?.savedEntities]);

  const [query, setQuery] = useState("");
  const [contactFilterId, setContactFilterId] = useState("");
  const [contactFilterOpen, setContactFilterOpen] = useState(false);
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "failed">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [editingCallId, setEditingCallId] = useState<string | null>(null);
  const [callIdentityDraft, setCallIdentityDraft] = useState("");
  const [savingIdentityCallId, setSavingIdentityCallId] = useState<string | null>(null);
  const [identitySaveState, setIdentitySaveState] = useState<"idle" | "saving" | "failed">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const validContactFilterId = savedContacts.some((c) => c._id === contactFilterId) ? contactFilterId : "";
  const selectedContact = savedContacts.find((c) => c._id === validContactFilterId) ?? null;

  const filteredCalls = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase();
    return allCalls.filter((call) => {
      if (validContactFilterId && call.primaryExternalEntityId !== validContactFilterId) {
        return false;
      }
      if (!trimmedQuery) return true;
      const haystack = [
        callIdentityLabel(call),
        call.summaryTitle,
        call.callBasis,
        call.phoneNumber
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(trimmedQuery);
    });
  }, [allCalls, query, validContactFilterId]);

  const grouped = useMemo(() => {
    const now = Date.now();
    const buckets = new Map<DateBucket, ArchiveCall[]>();
    for (const call of filteredCalls) {
      const bucket = bucketFor(call.displayTimestamp ?? call.createdAt, now);
      const list = buckets.get(bucket) ?? [];
      list.push(call);
      buckets.set(bucket, list);
    }
    return bucketOrder
      .map((bucket) => ({ bucket, calls: buckets.get(bucket) ?? [] }))
      .filter((group) => group.calls.length > 0);
  }, [filteredCalls]);

  function toggleRecording(call: ArchiveCall) {
    const recording = call.latestRecording;
    if (!recording || recording.status !== "ready") return;

    const src = `/api/calls/${call._id}/recording?recordingId=${recording._id}`;
    if (audioRef.current && playingCallId === call._id) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlayingCallId(null);
      return;
    }
    if (audioRef.current) audioRef.current.pause();

    const audio = new Audio(src);
    audioRef.current = audio;
    setPlayingCallId(call._id);
    setPlaybackError(null);
    audio.addEventListener("ended", () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlayingCallId(null);
      }
    });
    audio.addEventListener("error", () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlayingCallId(null);
        setPlaybackError("Unable to play this recording yet.");
      }
    });
    void audio.play().catch(() => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlayingCallId(null);
        setPlaybackError("Unable to play this recording yet.");
      }
    });
  }

  async function saveCallIdentity(call: ArchiveCall, nextIdentity = callIdentityDraft) {
    const trimmedIdentity = nextIdentity.trim();
    const currentIdentity = callIdentityLabel(call);
    setEditingCallId(null);
    if (!trimmedIdentity || trimmedIdentity === currentIdentity) {
      setCallIdentityDraft(currentIdentity);
      setIdentitySaveState("idle");
      return;
    }

    setIdentitySaveState("saving");
    setSavingIdentityCallId(call._id);
    try {
      await updateCallEntity({
        callSessionId: call._id as Id<"callSessions">,
        entityName: trimmedIdentity
      });
      setIdentitySaveState("idle");
      setSavingIdentityCallId(null);
      setCallIdentityDraft(trimmedIdentity);
    } catch {
      setEditingCallId(call._id);
      setSavingIdentityCallId(null);
      setIdentitySaveState("failed");
    }
  }

  async function uploadRecording(file?: File | null) {
    if (!file || uploadState === "uploading") {
      return;
    }

    setUploadState("uploading");
    setUploadError(null);
    let failed = false;
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/calls/upload-recording", {
        method: "POST",
        body: formData
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to upload this recording.");
      }
      window.location.href = `/calls/${payload.callSessionId}`;
    } catch (error) {
      failed = true;
      setUploadState("failed");
      setUploadError(error instanceof Error ? error.message : "Unable to upload this recording.");
    } finally {
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
      if (!failed) {
        setUploadState("idle");
      }
    }
  }

  if (!isLoading && !isAuthenticated) {
    return (
      <Card>
        <CardContent className="p-6 text-muted-foreground">
          Sign in to view calls.
        </CardContent>
      </Card>
    );
  }

  if (isLoading || home === undefined) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading calls...
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="grid gap-6">
      <Card>
        <CardHeader className="gap-4 p-4 sm:p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="text-2xl sm:text-3xl">All calls</CardTitle>
              <Badge variant="neutral">
                {allCalls.length} {allCalls.length === 1 ? "call" : "calls"}
              </Badge>
            </div>
            <Button asChild size="sm" variant="ghost">
              <a href="/dashboard">Back to dashboard</a>
            </Button>
            <input
              accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.oga,.aac"
              className="sr-only"
              onChange={(event) => void uploadRecording(event.currentTarget.files?.[0] ?? null)}
              ref={uploadInputRef}
              type="file"
            />
            <Button
              disabled={uploadState === "uploading"}
              onClick={() => uploadInputRef.current?.click()}
              size="sm"
              type="button"
              variant="secondary"
            >
              {uploadState === "uploading" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Upload recording
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="relative block">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="Search calls"
                className="pl-9"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by contact, summary, or number"
                type="search"
                value={query}
              />
            </label>

            {savedContacts.length > 0 ? (
              <div
                className="relative w-full sm:w-72"
                onBlur={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                    setContactFilterOpen(false);
                  }
                }}
              >
                <button
                  aria-expanded={contactFilterOpen}
                  aria-haspopup="listbox"
                  className="flex h-11 w-full items-center justify-between gap-3 rounded-md border border-border bg-card px-3 text-left text-sm font-semibold text-foreground transition hover:border-primary/70 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setContactFilterOpen((open) => !open)}
                  type="button"
                >
                  <span className="min-w-0 truncate">
                    {selectedContact?.name ?? "All contacts"}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={[
                      "size-4 shrink-0 text-muted-foreground transition",
                      contactFilterOpen ? "rotate-180 text-primary" : ""
                    ].join(" ")}
                  />
                </button>
                {contactFilterOpen ? (
                  <div
                    className="absolute right-0 z-50 mt-2 grid max-h-72 w-full overflow-y-auto rounded-md border border-border bg-card p-1 shadow-panel"
                    role="listbox"
                  >
                    <button
                      className="flex min-h-10 items-center gap-3 rounded-sm px-3 text-left text-sm font-semibold text-foreground hover:bg-muted"
                      onClick={() => {
                        setContactFilterId("");
                        setContactFilterOpen(false);
                      }}
                      role="option"
                      type="button"
                    >
                      All contacts
                    </button>
                    {savedContacts.map((entity) => (
                      <button
                        className="flex min-h-10 items-center gap-3 rounded-sm px-3 text-left text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                        key={entity._id}
                        onClick={() => {
                          setContactFilterId(entity._id);
                          setContactFilterOpen(false);
                        }}
                        role="option"
                        type="button"
                      >
                        <span className="min-w-0 truncate">{entity.name}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="grid gap-6 px-4 pb-4 sm:px-6 sm:pb-6 md:px-8 md:pb-8">
          {playbackError ? (
            <p className="text-sm text-destructive">{playbackError}</p>
          ) : null}
          {uploadError ? (
            <p className="text-sm text-destructive">{uploadError}</p>
          ) : null}

          {grouped.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-card p-6 text-sm leading-6 text-muted-foreground">
              <p className="font-semibold text-foreground">
                {allCalls.length === 0 ? "No calls yet." : "No calls match your filters."}
              </p>
              <p>
                {allCalls.length === 0
                  ? "Once Sidetone joins a call it will appear here."
                  : "Clear search or pick a different contact."}
              </p>
            </div>
          ) : (
            grouped.map((group) => (
              <section className="grid gap-2" key={group.bucket}>
                <h2 className="text-ui-label text-muted-foreground">{bucketLabel[group.bucket]}</h2>
                <div className="grid">
                  {group.calls.map((call) => {
                    const statusView = callStatusView(call.status);
                    const identityLabel = callIdentityLabel(call);
                    const callProfile = dashboardIndustryProfileForId(call.industryProfile);
                    const isEditingIdentity = editingCallId === call._id;
                    const recordingReady = call.latestRecording?.status === "ready";
                    const isPlaying = playingCallId === call._id;
                    const recordingDuration = formatDuration(call.latestRecording?.durationMs);
                    const href = callHref(call);
                    return (
                      <article
                        aria-label={`Open ${identityLabel}`}
                        className="group/call-row relative -mx-2 grid cursor-pointer grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md border-t border-border px-2 py-3 transition hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background first:border-t-0 first:pt-0 md:grid-cols-[3rem_minmax(0,1fr)_auto]"
                        key={call._id}
                        onClick={(event) => {
                          if (shouldSkipCallRowNavigation(event.target)) {
                            return;
                          }
                          window.location.href = href;
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") {
                            return;
                          }
                          if (shouldSkipCallRowNavigation(event.target)) {
                            return;
                          }
                          event.preventDefault();
                          window.location.href = href;
                        }}
                        role="link"
                        tabIndex={0}
                      >
                        <div className="block size-10 shrink-0 md:size-12" title={callProfile.compactLabel}>
                          <IndustryProfileCard
                            className="size-10 !rounded-sm shadow-none md:size-12"
                            loading="lazy"
                            profile={callProfile}
                            type="div"
                          />
                        </div>
                        <div className="min-w-0">
                          {isEditingIdentity ? (
                            <Input
                              autoFocus
                              aria-label="Call identity"
                              className="h-auto min-w-0 max-w-sm rounded-none border-0 border-b border-primary/70 bg-transparent px-0 py-0 text-lg font-semibold leading-tight text-foreground shadow-none focus-visible:border-primary focus-visible:ring-0 focus-visible:ring-offset-0"
                              onBlur={(event) => void saveCallIdentity(call, event.currentTarget.value)}
                              onChange={(event) => setCallIdentityDraft(event.target.value)}
                              onClick={(event) => event.stopPropagation()}
                              onFocus={(event) => event.currentTarget.select()}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  setEditingCallId(null);
                                  setCallIdentityDraft(identityLabel);
                                  setSavingIdentityCallId(null);
                                  setIdentitySaveState("idle");
                                }
                              }}
                              value={callIdentityDraft}
                            />
                          ) : (
                            <button
                              aria-label={`Edit ${identityLabel}`}
                              className="group/title inline-flex max-w-full cursor-text items-center gap-1.5 border-b border-dashed border-foreground/35 pb-0.5 text-left text-base font-semibold text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:text-lg"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingCallId(call._id);
                                setCallIdentityDraft(identityLabel);
                                setSavingIdentityCallId(null);
                                setIdentitySaveState("idle");
                              }}
                              title="Edit call title"
                              type="button"
                            >
                              <span className="min-w-0 truncate">
                                {savingIdentityCallId === call._id ? "Saving..." : identityLabel}
                              </span>
                              <Pencil className="size-3.5 shrink-0 opacity-55 transition group-hover/title:opacity-100" aria-hidden="true" />
                            </button>
                          )}
                          {identitySaveState === "failed" && editingCallId === call._id ? (
                            <span className="mt-1 block text-xs font-semibold text-destructive">Save failed</span>
                          ) : null}
                          <p className="mt-0.5 block min-w-0 truncate text-sm text-muted-foreground transition group-hover/call-row:text-foreground">
                            {[
                              call.callBasis ?? call.summaryTitle ?? callModeLabel(call.mode),
                              formatCallTime(call.displayTimestamp ?? call.createdAt)
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {call.tags?.length ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {call.tags.slice(0, 4).map((tag) => (
                                <span
                                  className="rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
                                  key={tag._id}
                                  style={tag.color ? { borderColor: `${tag.color}80`, color: tag.color } : undefined}
                                >
                                  {tag.label}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex items-center justify-end">
                          {recordingReady ? (
                            <Button
                              aria-label={`${isPlaying ? "Pause" : "Play"} recording for ${identityLabel}`}
                              aria-pressed={isPlaying}
                              className="size-11 rounded-full border-border bg-muted px-0 text-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleRecording(call);
                              }}
                              size="icon"
                              title={`${isPlaying ? "Pause" : "Play"} recording${recordingDuration ? ` (${recordingDuration})` : ""}`}
                              type="button"
                              variant="secondary"
                            >
                              {isPlaying ? (
                                <Pause className="size-5 fill-current" />
                              ) : (
                                <Play className="ml-0.5 size-5 fill-current" />
                              )}
                              <span className="sr-only">
                                {isPlaying ? "Pause" : "Play"} recording
                              </span>
                            </Button>
                          ) : (
                            <Badge className="call-row-status-badge" variant={statusView.variant}>{statusView.label}</Badge>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}
