"use client";

import type { IndustryProfileId } from "@sidetone/contracts";
import { isIndustryProfileId, normalizeIndustryProfileId } from "@sidetone/contracts";
import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Check,
  Copy,
  History,
  Headphones,
  IdCard,
  LoaderCircle,
  Pause,
  Pencil,
  PhoneCall,
  PhoneOff,
  Play,
  Search,
  Smartphone,
  Sparkles,
  Upload,
  Video
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { IndustryProfileCard } from "./IndustryProfileCard";
import { Input } from "./ui/input";
import {
  dashboardIndustryProfileForId,
  dashboardIndustryProfiles
} from "../lib/brand-system";
import { formatUsPhone } from "../lib/phone-format";

type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "primary" | "accent";

type AvailableNumber = {
  phoneNumber: string;
  locality?: string;
  region?: string;
  monthlyCost?: string;
  upfrontCost?: string;
};

type NumberAssignment = {
  _id: string;
  phoneNumber?: string;
  e164?: string;
  areaCode?: string;
  status: "searching" | "ordering" | "configuring" | "active" | "failed" | "released";
  failureReason?: string;
};

type Workspace = {
  entity: {
    _id: string;
    name: string;
    defaultIndustryProfile?: string;
    defaultCoachMode?: string | null;
    defaultConsentMode: string;
    activationContactStatus?: "not_started" | "saved" | "skipped";
    identityBackfilledAt?: number;
  };
  numberAssignment: NumberAssignment | null;
  savedEntities?: Array<{ _id: string; name: string; lastInteractionAt?: number }>;
  discordInstallations?: Array<{
    _id: string;
    discordGuildId: string;
    discordGuildName?: string;
    status: "active" | "revoked" | "unlinked";
    linkedAt: number;
  }>;
  discordCaptures?: Array<{
    _id: string;
    callSessionId?: string;
    discordGuildName?: string;
    discordChannelName?: string;
    status: "queued" | "joining" | "recording" | "processing" | "ready" | "failed" | "stopped";
    error?: string;
    createdAt: number;
    updatedAt: number;
  }>;
  recentCalls: Array<{
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
    failureReason?: string;
    latestRecording?: {
      _id: string;
      status: "ready" | "failed";
      durationMs?: number;
      format?: string;
    } | null;
    tags?: Array<{ _id: string; label: string; color?: string }>;
  }>;
};

type HomePayload = {
  workspaces: Workspace[];
};

const LAST_INDUSTRY_PROFILE_STORAGE_KEY = "sidetone:last-industry-profile";

function readStoredIndustryProfile() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(LAST_INDUSTRY_PROFILE_STORAGE_KEY);
    return isIndustryProfileId(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredIndustryProfile(profileId: IndustryProfileId) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(LAST_INDUSTRY_PROFILE_STORAGE_KEY, profileId);
  } catch {
    // Local storage is an optimistic convenience; Convex remains the durable preference.
  }
}

function formatPrice(number: AvailableNumber) {
  const parts = [];
  if (number.monthlyCost) {
    parts.push(`${number.monthlyCost}/mo`);
  }
  if (number.upfrontCost && number.upfrontCost !== "0.00") {
    parts.push(`${number.upfrontCost} setup`);
  }
  return parts.join(" • ");
}

