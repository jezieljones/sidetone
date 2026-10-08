import { featureEnabled } from "../../../lib/config";
import { getWorkerToken } from "../../../lib/config";
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { inngest } from "../../../inngest/client";
import { flushPendingStripeMeterEvents } from "../../../lib/billing-meter-events";
import {
  answerCall,
  callLegRoleFromClientState,
  callSessionIdFromClientState,
  createConferenceForCall,
  hangupCall,
  joinConferenceForCall,
  speakDisclosure,
  speakFirstCallOnboarding,
  speakCallStatus,
  startCallRecording,
  startCallThrough,
  listCallRecordings,
  verifyTelnyxWebhookSignature
} from "../../../lib/telnyx";

type TelnyxWebhook = {
  data?: {
    id?: string;
    event_type?: string;
    payload?: {
      call_control_id?: string;
      call_leg_id?: string;
      call_session_id?: string;
      client_state?: string;
      result?: string;
      answering_machine_detection_result?: string;
      direction?: string;
      from?: string;
      to?: string;
      hangup_cause?: string;
      recording_id?: string;
      recording_urls?: {
        mp3?: string;
        wav?: string;
      };
      public_recording_urls?: {
        mp3?: string;
        wav?: string;
      };
      format?: string;
      channels?: string;
      status?: string;
      recording_started_at?: string;
      recording_ended_at?: string;
      duration_millis?: number;
      duration_secs?: number;
    };
  };
};

type TelnyxWebhookPayload = NonNullable<NonNullable<TelnyxWebhook["data"]>["payload"]>;

type ExtractedRecording = {
  recordingId: string;
  status?: string;
  format?: "mp3" | "wav";
  channels?: "single" | "dual";
  recordingStartedAt?: number;
  recordingEndedAt?: number;
  durationMs?: number;
  recordingUrls?: {
    mp3?: string;
    wav?: string;
  };
  publicRecordingUrls?: {
    mp3?: string;
    wav?: string;
  };
};

function statusForEvent(eventType: string) {
  if (eventType === "call.initiated") {
    return "connecting";
  }
  if (eventType === "call.answered") {
    return "live";
  }
  if (eventType === "call.hangup") {
    return "processing";
  }
  if (eventType === "call.failed") {
    return "failed";
  }
  return null;
}

function normalizePhone(input?: string) {
  if (!input) {
    return undefined;
  }

  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  return input;
}

function externalHangupMessage(cause?: string) {
  if (cause === "timeout") {
    return "The other person did not answer. You can try again whenever you are ready.";
  }
  if (cause === "not_found") {
    return "That call could not be completed. Check the phone number, then try again.";
  }
  if (cause === "busy") {
    return "The other person appears to be busy. You can try again whenever you are ready.";
  }
  return "The other side ended the call.";
}

