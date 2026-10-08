import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
}

function recordingFormat(value: unknown) {
  return value === "mp3"
    || value === "wav"
    || value === "m4a"
    || value === "webm"
    || value === "ogg"
    ? value
    : undefined;
}

http.route({
  path: "/call-intelligence/run-step",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expectedToken = process.env.SIDETONE_WORKER_TOKEN?.trim();
    if (!expectedToken || bearerToken(request) !== expectedToken) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const runId = body?.runId;
    const operation = body?.operation;
    const callSessionId = body?.callSessionId;
    const inngestRunId = typeof body?.inngestRunId === "string" ? body.inngestRunId : undefined;

    if (typeof operation !== "string") {
      return json({ error: "Missing run step payload." }, { status: 400 });
    }

    try {
      if (operation === "claim-run") {
        const result = await ctx.runMutation(internal.intelligence.claimCallIntelligenceRunInternal, {
          runId,
          inngestRunId
        });
        return json({ ok: true, result });
      }

      if (operation === "plan-retrieval") {
        const result = await ctx.runAction(internal.intelligence.planCallIntelligenceRunInternal, { runId });
        return json({ ok: true, result });
      }

      if (operation === "retrieve-evidence") {
        const result = await ctx.runAction(internal.intelligence.retrieveCallIntelligenceRunEvidenceInternal, { runId });
        return json({ ok: true, result });
      }

      if (operation === "generate-answer") {
        const result = await ctx.runAction(internal.intelligence.answerCallIntelligenceRunInternal, { runId });
        return json({ ok: true, result });
      }

      if (operation === "complete-run") {
        const result = await ctx.runMutation(internal.intelligence.completeCallIntelligenceRunInternal, { runId });
        return json({ ok: true, result });
      }

      if (operation === "fail-run") {
        const result = await ctx.runMutation(internal.intelligence.failCallIntelligenceRunInternal, {
          runId,
          errorCode: typeof body?.errorCode === "string" ? body.errorCode : "worker_failed",
          error: typeof body?.error === "string" ? body.error : "Call Intelligence run failed."
        });
        return json({ ok: true, result });
      }

      if (operation === "monitor-live-call") {
        const result = await ctx.runMutation(internal.billing.monitorLiveCallInternal, { callSessionId });
        return json({ ok: true, result });
      }

      if (operation === "prepare-live-card-run") {
        const result = await ctx.runAction(internal.intelligence.prepareLiveCardRunInternal, {
          callSessionId,
          sourceSegmentIds: Array.isArray(body?.sourceSegmentIds) ? body.sourceSegmentIds : [],
          supervisorModel: typeof body?.supervisorModel === "string" ? body.supervisorModel : undefined,
          inngestRunId
        });
        return json({ ok: true, result });
      }

      if (operation === "complete-live-card-run") {
        const result = await ctx.runMutation(internal.intelligence.completeLiveCardRunInternal, {
          liveCardRunId: body?.liveCardRunId,
          status: body?.status === "skipped"
            || body?.status === "routed"
            || body?.status === "ready"
            || body?.status === "failed"
            ? body.status
            : "failed",
          routedAgentIds: Array.isArray(body?.routedAgentIds) ? body.routedAgentIds.map(String) : undefined,
          skipReason: typeof body?.skipReason === "string" ? body.skipReason : undefined,
          error: typeof body?.error === "string" ? body.error : undefined,
          supervisorModel: typeof body?.supervisorModel === "string" ? body.supervisorModel : undefined
        });
        return json({ ok: true, result });
      }

      if (operation === "prepare-live-card-agent-run") {
        const result = await ctx.runMutation(internal.intelligence.prepareLiveCardAgentRunInternal, {
          liveCardRunId: body?.liveCardRunId,
          agentId: String(body?.agentId ?? ""),
          specialistModel: typeof body?.specialistModel === "string" ? body.specialistModel : undefined
        });
        return json({ ok: true, result });
      }

      if (operation === "complete-live-card-agent-run") {
        const result = await ctx.runMutation(internal.intelligence.completeLiveCardAgentRunInternal, {
          liveCardAgentRunId: body?.liveCardAgentRunId,
          specialistModel: typeof body?.specialistModel === "string" ? body.specialistModel : undefined,
          candidate: body?.candidate ?? { emit: false, skipReason: "missing_candidate" }
        });
        return json({ ok: true, result });
      }

      if (operation === "fail-live-card-agent-run") {
        const result = await ctx.runMutation(internal.intelligence.failLiveCardAgentRunInternal, {
          liveCardRunId: body?.liveCardRunId,
          agentId: typeof body?.agentId === "string" ? body.agentId : undefined,
          error: typeof body?.error === "string" ? body.error : "Live card agent failed."
        });
        return json({ ok: true, result });
      }

      if (operation === "discord-command-start") {
        const result = await ctx.runMutation(internal.discord.enqueueDiscordStartInternal, {
          discordApplicationId: typeof body?.discordApplicationId === "string" ? body.discordApplicationId : undefined,
          discordGuildId: String(body?.discordGuildId ?? ""),
          discordGuildName: typeof body?.discordGuildName === "string" ? body.discordGuildName : undefined,
          discordStartedByUserId: String(body?.discordUserId ?? ""),
          discordStartedByUsername: typeof body?.discordUsername === "string" ? body.discordUsername : undefined,
          entityName: typeof body?.entityName === "string" ? body.entityName : undefined,
          listenFor: typeof body?.listenFor === "string" ? body.listenFor : undefined
        });
        return json({ ok: true, result });
      }

      if (operation === "discord-command-status") {
        const result = await ctx.runMutation(internal.discord.discordStatusInternal, {
          discordGuildId: String(body?.discordGuildId ?? ""),
          discordUserId: String(body?.discordUserId ?? "")
        });
        return json({ ok: true, result });
      }

      if (operation === "discord-command-stop") {
        const result = await ctx.runMutation(internal.discord.requestDiscordStopInternal, {
          discordGuildId: String(body?.discordGuildId ?? ""),
          discordUserId: String(body?.discordUserId ?? "")
        });
        return json({ ok: true, result });
      }

      if (operation === "discord-claim-capture") {
        const result = await ctx.runMutation(internal.discord.claimDiscordCaptureInternal, {
          workerSessionId: String(body?.workerSessionId ?? "")
        });
        return json({ ok: true, result });
      }

      if (operation === "discord-capture-state") {
        const result = await ctx.runQuery(internal.discord.discordCaptureStateInternal, {
          captureId: body?.captureId,
          workerSessionId: String(body?.workerSessionId ?? "")
        });
        return json({ ok: true, result });
      }

      if (operation === "discord-mark-recording") {
        const result = await ctx.runMutation(internal.discord.markDiscordCaptureRecordingInternal, {
          captureId: body?.captureId,
          workerSessionId: String(body?.workerSessionId ?? ""),
          discordChannelId: String(body?.discordChannelId ?? ""),
          discordChannelName: typeof body?.discordChannelName === "string" ? body.discordChannelName : undefined,
          participantCount: typeof body?.participantCount === "number" ? body.participantCount : undefined
        });
        return json({ ok: true, result });
      }

      if (operation === "discord-generate-upload-url") {
        const result = await ctx.storage.generateUploadUrl();
        return json({ ok: true, result: { uploadUrl: result } });
      }

      if (operation === "discord-complete-capture") {
        const result = await ctx.runMutation(internal.discord.completeDiscordCaptureInternal, {
          captureId: body?.captureId,
          workerSessionId: String(body?.workerSessionId ?? ""),
          storageId: body?.storageId,
          fileName: String(body?.fileName ?? "discord-voice.webm"),
          mimeType: String(body?.mimeType ?? "audio/webm"),
          sizeBytes: typeof body?.sizeBytes === "number" ? body.sizeBytes : 0,
          durationMs: typeof body?.durationMs === "number" ? body.durationMs : undefined,
          participantCount: typeof body?.participantCount === "number" ? body.participantCount : undefined
        });
        return json({ ok: true, result });
      }

      if (operation === "discord-fail-capture") {
        const result = await ctx.runMutation(internal.discord.failDiscordCaptureInternal, {
          captureId: body?.captureId,
          workerSessionId: typeof body?.workerSessionId === "string" ? body.workerSessionId : undefined,
          error: typeof body?.error === "string" ? body.error : "Discord voice capture failed."
        });
        return json({ ok: true, result });
      }

      if (operation === "prepare-uploaded-recording") {
        const result = await ctx.runAction(internal.calls.prepareUploadedRecordingProcessingInternal, { callSessionId });
        return json({ ok: true, result });
      }

      if (operation === "record-uploaded-transcript") {
        const segments = Array.isArray(body?.segments) ? body.segments : [];
        const result = await ctx.runMutation(internal.calls.recordUploadedRecordingTranscriptInternal, {
          callSessionId,
          assemblyAiTranscriptId: typeof body?.assemblyAiTranscriptId === "string" ? body.assemblyAiTranscriptId : undefined,
          segments
        });
        return json({ ok: true, result });
      }

      if (operation === "finalize-uploaded-recording") {
        const result = await ctx.runAction(internal.calls.finalizeUploadedRecordingInternal, { callSessionId });
        return json({ ok: true, result });
      }

      if (operation === "fail-uploaded-recording") {
        const result = await ctx.runMutation(internal.calls.markUploadedRecordingFailedInternal, {
          callSessionId,
          error: typeof body?.error === "string" ? body.error : "Uploaded recording processing failed."
        });
        return json({ ok: true, result });
      }

      if (operation === "prepare-vexa-meeting") {
        const result = await ctx.runMutation(internal.calls.prepareVexaMeetingProcessingInternal, { callSessionId });
        return json({ ok: true, result });
      }

      if (operation === "record-vexa-transcript") {
        const segments = Array.isArray(body?.segments) ? body.segments : [];
        const result = await ctx.runMutation(internal.calls.recordVexaMeetingTranscriptInternal, {
          callSessionId,
          provider: body?.provider === "assemblyai" ? "assemblyai" : "vexa",
          assemblyAiTranscriptId: typeof body?.assemblyAiTranscriptId === "string" ? body.assemblyAiTranscriptId : undefined,
          vexaStatus: typeof body?.vexaStatus === "string" ? body.vexaStatus : undefined,
          segments
        });
        return json({ ok: true, result });
      }

      if (operation === "record-vexa-recording") {
        const vexaRecordingId = typeof body?.vexaRecordingId === "string" ? body.vexaRecordingId : "";
        const vexaMediaFileId = typeof body?.vexaMediaFileId === "string" ? body.vexaMediaFileId : "";
        if (!vexaRecordingId || !vexaMediaFileId) {
          return json({ error: "Missing Vexa recording payload." }, { status: 400 });
        }
        const result = await ctx.runMutation(internal.calls.recordVexaMeetingRecordingInternal, {
          callSessionId,
          vexaRecordingId,
          vexaMeetingId: typeof body?.vexaMeetingId === "string" ? body.vexaMeetingId : undefined,
          vexaMediaFileId,
          status: body?.status === "failed" ? "failed" : "ready",
          format: recordingFormat(body?.format),
          fileName: typeof body?.fileName === "string" ? body.fileName : undefined,
          mimeType: typeof body?.mimeType === "string" ? body.mimeType : undefined,
          sizeBytes: typeof body?.sizeBytes === "number" ? body.sizeBytes : undefined,
          recordingStartedAt: typeof body?.recordingStartedAt === "number" ? body.recordingStartedAt : undefined,
          recordingEndedAt: typeof body?.recordingEndedAt === "number" ? body.recordingEndedAt : undefined,
          durationMs: typeof body?.durationMs === "number" ? body.durationMs : undefined
        });
        return json({ ok: true, result });
      }

      if (operation === "finalize-vexa-meeting") {
        const result = await ctx.runAction(internal.calls.finalizeVexaMeetingInternal, { callSessionId });
        return json({ ok: true, result });
      }

      if (operation === "fail-vexa-meeting") {
        const result = await ctx.runMutation(internal.calls.markVexaMeetingFailedInternal, {
          callSessionId,
          error: typeof body?.error === "string" ? body.error : "Vexa meeting processing failed."
        });
        return json({ ok: true, result });
      }

      if (operation === "zoom-rtms-started") {
        const result = await ctx.runMutation(internal.calls.claimZoomRtmsStartInternal, {
          zoomMeetingId: String(body?.zoomMeetingId ?? ""),
          zoomMeetingUuid: typeof body?.zoomMeetingUuid === "string" ? body.zoomMeetingUuid : undefined,
          rtmsStreamId: String(body?.rtmsStreamId ?? ""),
          serverUrls: typeof body?.serverUrls === "string" ? body.serverUrls : undefined
        });
        return json({ ok: true, result });
      }

      if (operation === "zoom-rtms-oauth-for-call") {
        const result = await ctx.runQuery(internal.calls.zoomRtmsOauthForCallInternal, { callSessionId });
        return json({ ok: true, result });
      }

      if (operation === "zoom-rtms-update-oauth") {
        const result = await ctx.runMutation(internal.calls.updateZoomOauthTokensInternal, {
          installationId: body?.installationId,
          accessToken: String(body?.accessToken ?? ""),
          refreshToken: typeof body?.refreshToken === "string" ? body.refreshToken : undefined,
          tokenType: typeof body?.tokenType === "string" ? body.tokenType : undefined,
          scopes: Array.isArray(body?.scopes) ? body.scopes.filter((scope: unknown) => typeof scope === "string") : undefined,
          expiresInSeconds: typeof body?.expiresInSeconds === "number" ? body.expiresInSeconds : undefined
        });
        return json({ ok: true, result });
      }

      if (operation === "zoom-rtms-start-requested") {
        const result = await ctx.runMutation(internal.calls.markZoomRtmsStartRequestedInternal, { callSessionId });
        return json({ ok: true, result });
      }

      if (operation === "zoom-rtms-transcript-segment") {
        const result = await ctx.runMutation(internal.calls.appendZoomRtmsTranscriptSegmentInternal, {
          callSessionId,
          text: String(body?.text ?? ""),
          speakerLabel: typeof body?.speakerLabel === "string" ? body.speakerLabel : undefined,
          startMs: typeof body?.startMs === "number" ? body.startMs : 0,
          endMs: typeof body?.endMs === "number" ? body.endMs : 1,
          confidence: typeof body?.confidence === "number" ? body.confidence : undefined,
          isFinal: typeof body?.isFinal === "boolean" ? body.isFinal : true
        });
        return json({ ok: true, result });
      }

      if (operation === "zoom-rtms-generate-upload-url") {
        const result = await ctx.storage.generateUploadUrl();
        return json({ ok: true, result: { uploadUrl: result } });
      }

      if (operation === "zoom-rtms-complete-recording") {
        const result = await ctx.runMutation(internal.calls.completeZoomRtmsRecordingInternal, {
          callSessionId,
          storageId: body?.storageId,
          recordingId: String(body?.recordingId ?? ""),
          fileName: String(body?.fileName ?? "zoom-rtms.wav"),
          mimeType: String(body?.mimeType ?? "audio/wav"),
          sizeBytes: typeof body?.sizeBytes === "number" ? body.sizeBytes : 0,
          format: recordingFormat(body?.format),
          recordingStartedAt: typeof body?.recordingStartedAt === "number" ? body.recordingStartedAt : undefined,
          recordingEndedAt: typeof body?.recordingEndedAt === "number" ? body.recordingEndedAt : undefined,
          durationMs: typeof body?.durationMs === "number" ? body.durationMs : undefined
        });
        return json({ ok: true, result });
      }

      if (operation === "zoom-rtms-stopped") {
        const result = await ctx.runMutation(internal.calls.markZoomRtmsStoppedInternal, {
          callSessionId,
          reason: typeof body?.reason === "string" ? body.reason : undefined
        });
        const artifact = await ctx.runAction(internal.calls.finalizeZoomRtmsMeetingInternal, { callSessionId });
        return json({ ok: true, result: { ...result, artifact } });
      }

      if (operation === "zoom-rtms-failed") {
        const result = await ctx.runMutation(internal.calls.markZoomRtmsFailedInternal, {
          callSessionId,
          error: typeof body?.error === "string" ? body.error : "Zoom RTMS failed."
        });
        return json({ ok: true, result });
      }

      return json({ error: "Unsupported run step." }, { status: 400 });
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Call Intelligence worker step failed." },
        { status: 500 }
      );
    }
  })
});

export default http;