function formatCallTime(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
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
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

function isZoomMeetingInput(value: string) {
  const trimmed = value.trim();
  const compact = trimmed.replace(/\s+/g, "");
  if (/^\d{9,15}$/.test(compact)) {
    return true;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    return host.endsWith("zoom.us")
      || host.endsWith(".zoom.us")
      || host.endsWith("zoomgov.com")
      || host.endsWith(".zoomgov.com");
  } catch {
    return false;
  }
}

function hasTeamsInviteText(value: string) {
  return /meeting\s*id\s*[:#]?\s*[0-9][0-9\s-]{8,30}[0-9]/i.test(value)
    && /passcode\s*[:#]?\s*[A-Za-z0-9._~!$&'()*+,;=:@%-]{3,120}/i.test(value);
}

function isSupportedMeetingInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (hasTeamsInviteText(trimmed)) {
    return true;
  }

  try {
    const embeddedUrl = trimmed.match(/https?:\/\/[^\s<>"']+/i)?.[0] ?? trimmed;
    const url = new URL(/^https?:\/\//i.test(embeddedUrl) ? embeddedUrl : `https://${embeddedUrl}`);
    const host = url.hostname.toLowerCase();
    return host === "meet.google.com"
      || host.endsWith("teams.live.com")
      || host.endsWith("teams.microsoft.com")
      || host.endsWith("teams.microsoft.us")
      || host.endsWith("teams.cloud.microsoft");
  } catch {
    return false;
  }
}

function callIdentityLabel(call: Workspace["recentCalls"][number]) {
  return call.identityTitle
    ?? call.externalEntityName
    ?? call.contactName
    ?? call.phoneNumber
    ?? callModeLabel(call.mode);
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

type ActivationStep = "choose_number" | "save_contact" | "ready";
type MergeGuidePlatform = "iphone" | "android";

const activationCopy: Record<ActivationStep, { label: string; title: string; description: string }> = {
  choose_number: {
    label: "Number",
    title: "Choose your Sidetone number",
    description: "This is the private number you call or add to any phone call when you want notes."
  },
  save_contact: {
    label: "Contact",
    title: "Save Sidetone to contacts",
    description: "Add Sidetone Notes to your phone so it is easy to find during a real call."
  },
  ready: {
    label: "Ready",
    title: "Start using Sidetone",
    description: "Call Sidetone, add people naturally, tap Merge, and talk normally."
  }
};

function activationStepFor(workspace: Workspace | null, activeNumber: string | null): ActivationStep {
  if (!activeNumber) {
    return "choose_number";
  }

  const contactStatus = workspace?.entity.activationContactStatus ?? "not_started";
  if (contactStatus === "not_started") {
    return "save_contact";
  }
  return "ready";
}

function ActivationRail({ step }: { step: ActivationStep }) {
  const steps: ActivationStep[] = ["choose_number", "save_contact", "ready"];
  const currentIndex = steps.indexOf(step);

  return (
    <div className="grid gap-3 border-y border-border py-5">
      <div className="flex items-center justify-between gap-2">
        {steps.map((item, index) => {
          const done = index < currentIndex || step === "ready";
          const current = item === step && step !== "ready";
          return (
            <div className="flex flex-1 items-center gap-2" key={item}>
              <div
                className={[
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  done
                    ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-300"
                    : current
                      ? "border-primary/50 bg-primary/15 text-primary"
                      : "border-border bg-secondary text-muted-foreground"
                ].join(" ")}
              >
                {done ? <Check className="size-3.5" /> : index + 1}
              </div>
              {index < steps.length - 1 ? <div className="h-px flex-1 bg-border" /> : null}
            </div>
          );
        })}
      </div>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {activationCopy[step].label}
      </p>
    </div>
  );
}

function MergeGuide({
  onComplete,
  platform,
  setPlatform,
  showCompleteAction = true
}: {
  onComplete?: () => void;
  platform: MergeGuidePlatform;
  setPlatform: (platform: MergeGuidePlatform) => void;
  showCompleteAction?: boolean;
}) {
  const isIphone = platform === "iphone";

  return (
    <div className="grid gap-5 border-y border-border py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
            How to add Sidetone
          </p>
          <h3 className="mt-2 text-2xl font-semibold">
            Add the number, then tap Merge.
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Sidetone cannot tell whether your native phone call is merged. If notes look quiet, Merge is the first thing to check.
          </p>
        </div>
        <div className="flex rounded-md border border-border bg-[#122742] p-1">
          <button
            className={`rounded-md px-4 py-2 text-sm font-semibold transition ${isIphone ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            onClick={() => setPlatform("iphone")}
            type="button"
          >
            iPhone
          </button>
          <button
            className={`rounded-md px-4 py-2 text-sm font-semibold transition ${!isIphone ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            onClick={() => setPlatform("android")}
            type="button"
          >
            Android
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <PhoneMergeMockup
          eyebrow="Already on a call"
          first={isIphone ? "Add call" : "Add call"}
          second="Sidetone Notes"
          third={isIphone ? "Merge calls" : "Merge"}
        />
        <PhoneMergeMockup
          eyebrow="Starting with Sidetone"
          first="Call Sidetone"
          second="Add person"
          third={isIphone ? "Merge calls" : "Merge"}
        />
      </div>

      {showCompleteAction ? (
        <Button onClick={onComplete} type="button">
          <Check className="size-4" />
          I know how to merge
        </Button>
      ) : null}
    </div>
  );
}

function PhoneMergeMockup({
  eyebrow,
  first,
  second,
  third
}: {
  eyebrow: string;
  first: string;
  second: string;
  third: string;
}) {
  return (
    <div className="enamel-panel p-4">
      <div className="border border-border/60 bg-background/60 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="roster-eyebrow text-[10px]">
            {eyebrow}
          </p>
          <Smartphone className="size-4 text-primary" />
        </div>
        <div className="mt-5 grid grid-cols-3 items-center gap-3 text-center">
          {[first, second, third].map((label, index) => (
            <div className="grid gap-2" key={label}>
              <div className={`mx-auto flex size-12 items-center justify-center rounded-md border border-primary/50 ${index === 2 ? "bg-primary text-primary-foreground" : "bg-[#122742] text-foreground"}`}>
                {index === 0 ? <PhoneCall className="size-5" /> : index === 1 ? <Copy className="size-5" /> : <Check className="size-5" />}
              </div>
              <p className="text-xs font-semibold leading-4 text-muted-foreground">
                {label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

async function writeToClipboard(text: string) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the selection-based fallback below.
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, text.length);

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textArea);
  }
}

export function SidetoneConsole({
  meetingSourcesEnabled = false,
  phoneEnabled = false
}: {
  meetingSourcesEnabled?: boolean;
  phoneEnabled?: boolean;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isAuthenticated: isConvexAuthenticated, isLoading: isConvexLoading } = useConvexAuth();
  const liveHome = useQuery(
    api.entities.ownerHome,
    !isConvexLoading && isConvexAuthenticated ? {} : "skip"
  ) as HomePayload | undefined;
  const updateCallEntity = useMutation(api.crm.updateCallEntity);
  const backfillCallEntities = useMutation(api.crm.backfillCallEntities);
  const [bootstrappedHome, setBootstrappedHome] = useState<HomePayload | null>(null);
  const [areaCode, setAreaCode] = useState("");
  const [numbers, setNumbers] = useState<AvailableNumber[]>([]);
  const [selectedIndustryProfile, setSelectedIndustryProfile] = useState<IndustryProfileId>(() => readStoredIndustryProfile() ?? "general");
  const [callFocusText, setCallFocusText] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [skipDisclosure, setSkipDisclosure] = useState(false);
  const [mergeGuidePlatform, setMergeGuidePlatform] = useState<MergeGuidePlatform>("iphone");
  const [showReadyGuide, setShowReadyGuide] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const lastSavedPreferences = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "search" | "provision" | null>("load");
  const [recordingUploadState, setRecordingUploadState] = useState<"idle" | "uploading" | "failed">("idle");
  const [meetingCaptureState, setMeetingCaptureState] = useState<"idle" | "starting" | "failed">("idle");
  const [endingMeetingCallId, setEndingMeetingCallId] = useState<string | null>(null);
  const [editingCallId, setEditingCallId] = useState<string | null>(null);
  const [callIdentityDraft, setCallIdentityDraft] = useState("");
  const [savingIdentityCallId, setSavingIdentityCallId] = useState<string | null>(null);
  const [identitySaveState, setIdentitySaveState] = useState<"idle" | "saving" | "failed">("idle");
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);
  const [recentEntityFilterId, setRecentEntityFilterId] = useState("");
  const [recentContactFilterOpen, setRecentContactFilterOpen] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const RECENT_INITIAL_COUNT = 6;

  const home = liveHome?.workspaces.length ? liveHome : bootstrappedHome ?? liveHome ?? null;
  const workspace = home?.workspaces[0] ?? null;
  const activeNumber = workspace?.numberAssignment?.status === "active"
    ? workspace.numberAssignment.e164 ?? workspace.numberAssignment.phoneNumber ?? null
    : null;
  const activeCall = workspace?.recentCalls.find((call) => call.status === "live" || call.status === "connecting") ?? null;
  const recentCalls = workspace?.recentCalls ?? [];
  const savedContacts = useMemo(() => workspace?.savedEntities ?? [], [workspace?.savedEntities]);
  const showRecentContactFilter = recentCalls.length > 0 && savedContacts.length > 0;
  const validRecentEntityFilterId = showRecentContactFilter && savedContacts.some((entity) => entity._id === recentEntityFilterId)
    ? recentEntityFilterId
    : "";
  const selectedRecentContact = savedContacts.find((entity) => entity._id === validRecentEntityFilterId) ?? null;
  const filteredRecentCalls = validRecentEntityFilterId
    ? recentCalls.filter((call) => call.primaryExternalEntityId === validRecentEntityFilterId)
    : recentCalls;
  const hasMoreRecent = filteredRecentCalls.length > RECENT_INITIAL_COUNT;
  const visibleRecentCalls = showAllRecent
    ? filteredRecentCalls
    : filteredRecentCalls.slice(0, RECENT_INITIAL_COUNT);
  const activationStep = activationStepFor(workspace, activeNumber);
  const currentActivationCopy = activationCopy[activationStep];
  const isReady = activationStep === "ready" && Boolean(activeNumber);
  const shouldPromptSaveContact = activationStep === "save_contact";
  const canSearch = useMemo(() => areaCode.replace(/\D/g, "").length === 3, [areaCode]);
  const selectedIndustry = dashboardIndustryProfileForId(selectedIndustryProfile);
  const selectableIndustryProfiles = dashboardIndustryProfiles.filter((profile) => profile.id !== selectedIndustry.id);

  function chooseIndustryProfile(profileId: IndustryProfileId) {
    const profile = dashboardIndustryProfileForId(profileId);
    setSelectedIndustryProfile(profile.id);
    writeStoredIndustryProfile(profile.id);
  }

  async function loadHome() {
    setBusy("load");
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const response = await fetch(`/api/sidetone/home?timezone=${encodeURIComponent(timezone)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load Sidetone.");
      }
      setBootstrappedHome(payload);
      const assignment = payload.workspaces?.[0]?.numberAssignment;
      if (assignment?.areaCode) {
        setAreaCode(assignment.areaCode);
      }
      const entity = payload.workspaces?.[0]?.entity;
      const industryProfile = normalizeIndustryProfileId(entity?.defaultIndustryProfile);
      setSelectedIndustryProfile(industryProfile);
      writeStoredIndustryProfile(industryProfile);
      setSkipDisclosure(entity?.defaultConsentMode === "owner_acknowledgment");
      if (entity?._id) {
        lastSavedPreferences.current = `${entity._id}:${industryProfile}:${entity.defaultConsentMode === "owner_acknowledgment"}`;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Sidetone.");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (!isLoaded) {
      return;
    }
    if (!isSignedIn) {
      setBusy(null);
      setError("Sign in to use Sidetone.");
      return;
    }
    void loadHome();
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!workspace?.entity._id || workspace.entity.identityBackfilledAt) {
      return;
    }
    void backfillCallEntities({ entityId: workspace.entity._id as Id<"entityProfiles"> }).catch((err) => {
      console.warn("Unable to backfill call entities.", err);
    });
  }, [backfillCallEntities, workspace?.entity._id, workspace?.entity.identityBackfilledAt]);

  async function savePreferences() {
    if (!workspace) {
      return;
    }

    const signature = `${workspace.entity._id}:${selectedIndustryProfile}:${skipDisclosure}`;
    if (lastSavedPreferences.current === signature) {
      return;
    }

    const response = await fetch("/api/sidetone/preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entityId: workspace.entity._id,
        industryProfile: selectedIndustryProfile,
        coachMode: null,
        playDisclosure: !skipDisclosure
      })
    });
    if (!response.ok) {
      throw new Error("Unable to save Sidetone preferences.");
    }
    lastSavedPreferences.current = signature;
  }

  useEffect(() => {
    if (!workspace) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void savePreferences().catch((err) => {
        console.warn("Unable to save Sidetone call preferences.", err);
      });
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [workspace?.entity._id, selectedIndustryProfile, skipDisclosure]);

  async function searchNumbers() {
    if (!workspace) {
      return;
    }

    setBusy("search");
    setError(null);
    setMessage("Looking for a local Sidetone number...");
    try {
      const response = await fetch(
        `/api/telnyx/available-numbers?entityId=${encodeURIComponent(workspace.entity._id)}&areaCode=${encodeURIComponent(areaCode)}`,
        { cache: "no-store" }
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to search numbers.");
      }
      setNumbers(payload.numbers ?? []);
      setMessage(payload.numbers?.length ? "Choose one number to attach to Sidetone." : "No numbers found for that area code.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to search numbers.");
    } finally {
      setBusy(null);
    }
  }

  async function provisionNumber(phoneNumber: string) {
    if (!workspace) {
      return;
    }

    setBusy("provision");
    setError(null);
    setMessage(`Attaching ${phoneNumber} to Sidetone...`);
    try {
      const response = await fetch("/api/telnyx/provision-number", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityId: workspace.entity._id,
          areaCode,
          phoneNumber
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to provision number.");
      }
      setNumbers([]);
      setMessage(payload.statusLabel ?? "Sidetone number is ready.");
      await loadHome();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to provision number.");
    } finally {
      setBusy(null);
    }
  }

  async function saveCallIdentity(call: Workspace["recentCalls"][number], nextIdentity = callIdentityDraft) {
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
    if (!file || recordingUploadState === "uploading") {
      return;
    }

    setRecordingUploadState("uploading");
    setError(null);
    setMessage("Uploading recording...");
    let failed = false;
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("industryProfile", selectedIndustryProfile);
      const response = await fetch("/api/calls/upload-recording", {
        method: "POST",
        body: formData
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to upload this recording.");
      }
      setMessage("Recording saved. Sidetone is transcribing it now.");
      window.location.href = `/calls/${payload.callSessionId}`;
    } catch (err) {
      failed = true;
      setRecordingUploadState("failed");
      setError(err instanceof Error ? err.message : "Unable to upload this recording.");
      setMessage(null);
    } finally {
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
      if (!failed) {
        setRecordingUploadState("idle");
      }
    }
  }

  async function startMeetingCapture() {
    const trimmedMeetingUrl = meetingUrl.trim();
    if (!meetingSourcesEnabled) {
      setError("Meeting sources are in admin testing right now. Use the Sidetone phone number for production calls.");
      setMessage(null);
      return;
    }
    if (!trimmedMeetingUrl || meetingCaptureState === "starting") {
      return;
    }

    setMeetingCaptureState("starting");
    setError(null);
    const zoomRtms = isZoomMeetingInput(trimmedMeetingUrl);
    if (zoomRtms) {
      setMeetingCaptureState("failed");
      setError("Zoom meeting notes are paused while Zoom RTMS remains gated behind account-level approval. Use Google Meet or Microsoft Teams for now.");
      setMessage(null);
      return;
    }
    setMessage("Adding Sidetone to the meeting...");
    let failed = false;
    try {
      const response = await fetch("/api/meetings/vexa/start", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meetingUrl: trimmedMeetingUrl,
          industryProfile: selectedIndustryProfile,
          listenFor: callFocusText
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to add Sidetone to this meeting.");
      }
      setMeetingUrl("");
      setMessage("Meeting added. Admit Sidetone when the waiting room prompt appears.");
      window.location.href = `/calls/${payload.callSessionId}`;
    } catch (err) {
      failed = true;
      setMeetingCaptureState("failed");
      setError(err instanceof Error ? err.message : "Unable to add Sidetone to this meeting.");
      setMessage(null);
    } finally {
      if (!failed) {
        setMeetingCaptureState("idle");
      }
    }
  }

  async function stopMeetingNotes(callId: string) {
    if (endingMeetingCallId) {
      return;
    }

    setEndingMeetingCallId(callId);
    setError(null);
    setMessage("Stopping notes...");
    try {
      const response = await fetch("/api/meetings/vexa/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callSessionId: callId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to stop notes.");
      }
      setMessage("Notes are stopping. Sidetone is writing the call record.");
      window.location.href = `/calls/${callId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to stop notes.");
      setMessage(null);
    } finally {
      setEndingMeetingCallId(null);
    }
  }

  function toggleRecording(call: Workspace["recentCalls"][number]) {
    const recording = call.latestRecording;
    if (!recording || recording.status !== "ready") {
      return;
    }

    const src = `/api/calls/${call._id}/recording?recordingId=${recording._id}`;
    if (audioRef.current && playingCallId === call._id) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlayingCallId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(src);
    audioRef.current = audio;
    setPlayingCallId(call._id);
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
        setError("Unable to play this recording yet.");
      }
    });
    void audio.play().catch(() => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlayingCallId(null);
        setError("Unable to play this recording yet.");
      }
    });
  }

  async function updateActivationProgress(input: {
    contactStatus?: "not_started" | "saved" | "skipped";
  }) {
    if (!workspace) {
      return;
    }

    const response = await fetch("/api/sidetone/activation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entityId: workspace.entity._id,
        ...input
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to update Sidetone setup.");
    }
    await loadHome();
  }

  async function addContact() {
    if (!workspace || !activeNumber) {
      return;
    }

    setError(null);
    setMessage(null);
    try {
      await updateActivationProgress({ contactStatus: "saved" });
      window.location.href = `/api/sidetone/contact?entityId=${encodeURIComponent(workspace.entity._id)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open Sidetone contact.");
    }
  }

  async function skipContact() {
    setError(null);
    setMessage(null);
    try {
      await updateActivationProgress({ contactStatus: "skipped" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update Sidetone setup.");
    }
  }

  async function copyNumber() {
    if (!activeNumber) {
      return;
    }

    setError(null);
    const copied = await writeToClipboard(activeNumber);
    if (!copied) {
      setError("Could not copy the number. Press and hold the number to copy it manually.");
      return;
    }

    setCopyState("copied");
    window.setTimeout(() => {
      setCopyState("idle");
    }, 1500);
    void savePreferences().catch((err) => {
      console.warn("Unable to save Sidetone call preferences after copying number.", err);
    });
  }

  if (busy === "load" && !home) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading Sidetone...
        </CardContent>
      </Card>
    );
  }

  if (error && !home) {
    return (
      <Card>
        <CardHeader>
          <Badge variant="primary" className="w-fit">Setup needed</Badge>
          <CardTitle>Finish setting up your workspace.</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={loadHome} variant="secondary">Try again</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="dashboard-console grid gap-6">
      {activeCall ? (
        <div className="enamel-panel flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <Badge variant={activeCall.status === "connecting" ? "warning" : "success"} className="mb-2">
              {activeCall.status === "connecting" && activeCall.mode === "zoom_rtms"
                ? "Starting Zoom RTMS"
                : activeCall.status === "connecting"
                  ? "Sidetone is joining"
                  : "Sidetone is live"}
            </Badge>
            <p className="text-sm leading-6 text-muted-foreground">
              {activeCall.status === "connecting" && activeCall.mode === "zoom_rtms"
                ? "No bot appears in the participant list. Sidetone is waiting for Zoom to open the RTMS stream."
                : activeCall.status === "connecting" && activeCall.mode === "vexa_meeting"
                ? "Waiting for the meeting lobby. Admit Sidetone when the prompt appears."
                : activeCall.status === "connecting"
                  ? "Sidetone is connecting to the active call."
                  : "Notes are running for the active call."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {activeCall.mode === "vexa_meeting" ? (
              <Button
                disabled={endingMeetingCallId === activeCall._id}
                onClick={() => stopMeetingNotes(activeCall._id)}
                type="button"
                variant="secondary"
              >
                {endingMeetingCallId === activeCall._id ? <LoaderCircle className="size-4 animate-spin" /> : <PhoneOff className="size-4" />}
                Stop notes
              </Button>
            ) : null}
            <Button asChild>
              <a href={callHref(activeCall)}>Open notes</a>
            </Button>
          </div>
        </div>
      ) : null}

      {!phoneEnabled && error ? <p role="alert" className="text-destructive">{error}</p> : null}
      {!phoneEnabled ? <div className="grid gap-3 py-6"><h1 className="text-4xl font-semibold">Your conversations, remembered.</h1><p className="max-w-2xl text-muted-foreground">Upload a recording to get a transcript, notes, action items, and an editable document. Only upload conversations you have permission to transcribe.</p></div> : null}
      <div className={`grid gap-6 ${phoneEnabled ? (isReady ? "xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.75fr)]" : "lg:grid-cols-[1.05fr_0.95fr]") : ""}`}>
        {phoneEnabled ? <Card className="overflow-hidden">
          {!isReady ? (
            <CardHeader className="gap-6 p-4 sm:p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Badge variant={activeNumber ? "success" : "primary"}>
                  {currentActivationCopy.label}
                </Badge>
                <span className="font-mono text-sm text-muted-foreground">
                  {formatUsPhone(activeNumber) ?? "No Sidetone number yet"}
                </span>
              </div>
              <ActivationRail step={activationStep} />
              <div className="grid gap-3">
                <CardTitle className="text-3xl sm:text-4xl md:text-5xl">
                  {currentActivationCopy.title}
                </CardTitle>
                <CardDescription className="max-w-2xl text-lg leading-8">
                  {currentActivationCopy.description}
                </CardDescription>
              </div>
            </CardHeader>
          ) : null}
          <CardContent className={`grid gap-5 px-4 pb-4 sm:px-6 sm:pb-6 md:px-8 md:pb-8 ${isReady ? "pt-4 sm:pt-6 md:pt-8" : ""}`}>
            {activeNumber ? (
              <>
              <div className={`${isReady ? "grid gap-4" : "grid gap-5 border-t border-border pt-5 2xl:grid-cols-[minmax(0,1fr)_auto] 2xl:items-end"}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
                      Your Sidetone number
                    </p>
                  </div>
                  <div className="mt-3 flex max-w-full items-center gap-3 overflow-x-auto pb-1">
                    <p className="shrink-0 whitespace-nowrap font-mono text-[clamp(2rem,6vw,4.25rem)] font-semibold leading-none text-foreground">
                      {formatUsPhone(activeNumber)}
                    </p>
                    <Button
                      aria-label="Copy Sidetone number"
                      className="size-10 min-h-10 shrink-0 px-0 text-sm sm:w-auto sm:px-3"
                      onClick={copyNumber}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {copyState === "copied" ? <Check className="size-4" /> : <Copy className="size-4" />}
                      <span className="hidden sm:inline">{copyState === "copied" ? "Copied" : "Copy"}</span>
                    </Button>
                  </div>
                </div>
                <div className={`grid gap-2 ${isReady ? "" : "2xl:w-[22rem] 2xl:grid-cols-1"}`}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <Button
                      aria-describedby={shouldPromptSaveContact ? "save-contact-hint" : undefined}
                      className={[
                        "relative w-full whitespace-normal px-3 text-center text-sm leading-tight",
                        shouldPromptSaveContact
                          ? "border-primary bg-primary/10 text-foreground shadow-[0_0_0_3px_rgba(234,185,57,0.28)]"
                          : ""
                      ].filter(Boolean).join(" ")}
                      onClick={addContact}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {shouldPromptSaveContact ? (
                        <span
                          className="pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 rounded-md border border-primary/55 bg-background px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-primary shadow-sm"
                          id="save-contact-hint"
                        >
                          Tap here
                          <span className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rotate-45 border-b border-r border-primary/55 bg-background" />
                        </span>
                      ) : null}
                      <IdCard className="size-4 shrink-0" />
                      Save Sidetone as contact
                    </Button>
                    <Button
                      aria-expanded={showReadyGuide}
                      className="px-3 text-sm"
                      onClick={() => setShowReadyGuide((value) => !value)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      <BookOpen className="size-4" />
                      How
                    </Button>
                  </div>
                </div>
              </div>
              {showReadyGuide ? (
                <MergeGuide
                  platform={mergeGuidePlatform}
                  setPlatform={setMergeGuidePlatform}
                  showCompleteAction={false}
                />
              ) : null}
              <div className="grid gap-3 pt-1">
                <label className="grid gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Sparkles className="size-4 text-primary" />
                    Listen For
                  </span>
                  <Input
                    onChange={(event) => setCallFocusText(event.target.value)}
                    placeholder="Budget owner, renewal blockers, spouse approval..."
                    value={callFocusText}
                  />
                </label>
                <label className="flex items-center justify-between gap-4 rounded-md border border-border bg-secondary/35 px-3 py-3">
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-sm font-semibold text-foreground">Recording disclosure</span>
                    <span className="text-xs leading-5 text-muted-foreground">
                      Play Sidetone&apos;s disclosure before notes start.
                    </span>
                  </span>
                  <input
                    checked={!skipDisclosure}
                    className="peer sr-only"
                    onChange={(event) => setSkipDisclosure(!event.target.checked)}
                    type="checkbox"
                  />
                  <span
                    aria-hidden="true"
                    className="relative h-6 w-11 shrink-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-amber-500 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-500/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-cream-50 after:shadow-[0_1px_2px_rgba(10,25,47,0.25)] after:transition-transform peer-checked:after:translate-x-5"
                  />
                </label>
              </div>
              <div
                className={`grid gap-5 ${isReady ? "border-t border-border pt-5" : ""}`}
                style={{
                  "--mode-accent": selectedIndustry.accent,
                  "--mode-card-bg": selectedIndustry.accent
                } as CSSProperties}
              >
                <div className="grid gap-4">
                  <div className="flex items-center gap-4 border-b border-border pb-4">
                    <IndustryProfileCard
                      active
                      className="pointer-events-none size-16 shrink-0 sm:size-20"
                      profile={selectedIndustry}
                      type="div"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase tracking-[0.22em] text-primary">
                        Call profile
                      </p>
                      <h3 className="mt-1 text-xl font-black leading-tight text-foreground sm:text-2xl">
                        {selectedIndustry.personaName} · {selectedIndustry.industry}
                      </h3>
                      <p className="roster-copy mt-1 text-sm sm:text-base">{selectedIndustry.outcome}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,5rem))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(5.75rem,5.75rem))] sm:gap-3">
                    {selectableIndustryProfiles.map((profile) => (
                      <IndustryProfileCard
                        className="size-20 sm:size-[5.75rem]"
                        key={profile.id}
                        onClick={() => chooseIndustryProfile(profile.id)}
                        profile={profile}
                      />
                    ))}
                  </div>
                </div>
              </div>
              {activationStep === "save_contact" ? (
                <div className="grid gap-4 border-t border-border pt-5">
                  <div>
                    <h3 className="text-2xl font-semibold">Put Sidetone one tap away.</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Tap <strong>Contact</strong> above, save the card as Sidetone Notes, then it will be easy to add during a real call.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={addContact} type="button">
                      <IdCard className="size-4" />
                      Add Sidetone to contacts
                    </Button>
                    <Button onClick={skipContact} type="button" variant="secondary">
                      Skip for now
                    </Button>
                  </div>
                </div>
              ) : null}

              </>
            ) : (
              <>
              <div className="grid gap-3 md:grid-cols-[160px_auto]">
                <Input
                  inputMode="numeric"
                  maxLength={3}
                  onChange={(event) => setAreaCode(event.target.value.replace(/\D/g, "").slice(0, 3))}
                  placeholder="Area code"
                  value={areaCode}
                />
                <Button disabled={!canSearch || busy === "search"} onClick={searchNumbers} size="lg">
                  {busy === "search" ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
                  Search numbers
                </Button>
              </div>
              {numbers.length ? (
                <div className="grid border-t border-border">
                  {numbers.map((number) => (
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4"
                      key={number.phoneNumber}
                    >
                      <div>
                        <p className="font-mono text-lg font-semibold">{number.phoneNumber}</p>
                        <p className="text-sm text-muted-foreground">
                          {[number.locality, number.region, formatPrice(number)].filter(Boolean).join(" • ")}
                        </p>
                      </div>
                      <Button disabled={busy === "provision"} onClick={() => provisionNumber(number.phoneNumber)}>
                        {busy === "provision" ? <LoaderCircle className="size-4 animate-spin" /> : <Headphones className="size-4" />}
                        Use this number
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
              </>
            )}
            {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </CardContent>
        </Card> : null}

        <Card>
          <CardHeader className="gap-3 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="inline-flex size-10 items-center justify-center rounded-md border border-primary/45 bg-[#07182C]/58 text-primary">
                  <History aria-hidden="true" className="size-5" />
                </span>
                <CardTitle className="sr-only">Recent calls</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                {recentCalls.length ? (
                  <a
                    aria-label="View all calls"
                    className="inline-flex h-9 items-center rounded-md px-2 text-sm font-semibold text-muted-foreground transition hover:text-primary focus-visible:underline focus-visible:outline-none"
                    href="/calls"
                  >
                    All calls
                  </a>
                ) : null}
                <input
                  accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.oga,.aac"
                  aria-label="Upload recording"
                  className="sr-only"
                  onChange={(event) => void uploadRecording(event.currentTarget.files?.[0] ?? null)}
                  ref={uploadInputRef}
                  type="file"
                />
              </div>
            </div>
            {showRecentContactFilter ? (
              <div
                className="relative w-full"
                onBlur={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                    setRecentContactFilterOpen(false);
                  }
                }}
              >
                <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                  Contact
                </div>
                <button
                  aria-expanded={recentContactFilterOpen}
                  aria-haspopup="listbox"
                  className="flex h-11 w-full items-center justify-between gap-3 rounded-md border border-border bg-background px-3 text-left text-sm font-semibold text-foreground shadow-[inset_0_0_0_1px_rgba(10,25,47,0.04)] transition hover:border-primary/60 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  onClick={() => setRecentContactFilterOpen((open) => !open)}
                  type="button"
                >
                  <span className="min-w-0 truncate">
                    {selectedRecentContact
                      ? `${selectedRecentContact.name} · ${filteredRecentCalls.length} ${filteredRecentCalls.length === 1 ? "call" : "calls"}`
                      : `All ${recentCalls.length} ${recentCalls.length === 1 ? "call" : "calls"}`}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={[
                      "size-4 shrink-0 text-muted-foreground transition",
                      recentContactFilterOpen ? "rotate-180 text-primary" : ""
                    ].join(" ")}
                  />
                </button>
                {recentContactFilterOpen ? (
                  <div
                    className="absolute right-0 z-50 mt-2 grid max-h-72 w-full overflow-y-auto rounded-md border border-border bg-background p-1 shadow-[0_18px_48px_rgba(10,25,47,0.16)]"
                    role="listbox"
                  >
                    <button
                      aria-selected={!validRecentEntityFilterId}
                      className="flex min-h-10 items-center justify-between gap-3 rounded-sm px-3 text-left text-sm font-semibold text-foreground transition hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
                      onClick={() => {
                        setRecentEntityFilterId("");
                        setRecentContactFilterOpen(false);
                      }}
                      role="option"
                      type="button"
                    >
                      <span>All {recentCalls.length} {recentCalls.length === 1 ? "call" : "calls"}</span>
                      {!validRecentEntityFilterId ? <Check className="size-4 text-primary" aria-hidden="true" /> : null}
                    </button>
                    {savedContacts.map((entity) => (
                      <button
                        aria-selected={validRecentEntityFilterId === entity._id}
                        className="flex min-h-10 items-center justify-between gap-3 rounded-sm px-3 text-left text-sm font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:bg-secondary focus-visible:text-foreground focus-visible:outline-none"
                        key={entity._id}
                        onClick={() => {
                          setRecentEntityFilterId(entity._id);
                          setRecentContactFilterOpen(false);
                        }}
                        role="option"
                        type="button"
                      >
                        <span className="min-w-0 truncate">{entity.name}</span>
                        {validRecentEntityFilterId === entity._id ? <Check className="size-4 shrink-0 text-primary" aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="grid px-4 pb-4 md:max-h-[44rem] md:overflow-y-auto md:px-6 md:pb-6">
            {meetingSourcesEnabled ? (
              <form
                className="grid gap-3 border-t border-border py-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void startMeetingCapture();
                }}
              >
                <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 md:grid-cols-[3rem_minmax(0,1fr)]">
                  <span className="flex size-10 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground md:size-12">
                    {meetingCaptureState === "starting" ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Video className="size-4" />
                    )}
                  </span>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <label className="sr-only" htmlFor="sidetone-meeting-url">Meeting link</label>
                    <Input
                      autoComplete="off"
                      id="sidetone-meeting-url"
                      onChange={(event) => setMeetingUrl(event.target.value)}
                      placeholder="Paste a link for an enabled meeting source"
                      value={meetingUrl}
                    />
                    <Button disabled={meetingCaptureState === "starting" || !isSupportedMeetingInput(meetingUrl)} type="submit">
                      {meetingCaptureState === "starting" ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Video className="size-4" />
                      )}
                      Add meeting
                    </Button>
                  </div>
                </div>
                <div className="ml-[3.25rem] flex flex-wrap gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:ml-[3.75rem]">
                  <span>Google Meet</span>
                  <span aria-hidden="true">/</span>
                  <span>Microsoft Teams</span>
                </div>
              </form>
            ) : null}
            <button
              className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-border py-3 text-left transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60 md:grid-cols-[3rem_minmax(0,1fr)_auto]"
              disabled={recordingUploadState === "uploading"}
              onClick={() => uploadInputRef.current?.click()}
              type="button"
            >
              <span className="flex size-10 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground md:size-12">
                {recordingUploadState === "uploading" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-base font-semibold text-foreground sm:text-lg">
                  {recordingUploadState === "uploading" ? "Uploading recording" : "Upload recording"}
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  Add an audio file to the call list.
                </span>
              </span>
              <span className="hidden text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:inline">
                Audio
              </span>
            </button>
            {visibleRecentCalls.length ? (
              visibleRecentCalls.map((call) => {
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
                    className="group/call-row relative -mx-2 grid cursor-pointer grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md border-t border-border px-2 py-3 transition hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background first:pt-0 md:grid-cols-[3rem_minmax(0,1fr)_auto]"
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
                      <div className="flex min-w-0 items-center gap-2">
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
                      </div>
                      {identitySaveState === "failed" && editingCallId === call._id ? (
                        <span className="mt-1 block text-xs font-semibold text-destructive">Save failed</span>
                      ) : null}
                      <p className="mt-0.5 block min-w-0 truncate text-sm text-muted-foreground transition group-hover/call-row:text-foreground">
                        {[call.callBasis ?? call.summaryTitle ?? callModeLabel(call.mode), formatCallTime(call.displayTimestamp ?? call.createdAt)]
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
                          className="size-11 rounded-full border-[#F6EFE2]/70 bg-[#F6EFE2]/10 px-0 text-[#F6EFE2] shadow-[0_10px_24px_rgba(0,0,0,0.18),inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:border-primary hover:bg-primary hover:text-primary-foreground"
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
                        <Badge className="call-row-status-badge" variant={statusView.variant}>
                          {statusView.label}
                        </Badge>
                      )}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="mt-3 rounded-md border border-dashed border-border bg-[#07182C]/45 p-5 text-sm leading-6 text-muted-foreground">
                {validRecentEntityFilterId ? (
                  <div className="grid gap-3">
                    <div>
                      <p className="font-semibold text-foreground">No calls for {selectedRecentContact?.name ?? "this contact"}.</p>
                      <p>Try all contacts or choose another saved contact.</p>
                    </div>
                    <Button className="w-fit" onClick={() => setRecentEntityFilterId("")} size="sm" type="button" variant="secondary">
                      Show all calls
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    <div>
                      <p className="font-semibold text-foreground">No calls yet.</p>
                      <p>Upload a recording and it will appear here as it is processed.</p>
                    </div>
                  </div>
                )}
              </div>
            )}
            {hasMoreRecent ? (
              <button
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-transparent text-sm font-semibold text-muted-foreground transition hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setShowAllRecent((value) => !value)}
                type="button"
              >
                {showAllRecent
                  ? "Show fewer"
                  : `Show all ${filteredRecentCalls.length} calls`}
                <ChevronDown
                  aria-hidden="true"
                  className={`size-4 transition ${showAllRecent ? "rotate-180" : ""}`}
                />
              </button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