function timestampFromIso(input?: string) {
  if (!input) {
    return undefined;
  }
  const timestamp = Date.parse(input);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function recordingFormat(input?: string) {
  return input === "wav" ? "wav" : input === "mp3" ? "mp3" : undefined;
}

function recordingChannels(input?: string) {
  return input === "dual" ? "dual" : input === "single" ? "single" : undefined;
}

function timestampFromAny(input?: unknown) {
  if (typeof input === "string") {
    const timestamp = Date.parse(input);
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  if (typeof input === "number") {
    return input;
  }
  return undefined;
}

function asNumber(input?: unknown) {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input;
  }
  if (typeof input === "string") {
    const parsed = Number(input);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function extractRecordingFromPayload(payload: TelnyxWebhookPayload): ExtractedRecording | null {
  const candidate = payload.recording_id
    ?? (payload as { recordingId?: unknown }).recordingId as string | undefined
    ?? (payload as { recording?: { id?: unknown } }).recording?.id as string | undefined;

  const recordingId = typeof candidate === "string"
    ? candidate.trim()
    : undefined;

  if (!recordingId) {
    if (Array.isArray((payload as { recordings?: unknown }).recordings)) {
      const recordings = (payload as { recordings: unknown[] }).recordings;
      const first = recordings[0];
      if (!first || typeof first !== "object") {
        return null;
      }

      const recording = first as Record<string, unknown>;
      const fallback = recording.recording_id ?? recording.id;
      if (typeof fallback === "string" && fallback.trim()) {
        return {
          recordingId: fallback.trim(),
          status: typeof recording.status === "string" ? recording.status : undefined,
          format: recordingFormat(typeof recording.format === "string" ? recording.format : undefined),
          channels: recordingChannels(typeof recording.channels === "string" ? recording.channels : undefined),
          recordingStartedAt: timestampFromAny(recording.started_at),
          recordingEndedAt: timestampFromAny(recording.ended_at),
          durationMs: asNumber(recording.duration_millis)
            ?? (asNumber(recording.duration_secs) ? asNumber(recording.duration_secs)! * 1000 : undefined),
          recordingUrls: typeof recording.recording_urls === "object" ? recording.recording_urls as {
            mp3?: string;
            wav?: string;
          } : undefined,
          publicRecordingUrls: typeof recording.public_recording_urls === "object"
            ? recording.public_recording_urls as {
              mp3?: string;
              wav?: string;
            }
            : undefined
        };
      }
    }
    return null;
  }

  return {
    recordingId,
    status: typeof payload.status === "string" ? payload.status : undefined,
    format: recordingFormat(payload.format as string | undefined),
    channels: recordingChannels(payload.channels as string | undefined),
    recordingStartedAt: timestampFromIso(payload.recording_started_at),
    recordingEndedAt: timestampFromIso(payload.recording_ended_at),
    durationMs: asNumber(payload.duration_millis)
      ?? (asNumber(payload.duration_secs) ? asNumber(payload.duration_secs)! * 1000 : undefined),
    recordingUrls: payload.recording_urls,
    publicRecordingUrls: payload.public_recording_urls
  };
}

function machineDetectionOutcome(eventType: string, payload: TelnyxWebhookPayload) {
  if (!/call\.machine(\.[^.]+)?\.detection\.ended$/.test(eventType)) {
    return null;
  }

  const result = String(
    payload?.answering_machine_detection_result
      ?? payload?.result
      ?? payload?.status
      ?? ""
  ).trim().toLowerCase();

  if (!result) {
    return null;
  }

  if (
    result === "human"
    || result === "human_business"
    || result === "human_residence"
    || result === "not_sure"
    || result === "unknown"
  ) {
    return "human" as const;
  }

  if (
    result === "machine"
    || result === "fax_detected"
    || result === "silence"
    || result.startsWith("machine_")
  ) {
    return "machine" as const;
  }

  return null;
}

async function syncMeterEventsAfterFinalization() {
  await flushPendingStripeMeterEvents().catch((error) => {
    console.warn("Unable to sync Sidetone Stripe meter events.", error);
  });
}

async function notifyOwnerAndHangup(input: {
  ownerCallControlId?: string | null;
  callSessionId: string;
  message: string;
}) {
  if (!input.ownerCallControlId) {
    return;
  }

  await speakCallStatus({
    callControlId: input.ownerCallControlId,
    callSessionId: input.callSessionId,
    message: input.message
  }).catch((error) => {
    console.warn("Unable to play Sidetone call-through status.", error);
  });

  await new Promise((resolve) => setTimeout(resolve, 3500));

  await hangupCall({ callControlId: input.ownerCallControlId }).catch((error) => {
    console.warn("Unable to hang up Sidetone owner leg.", error);
  });
}

export async function POST(request: Request) {
  if (!featureEnabled("phone")) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const rawBody = await request.text();
  if (!verifyTelnyxWebhookSignature({ headers: request.headers, rawBody })) {
    return NextResponse.json({ error: "Invalid Telnyx webhook signature." }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as TelnyxWebhook;
  const event = body.data;
  const eventType = event?.event_type ?? "unknown";
  const payload = event?.payload ?? {};
  const providerEventId = event?.id ?? `${eventType}:${payload.call_control_id ?? payload.call_session_id ?? Date.now()}`;
  const clientStateSessionId = callSessionIdFromClientState(payload.client_state);
  const clientStateLegRole = callLegRoleFromClientState(payload.client_state);
  const fromPhoneNumber = normalizePhone(payload.from);
  const toPhoneNumber = normalizePhone(payload.to);

  const recorded = await fetchMutation(api.calls.recordTelnyxWebhookEvent, {
      workerToken: getWorkerToken(),
    providerEventId,
    eventType,
    payload,
    status: "received"
  });

  if (recorded.duplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  let callSession: any = null;
  if (clientStateSessionId) {
    callSession = await fetchQuery(api.calls.callSessionForTelnyxId, {
      workerToken: getWorkerToken(),
      telnyxCallControlId: payload.call_control_id,
      telnyxCallSessionId: payload.call_session_id
    }).catch(() => null);
  } else if (payload.call_session_id || payload.call_control_id) {
    callSession = await fetchQuery(api.calls.callSessionForTelnyxId, {
      workerToken: getWorkerToken(),
      telnyxCallControlId: payload.call_control_id,
      telnyxCallSessionId: payload.call_session_id
    }).catch(() => null);
  }

  let callSessionId = callSession?._id ?? clientStateSessionId ?? undefined;
  let callThroughContext: any = null;
  let billingMonitorQueued = false;

  async function queueBillingLiveCallMonitor() {
    if (!callSessionId || billingMonitorQueued) {
      return;
    }
    billingMonitorQueued = true;
    await inngest.send({
      name: "sidetone/billing.live-call-monitor.requested",
      data: { callSessionId: String(callSessionId) }
    }).catch((error) => {
      console.warn("Unable to queue Sidetone billing live-call monitor.", error);
    });
  }

  async function persistTelnyxRecording(recording: ExtractedRecording) {
    if (!callSessionId) {
      return;
    }

    await fetchMutation(api.calls.recordTelnyxCallRecordingSaved, {
      workerToken: getWorkerToken(),
      callSessionId: callSessionId as any,
      recordingId: recording.recordingId,
      status: recording.status === "failed" ? "failed" : "ready",
      source: eventType.startsWith("conference.") ? "conference" : "call",
      format: recording.format,
      channels: recording.channels,
      telnyxCallControlId: payload.call_control_id,
      telnyxCallLegId: payload.call_leg_id,
      telnyxCallSessionId: payload.call_session_id,
      telnyxConferenceId: callThroughContext?.callSession?.telnyxConferenceId,
      recordingStartedAt: recording.recordingStartedAt,
      recordingEndedAt: recording.recordingEndedAt,
      durationMs: recording.durationMs,
      recordingUrls: recording.recordingUrls,
      publicRecordingUrls: recording.publicRecordingUrls
    }).catch((error) => {
      console.warn("Unable to save Sidetone call recording metadata from webhook payload.", error);
    });
  }

  async function backfillRecordingsFromTelnyx() {
    if (!callSessionId || !payload.call_control_id) {
      return;
    }

    const recordings = await listCallRecordings({ callControlId: payload.call_control_id });
    for (const recording of recordings.slice(0, 5)) {
      await persistTelnyxRecording({
        recordingId: recording.recordingId,
        status: recording.status,
        format: recording.format,
        channels: recording.channels,
        recordingStartedAt: recording.recordingStartedAt,
        recordingEndedAt: recording.recordingEndedAt,
        durationMs: recording.durationMs,
        recordingUrls: recording.recordingUrls,
        publicRecordingUrls: recording.publicRecordingUrls
      });
    }
  }

  if (callSessionId) {
    callThroughContext = await fetchQuery(api.calls.callThroughRoutingContext, {
      workerToken: getWorkerToken(),
      callSessionId: callSessionId as any
    }).catch(() => null);
    callSession = callSession ?? callThroughContext?.callSession ?? null;
  }

  const matchedLegRole = payload.call_control_id && callThroughContext
    ? callThroughContext.ownerLeg?.telnyxCallControlId === payload.call_control_id
      ? "owner"
      : callThroughContext.externalLeg?.telnyxCallControlId === payload.call_control_id
        ? "external"
        : null
    : null;
  const effectiveLegRole = clientStateLegRole ?? matchedLegRole;
  const ownerMachineDetection = callThroughContext?.callSession?.mode === "call_through" && effectiveLegRole === "owner"
    ? machineDetectionOutcome(eventType, payload)
    : null;
  const deferOwnerBridgeUntilMachineDetection = callThroughContext?.callSession?.mode === "call_through"
    && effectiveLegRole === "owner";

  if (!callSessionId && eventType === "call.initiated" && payload.direction === "incoming" && toPhoneNumber) {
    const mapped = await fetchQuery(api.entities.entityByPhoneNumber, {
      workerToken: getWorkerToken(),
      phoneNumber: toPhoneNumber
    });

    if (mapped?.entity && payload.call_control_id) {
      const incomingCallControlId = payload.call_control_id;
      const workerToken = process.env.SIDETONE_WORKER_TOKEN?.trim();
      if (workerToken) {
        const billing = await fetchMutation(api.billing.phoneCallStartAuthorizationForWorker, {
          workerToken,
          entityId: mapped.entity._id
        }).catch((error) => {
          console.warn("Unable to check Sidetone billing before inbound call.", error);
          return null;
        });

        if (billing && !billing.canStart) {
          await hangupCall({ callControlId: incomingCallControlId }).catch((error) => {
            console.warn("Unable to hang up billing-blocked inbound call.", error);
          });
          await fetchMutation(api.calls.markTelnyxWebhookEventProcessed, {
      workerToken: getWorkerToken(),
            webhookEventId: recorded.webhookEventId,
            entityId: mapped.entity._id,
            status: "ignored",
            error: "Monthly phone minutes exhausted."
          });
          return NextResponse.json({ ok: true, blocked: true });
        }
      }

      const created = await fetchMutation(api.calls.createConferenceInSessionFromWebhook, {
      workerToken: getWorkerToken(),
        entityId: mapped.entity._id,
        fromPhoneNumber,
        toPhoneNumber,
        telnyxCallControlId: payload.call_control_id,
        telnyxCallSessionId: payload.call_session_id
      });

      callSessionId = created.callSessionId;
      callSession = {
        _id: created.callSessionId,
        entityId: mapped.entity._id,
        consentMode: created.consentMode
      };

      try {
        await answerCall({
          callControlId: incomingCallControlId,
          callSessionId: String(callSessionId)
        });
      } catch (error) {
        console.warn("Unable to answer Sidetone conference-in call.", error);
        await fetchMutation(api.calls.patchCallFromWebhook, {
      workerToken: getWorkerToken(),
          callSessionId: callSessionId as any,
          status: "failed",
          telnyxCallControlId: payload.call_control_id,
          telnyxCallSessionId: payload.call_session_id,
          failureReason: error instanceof Error ? error.message : "Unable to answer inbound call.",
          endedAt: Date.now()
        });
        await fetchMutation(api.calls.markTelnyxWebhookEventProcessed, {
      workerToken: getWorkerToken(),
          webhookEventId: recorded.webhookEventId,
          callSessionId: callSessionId as any,
          entityId: callSession.entityId,
          status: "failed",
          error: error instanceof Error ? error.message : "Unable to answer inbound call."
        });
        return NextResponse.json({ ok: false, error: "Unable to answer inbound call." }, { status: 200 });
      }

      if (created.shouldPlayOnboardingPrompt) {
        await speakFirstCallOnboarding({
          callControlId: incomingCallControlId,
          callSessionId: String(callSessionId),
          includeDisclosure: created.consentMode !== "owner_acknowledgment"
        }).catch(async (error) => {
          console.warn("Unable to play Sidetone first-call onboarding prompt.", error);
          if (created.consentMode !== "owner_acknowledgment") {
            await speakDisclosure({
              callControlId: incomingCallControlId,
              callSessionId: String(callSessionId)
            }).catch((disclosureError) => {
              console.warn("Unable to play Sidetone disclosure fallback.", disclosureError);
            });
          }
        });
      } else if (created.consentMode !== "owner_acknowledgment") {
        await speakDisclosure({
          callControlId: incomingCallControlId,
          callSessionId: String(callSessionId)
        }).catch((error) => {
          console.warn("Unable to play Sidetone disclosure.", error);
        });
      }
    }
  }

  if (callSessionId) {
    async function bridgeCallThroughOwnerLeg() {
      if (!callThroughContext?.callSession || !payload.call_control_id) {
        return;
      }

      const existingConferenceId = callThroughContext.callSession.telnyxConferenceId;
      const conferenceId = existingConferenceId
        ?? (await createConferenceForCall({
          callControlId: payload.call_control_id,
          callSessionId: String(callSessionId)
        })).conferenceId;

      await fetchMutation(api.calls.patchCallFromWebhook, {
      workerToken: getWorkerToken(),
        callSessionId: callSessionId as any,
        status: "live",
        telnyxCallControlId: payload.call_control_id,
        telnyxCallSessionId: payload.call_session_id,
        telnyxConferenceId: conferenceId,
        startedAt: Date.now()
      });

      await queueBillingLiveCallMonitor();

      if (!callThroughContext.externalLeg?.telnyxCallControlId && callThroughContext.externalLeg?.phoneNumber) {
        const from = callThroughContext.numberAssignment?.e164 ?? callThroughContext.numberAssignment?.phoneNumber;
        if (from && conferenceId) {
          const externalCall = await startCallThrough({
            fromPhoneNumber: from,
            toPhoneNumber: callThroughContext.externalLeg.phoneNumber,
            callSessionId: String(callSessionId),
            legRole: "external",
            timeoutSecs: 35
          });

          await fetchMutation(api.calls.patchCallLegFromWebhook, {
      workerToken: getWorkerToken(),
            callSessionId: callSessionId as any,
            role: "external",
            status: "ringing",
            phoneNumber: callThroughContext.externalLeg.phoneNumber,
            telnyxCallControlId: externalCall.callControlId
          });
        }
      }
    }

    async function failOwnerMachineDetected(reason: string) {
      await fetchMutation(api.calls.patchCallFromWebhook, {
      workerToken: getWorkerToken(),
        callSessionId: callSessionId as any,
        status: "failed",
        telnyxCallControlId: payload.call_control_id,
        telnyxCallSessionId: payload.call_session_id,
        failureReason: reason,
        endedAt: Date.now()
      });

      if (payload.call_control_id) {
        await hangupCall({ callControlId: payload.call_control_id }).catch((error) => {
          console.warn("Unable to hang up machine-answered Sidetone owner leg.", error);
        });
      }
    }

    const recordingFromPayload = extractRecordingFromPayload(payload);
    const eventIsRecording = /record/i.test(eventType);

    if (recordingFromPayload && eventIsRecording) {
      await persistTelnyxRecording(recordingFromPayload);
    }

    const legStatus = eventType === "call.answered"
      ? "answered"
      : eventType === "call.hangup"
        ? "ended"
        : eventType === "call.failed"
          ? "failed"
          : eventType === "call.initiated"
            ? "ringing"
            : null;

    if (effectiveLegRole && legStatus) {
      await fetchMutation(api.calls.patchCallLegFromWebhook, {
      workerToken: getWorkerToken(),
        callSessionId: callSessionId as any,
        role: effectiveLegRole,
        status: legStatus as any,
        phoneNumber: toPhoneNumber,
        telnyxCallControlId: payload.call_control_id,
        telnyxCallLegId: undefined,
        endedAt: legStatus === "ended" || legStatus === "failed" ? Date.now() : undefined
      }).catch((error) => {
        console.warn("Unable to patch Sidetone call leg.", error);
      });
    }

    const shouldStartRecording = (eventType === "call.answered" || ownerMachineDetection === "human")
      && Boolean(payload.call_control_id)
      && (
        (
          callThroughContext?.callSession?.mode !== "call_through"
          || effectiveLegRole === "owner"
        )
        && !(deferOwnerBridgeUntilMachineDetection && eventType === "call.answered")
      );

    if (shouldStartRecording && payload.call_control_id) {
      await startCallRecording({
        callControlId: payload.call_control_id,
        callSessionId: String(callSessionId)
      }).catch((error) => {
        console.warn("Unable to start Sidetone call recording.", error);
      });
    }

    const callThroughExternalEnded = callThroughContext?.callSession?.mode === "call_through"
      && effectiveLegRole === "external"
      && (eventType === "call.hangup" || eventType === "call.failed");

    if (callThroughExternalEnded) {
      const externalWasAnswered = callThroughContext.externalLeg?.status === "answered";
      const nextStatus = externalWasAnswered ? "processing" : "failed";
      const failureReason = externalWasAnswered
        ? payload.hangup_cause
        : externalHangupMessage(payload.hangup_cause);

      await fetchMutation(api.calls.patchCallFromWebhook, {
      workerToken: getWorkerToken(),
        callSessionId: callSessionId as any,
        status: nextStatus as any,
        telnyxCallControlId: callThroughContext.ownerLeg?.telnyxCallControlId ?? callSession?.telnyxCallControlId,
        telnyxCallSessionId: callSession?.telnyxCallSessionId,
        failureReason,
        endedAt: Date.now()
      });

      await notifyOwnerAndHangup({
        ownerCallControlId: callThroughContext.ownerLeg?.telnyxCallControlId ?? callSession?.telnyxCallControlId,
        callSessionId: String(callSessionId),
        message: externalHangupMessage(payload.hangup_cause)
      });
    }

    if (ownerMachineDetection === "machine") {
      await failOwnerMachineDetected("Your phone did not connect live. Sidetone detected voicemail or call screening before joining the other party.");
    }

    if (callThroughContext?.callSession?.mode === "call_through" && ownerMachineDetection === "human" && payload.call_control_id) {
      if (effectiveLegRole === "owner") {
        try {
          await bridgeCallThroughOwnerLeg();
        } catch (error) {
          console.warn("Unable to bridge Sidetone call-through owner leg after machine detection.", error);
          await fetchMutation(api.calls.patchCallFromWebhook, {
      workerToken: getWorkerToken(),
            callSessionId: callSessionId as any,
            status: "failed",
            failureReason: error instanceof Error ? error.message : "Unable to bridge call-through call.",
            endedAt: Date.now()
          });
        }
      }
    } else if (callThroughContext?.callSession?.mode === "call_through" && eventType === "call.answered" && payload.call_control_id) {
      if (effectiveLegRole === "owner") {
        // Wait for answering machine detection before bridging the external leg.
      } else if (effectiveLegRole === "external" && callThroughContext.callSession.telnyxConferenceId) {
        await joinConferenceForCall({
          conferenceId: callThroughContext.callSession.telnyxConferenceId,
          callControlId: payload.call_control_id,
          callSessionId: String(callSessionId),
          legRole: "external"
        }).catch(async (error) => {
          console.warn("Unable to join Sidetone call-through external leg.", error);
          await fetchMutation(api.calls.patchCallFromWebhook, {
      workerToken: getWorkerToken(),
            callSessionId: callSessionId as any,
            status: "failed",
            failureReason: error instanceof Error ? error.message : "Unable to join call-through call.",
            endedAt: Date.now()
          });
        });
      }
    }

    const status = statusForEvent(eventType);
    const preserveFailedCallThrough = callThroughContext?.callSession?.mode === "call_through"
      && callThroughContext.callSession.status === "failed"
      && status === "processing";

    const suppressImmediateLiveStatus = deferOwnerBridgeUntilMachineDetection && eventType === "call.answered";

    if (status && !callThroughExternalEnded && !preserveFailedCallThrough && !suppressImmediateLiveStatus) {
      await fetchMutation(api.calls.patchCallFromWebhook, {
      workerToken: getWorkerToken(),
        callSessionId: callSessionId as any,
        status: status as any,
        telnyxCallControlId: payload.call_control_id,
        telnyxCallSessionId: payload.call_session_id,
        failureReason: payload.hangup_cause,
        startedAt: status === "live" ? Date.now() : undefined,
        endedAt: status === "processing" || status === "failed" ? Date.now() : undefined
      });
      if (status === "live") {
        await queueBillingLiveCallMonitor();
      }
    }

    if (status === "processing" && !callThroughExternalEnded && !preserveFailedCallThrough) {
      if (callSession?.mode === "conference_in" || callSession?.mode === "call_through") {
        await backfillRecordingsFromTelnyx().catch((error) => {
          console.warn("Unable to backfill Sidetone recording metadata from Telnyx API.", error);
        });
      }

      await fetchMutation(api.calls.finalizeCallArtifactFromTranscript, {
      workerToken: getWorkerToken(),
        callSessionId: callSessionId as any
      }).catch((error) => {
        console.warn("Unable to prepare Sidetone post-call record.", error);
      });
      await fetchAction(api.calls.generateCallArtifactFromTranscript, {
      workerToken: getWorkerToken(),
        callSessionId: callSessionId as any
      }).catch((error) => {
        console.warn("Unable to generate Sidetone post-call record.", error);
      });
      await syncMeterEventsAfterFinalization();

      if ((callSession as { externalIntegration?: unknown } | null)?.externalIntegration) {
        const { inngest } = await import("../../../inngest/client");
        await inngest
          .send({
            name: "sidetone/external-call.completed",
            data: { callSessionId: String(callSessionId) }
          })
          .catch((error) => {
            console.warn("Unable to queue external call webhook delivery.", error);
          });
      }
    }
  }

  await fetchMutation(api.calls.markTelnyxWebhookEventProcessed, {
      workerToken: getWorkerToken(),
    webhookEventId: recorded.webhookEventId,
    callSessionId: callSessionId as any,
    entityId: callSession?.entityId,
    status: callSessionId ? "processed" : "ignored"
  });

  return NextResponse.json({ ok: true });
}
