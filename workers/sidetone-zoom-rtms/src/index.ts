import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { JoinParams, Metadata } from "@zoom/rtms";

type RtmsDefault = typeof import("@zoom/rtms").default;

type ConvexStepResponse<T> = {
  ok?: boolean;
  result?: T;
  error?: string;
};

type ZoomRtmsStartResult = {
  captureId: string;
  callSessionId: string;
  ownerTokenIdentifier: string;
};

type RtmsStartDetails = {
  zoomMeetingId: string;
  zoomMeetingUuid: string;
  rtmsStreamId: string;
  serverUrls: string;
  rawEvent: string;
};

type RtmsStopDetails = {
  zoomMeetingId?: string;
  rtmsStreamId?: string;
  reason?: string;
  rawEvent: string;
};

type JsonObject = Record<string, unknown>;

const workerSessionId = randomUUID();
const activeSessionsByStream = new Map<string, RtmsSession>();
const activeSessionsByMeeting = new Map<string, RtmsSession>();
let rtmsPromise: Promise<RtmsDefault> | null = null;

function env(name: string, ...fallbacks: Array<string | undefined>) {
  const value = [process.env[name]?.trim(), ...fallbacks.map((fallback) => fallback?.trim())].find(Boolean);
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

function envInt(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  const value = raw ? Number.parseInt(raw, 10) : fallback;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envBool(name: string, fallback: boolean) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return fallback;
}

const PORT = envInt("PORT", 8080);
const WEBHOOK_PATH = process.env.ZOOM_RTMS_WEBHOOK_PATH?.trim() || "/webhooks/zoom/rtms";
const CONVEX_SITE_URL = env(
  "CONVEX_SITE_URL",
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL,
  process.env.CONVEX_URL?.replace(".convex.cloud", ".convex.site"),
  process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site")
).replace(/\/+$/, "");
const SIDETONE_WORKER_TOKEN = env("SIDETONE_WORKER_TOKEN");
const ZOOM_RTMS_CLIENT_ID = env(
  "ZOOM_RTMS_CLIENT_ID",
  process.env.ZM_RTMS_CLIENT,
  process.env.ZOOM_RTMS_CLIENT_ID_DEV,
  process.env.ZOOM_RTMS_CLIENT_ID_PROD
);
const ZOOM_RTMS_CLIENT_SECRET = env(
  "ZOOM_RTMS_CLIENT_SECRET",
  process.env.ZM_RTMS_SECRET,
  process.env.ZOOM_RTMS_CLIENT_SECRET_DEV,
  process.env.ZOOM_RTMS_CLIENT_SECRET_PROD
);
const ZOOM_WEBHOOK_SECRET_TOKEN = env(
  "ZOOM_WEBHOOK_SECRET_TOKEN",
  process.env.ZOOM_RTMS_SECRET_TOKEN_DEV,
  process.env.ZOOM_RTMS_SECRET_TOKEN_PROD
);
const REQUIRE_ZOOM_SIGNATURE = envBool("ZOOM_RTMS_REQUIRE_SIGNATURE", true);
const ZOOM_SIGNATURE_MAX_AGE_SECONDS = envInt("ZOOM_SIGNATURE_MAX_AGE_SECONDS", 300);

const AUDIO_SAMPLE_RATE = 16_000;
const AUDIO_CHANNELS = 1;
const PCM_BYTES_PER_SAMPLE = 2;

function log(message: string, metadata?: Record<string, unknown>) {
  console.log(JSON.stringify({
    service: "sidetone-zoom-rtms",
    workerSessionId,
    message,
    ...(metadata ?? {})
  }));
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function loadRtms() {
  rtmsPromise ??= import("@zoom/rtms").then((module) => module.default);
  return rtmsPromise;
}

async function convexStep<T = unknown>(operation: string, body: Record<string, unknown> = {}) {
  const response = await fetch(`${CONVEX_SITE_URL}/call-intelligence/run-step`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SIDETONE_WORKER_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      operation,
      ...body
    })
  });
  const payload = await response.json().catch(() => null) as ConvexStepResponse<T> | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? `Convex step ${operation} failed.`);
  }
  return payload?.result as T;
}

function json(res: ServerResponse, statusCode: number, body: unknown) {
  const serialized = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(serialized)
  });
  res.end(serialized);
}

async function readRawBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function headerValue(req: IncomingMessage, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function timingSafeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.byteLength === rightBuffer.byteLength
    && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyZoomSignature(req: IncomingMessage, rawBody: Buffer) {
  if (!REQUIRE_ZOOM_SIGNATURE) {
    return true;
  }

  const timestamp = headerValue(req, "x-zm-request-timestamp");
  const signature = headerValue(req, "x-zm-signature");
  if (!timestamp || !signature) {
    return false;
  }

  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
  if (ageSeconds > ZOOM_SIGNATURE_MAX_AGE_SECONDS) {
    return false;
  }

  const message = `v0:${timestamp}:${rawBody.toString("utf8")}`;
  const digest = createHmac("sha256", ZOOM_WEBHOOK_SECRET_TOKEN)
    .update(message)
    .digest("hex");
  return timingSafeStringEqual(signature, `v0=${digest}`);
}

function urlValidationResponse(envelope: JsonObject) {
  const plainToken = objectValue(envelope.payload)?.plainToken;
  if (typeof plainToken !== "string" || !plainToken) {
    return null;
  }

  return {
    plainToken,
    encryptedToken: createHmac("sha256", ZOOM_WEBHOOK_SECRET_TOKEN)
      .update(plainToken)
      .digest("hex")
  };
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function nestedObjects(envelope: JsonObject) {
  const payload = objectValue(envelope.payload);
  const object = objectValue(payload?.object);
  const nestedPayload = objectValue(payload?.payload);
  const nestedObject = objectValue(nestedPayload?.object);
  return [object, nestedObject, nestedPayload, payload, envelope].filter(Boolean) as JsonObject[];
}

function stringLike(value: unknown) {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function pickString(objects: JsonObject[], keys: string[]) {
  for (const object of objects) {
    for (const key of keys) {
      const value = stringLike(object[key]);
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function pickServerUrls(objects: JsonObject[]) {
  for (const object of objects) {
    for (const key of ["server_urls", "serverUrls", "server_url", "serverUrl"]) {
      const value = object[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
      if (Array.isArray(value)) {
        const urls = value.map((item) => stringLike(item)).filter(Boolean);
        if (urls.length) {
          return urls.join(",");
        }
      }
    }
  }
  return undefined;
}

function canonicalMeetingId(value?: string) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length >= 9 && digits.length <= 15 ? digits : undefined;
}

function extractStartDetails(envelope: JsonObject): RtmsStartDetails | null {
  const event = stringLike(envelope.event) ?? "";
  const normalizedEvent = event.replace(/[.-]/g, "_");
  if (normalizedEvent !== "meeting_rtms_started" && normalizedEvent !== "meeting_rtms_start") {
    return null;
  }

  const objects = nestedObjects(envelope);
  const zoomMeetingId = canonicalMeetingId(pickString(objects, [
    "meeting_id",
    "meetingId",
    "meeting_number",
    "meetingNumber",
    "id"
  ]));
  const zoomMeetingUuid = pickString(objects, ["meeting_uuid", "meetingUuid", "uuid"]);
  const rtmsStreamId = pickString(objects, ["rtms_stream_id", "rtmsStreamId", "stream_id", "streamId"]);
  const serverUrls = pickServerUrls(objects);

  if (!zoomMeetingId || !zoomMeetingUuid || !rtmsStreamId || !serverUrls) {
    throw new Error("Zoom RTMS start webhook is missing meeting ID, UUID, stream ID, or server URLs.");
  }

  return {
    zoomMeetingId,
    zoomMeetingUuid,
    rtmsStreamId,
    serverUrls,
    rawEvent: event
  };
}

function extractStopDetails(envelope: JsonObject): RtmsStopDetails | null {
  const event = stringLike(envelope.event) ?? "";
  const normalizedEvent = event.replace(/[.-]/g, "_");
  if (normalizedEvent !== "meeting_rtms_stopped" && normalizedEvent !== "meeting_rtms_stop") {
    return null;
  }

  const objects = nestedObjects(envelope);
  return {
    zoomMeetingId: canonicalMeetingId(pickString(objects, [
      "meeting_id",
      "meetingId",
      "meeting_number",
      "meetingNumber",
      "id"
    ])),
    rtmsStreamId: pickString(objects, ["rtms_stream_id", "rtmsStreamId", "stream_id", "streamId"]),
    reason: pickString(objects, ["reason", "stop_reason", "stopReason"]),
    rawEvent: event
  };
}

function wavHeader(dataBytes: number) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(AUDIO_CHANNELS, 22);
  header.writeUInt32LE(AUDIO_SAMPLE_RATE, 24);
  header.writeUInt32LE(AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * PCM_BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(AUDIO_CHANNELS * PCM_BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

class PcmWavRecorder {
  readonly filePath: string;
  readonly startedAt = Date.now();
  private readonly stream;
  private stopped = false;
  private writtenBytes = 0;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.stream = createWriteStream(filePath);
    this.stream.write(Buffer.alloc(44));
  }

  get dataBytes() {
    return this.writtenBytes;
  }

  durationMs() {
    return Math.max(0, Date.now() - this.startedAt);
  }

  push(chunk: Buffer) {
    if (this.stopped || !chunk.length) {
      return;
    }
    this.stream.write(chunk);
    this.writtenBytes += chunk.byteLength;
  }

  async stop() {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.stream.end();
    await once(this.stream, "finish");
    const file = await open(this.filePath, "r+");
    try {
      await file.write(wavHeader(this.writtenBytes), 0, 44, 0);
    } finally {
      await file.close();
    }
  }
}

class RtmsSession {
  readonly callSessionId: string;
  private readonly captureId: string;
  private readonly details: RtmsStartDetails;
  private readonly tempDirPromise: Promise<string>;
  private client: any;
  private recorder: PcmWavRecorder | null = null;
  private mediaOriginTimestamp: number | null = null;
  private transcriptFingerprints = new Set<string>();
  private workQueue = Promise.resolve();
  private finishPromise: Promise<void> | null = null;

  constructor(details: RtmsStartDetails, claim: ZoomRtmsStartResult) {
    this.details = details;
    this.captureId = claim.captureId;
    this.callSessionId = claim.callSessionId;
    this.tempDirPromise = mkdtemp(join(tmpdir(), "sidetone-zoom-rtms-"));
  }

  async start() {
    const rtms = await loadRtms();
    const tempDir = await this.tempDirPromise;
    this.recorder = new PcmWavRecorder(join(tempDir, `${this.captureId}.wav`));
    this.client = new rtms.Client();

    this.client.onJoinConfirm((reason: number) => {
      log("zoom_rtms_join_confirmed", {
        captureId: this.captureId,
        callSessionId: this.callSessionId,
        rtmsStreamId: this.details.rtmsStreamId,
        reason
      });
    });

    this.client.onAudioData((buffer: Buffer, size: number) => {
      const chunk = Buffer.from(buffer.subarray(0, size));
      this.recorder?.push(chunk);
    });

    this.client.onTranscriptData((buffer: Buffer, size: number, timestamp: number, metadata: Metadata) => {
      this.handleTranscript(buffer, size, timestamp, metadata);
    });

    this.client.onLeave((reason: number) => {
      void this.finish(`sdk_leave_${reason}`).catch((error) => {
        log("zoom_rtms_finish_after_leave_failed", {
          captureId: this.captureId,
          callSessionId: this.callSessionId,
          error: safeError(error)
        });
      });
    });

    this.client.setAudioParams({
      contentType: rtms.AudioContentType.RAW_AUDIO,
      codec: rtms.AudioCodec.L16,
      sampleRate: rtms.AudioSampleRate.SR_16K,
      channel: rtms.AudioChannel.MONO,
      dataOpt: rtms.AudioDataOption.AUDIO_MIXED_STREAM,
      duration: 20,
      frameSize: 320
    });

    const joinParams: JoinParams = {
      meeting_uuid: this.details.zoomMeetingUuid,
      rtms_stream_id: this.details.rtmsStreamId,
      server_urls: this.details.serverUrls,
      client: ZOOM_RTMS_CLIENT_ID,
      secret: ZOOM_RTMS_CLIENT_SECRET,
      timeout: 30_000,
      pollInterval: 10
    };
    const joined = this.client.join(joinParams);
    if (!joined) {
      throw new Error("Zoom RTMS SDK refused the join request.");
    }

    log("zoom_rtms_session_started", {
      captureId: this.captureId,
      callSessionId: this.callSessionId,
      zoomMeetingId: this.details.zoomMeetingId,
      rtmsStreamId: this.details.rtmsStreamId
    });
  }

  finish(reason: string) {
    this.finishPromise ??= Promise.resolve().then(() => this.finishOnce(reason));
    return this.finishPromise;
  }

  private handleTranscript(buffer: Buffer, size: number, timestamp: number, metadata: Metadata) {
    const text = buffer.subarray(0, size).toString("utf8").replace(/\s+/g, " ").trim();
    if (!text) {
      return;
    }

    const speakerLabel = typeof metadata?.userName === "string" && metadata.userName.trim()
      ? metadata.userName.trim()
      : undefined;
    const startTs = Number.isFinite(metadata?.startTs) && metadata.startTs > 0 ? metadata.startTs : timestamp;
    const endTs = Number.isFinite(metadata?.endTs) && metadata.endTs > 0 ? metadata.endTs : timestamp;
    const startMs = this.relativeTimestampMs(startTs);
    const endMs = Math.max(startMs + 1, this.relativeTimestampMs(endTs));
    const fingerprint = `${Math.floor(startMs / 250)}:${speakerLabel ?? ""}:${text.toLowerCase()}`;
    if (this.transcriptFingerprints.has(fingerprint)) {
      return;
    }
    this.transcriptFingerprints.add(fingerprint);

    this.enqueue(async () => {
      const chars = Array.from(text);
      for (let offset = 0; offset < chars.length; offset += 1024) {
        const end = Math.min(chars.length, offset + 1024);
        await convexStep("zoom-rtms-transcript-segment", {
          callSessionId: this.callSessionId,
          text: chars.slice(offset, end).join(""),
          speakerLabel,
          startMs: startMs + (endMs - startMs) * offset / chars.length,
          endMs: startMs + (endMs - startMs) * end / chars.length,
          isFinal: true
        });
      }
    });
  }

  private relativeTimestampMs(timestamp: number) {
    const usableTimestamp = Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
    this.mediaOriginTimestamp ??= usableTimestamp;
    return Math.max(0, usableTimestamp - this.mediaOriginTimestamp);
  }

  private enqueue(work: () => Promise<void>) {
    this.workQueue = this.workQueue
      .then(work)
      .catch(async (error) => {
        log("zoom_rtms_async_step_failed", {
          captureId: this.captureId,
          callSessionId: this.callSessionId,
          error: safeError(error)
        });
        await convexStep("zoom-rtms-failed", {
          callSessionId: this.callSessionId,
          error: safeError(error)
        }).catch((failError) => {
          log("zoom_rtms_fail_step_failed", {
            captureId: this.captureId,
            callSessionId: this.callSessionId,
            error: safeError(failError)
          });
        });
      });
  }

  private async finishOnce(reason: string) {
    log("zoom_rtms_session_finishing", {
      captureId: this.captureId,
      callSessionId: this.callSessionId,
      reason
    });

    try {
      this.client?.leave?.();
    } catch (error) {
      log("zoom_rtms_leave_failed", {
        captureId: this.captureId,
        callSessionId: this.callSessionId,
        error: safeError(error)
      });
    }

    await this.workQueue;
    await this.uploadRecordingIfAvailable();
    await convexStep("zoom-rtms-stopped", {
      callSessionId: this.callSessionId,
      reason
    });

    activeSessionsByStream.delete(this.details.rtmsStreamId);
    activeSessionsByMeeting.delete(this.details.zoomMeetingId);
    await rm(await this.tempDirPromise, { recursive: true, force: true });
    log("zoom_rtms_session_finished", {
      captureId: this.captureId,
      callSessionId: this.callSessionId,
      reason
    });
  }

  private async uploadRecordingIfAvailable() {
    if (!this.recorder) {
      return;
    }

    await this.recorder.stop();
    if (this.recorder.dataBytes <= 0) {
      log("zoom_rtms_no_audio_recording", {
        captureId: this.captureId,
        callSessionId: this.callSessionId
      });
      return;
    }

    const info = await stat(this.recorder.filePath);
    const upload = await convexStep<{ uploadUrl?: string }>("zoom-rtms-generate-upload-url");
    if (!upload?.uploadUrl) {
      throw new Error("Convex did not return a Zoom RTMS upload URL.");
    }

    const storageResponse = await fetch(upload.uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": "audio/wav"
      },
      body: createReadStream(this.recorder.filePath) as unknown as BodyInit,
      duplex: "half"
    } as RequestInit & { duplex: "half" });
    const storagePayload = await storageResponse.json().catch(() => null) as { storageId?: string } | null;
    if (!storageResponse.ok || !storagePayload?.storageId) {
      throw new Error("Unable to upload Zoom RTMS recording to Convex storage.");
    }

    await convexStep("zoom-rtms-complete-recording", {
      callSessionId: this.callSessionId,
      storageId: storagePayload.storageId,
      recordingId: `zoom-rtms-${this.details.rtmsStreamId}`,
      fileName: `zoom-${this.details.zoomMeetingId}-${this.captureId}.wav`,
      mimeType: "audio/wav",
      sizeBytes: info.size,
      format: "wav",
      recordingStartedAt: this.recorder.startedAt,
      recordingEndedAt: Date.now(),
      durationMs: this.recorder.durationMs()
    });

    log("zoom_rtms_recording_uploaded", {
      captureId: this.captureId,
      callSessionId: this.callSessionId,
      sizeBytes: info.size
    });
  }
}

async function handleStart(details: RtmsStartDetails) {
  if (activeSessionsByStream.has(details.rtmsStreamId)) {
    log("zoom_rtms_duplicate_start_ignored", {
      zoomMeetingId: details.zoomMeetingId,
      rtmsStreamId: details.rtmsStreamId
    });
    return { ignored: true, reason: "duplicate_stream" };
  }

  let claim: ZoomRtmsStartResult;
  try {
    claim = await convexStep<ZoomRtmsStartResult>("zoom-rtms-started", {
      zoomMeetingId: details.zoomMeetingId,
      zoomMeetingUuid: details.zoomMeetingUuid,
      rtmsStreamId: details.rtmsStreamId,
      serverUrls: details.serverUrls
    });
  } catch (error) {
    log("zoom_rtms_start_without_pending_capture", {
      zoomMeetingId: details.zoomMeetingId,
      rtmsStreamId: details.rtmsStreamId,
      error: safeError(error)
    });
    return { ignored: true, reason: "no_pending_capture" };
  }

  const existingMeetingSession = activeSessionsByMeeting.get(details.zoomMeetingId);
  if (existingMeetingSession) {
    await existingMeetingSession.finish("superseded_by_new_stream").catch((error) => {
      log("zoom_rtms_previous_session_finish_failed", {
        zoomMeetingId: details.zoomMeetingId,
        error: safeError(error)
      });
    });
  }

  const session = new RtmsSession(details, claim);
  activeSessionsByStream.set(details.rtmsStreamId, session);
  activeSessionsByMeeting.set(details.zoomMeetingId, session);

  try {
    await session.start();
  } catch (error) {
    activeSessionsByStream.delete(details.rtmsStreamId);
    activeSessionsByMeeting.delete(details.zoomMeetingId);
    await convexStep("zoom-rtms-failed", {
      callSessionId: claim.callSessionId,
      error: safeError(error)
    }).catch((failError) => {
      log("zoom_rtms_start_fail_step_failed", {
        callSessionId: claim.callSessionId,
        error: safeError(failError)
      });
    });
    throw error;
  }

  return {
    captureId: claim.captureId,
    callSessionId: claim.callSessionId,
    rtmsStreamId: details.rtmsStreamId
  };
}

async function handleStop(details: RtmsStopDetails) {
  const session = details.rtmsStreamId
    ? activeSessionsByStream.get(details.rtmsStreamId)
    : details.zoomMeetingId
      ? activeSessionsByMeeting.get(details.zoomMeetingId)
      : undefined;

  if (!session) {
    log("zoom_rtms_stop_without_active_session", {
      zoomMeetingId: details.zoomMeetingId,
      rtmsStreamId: details.rtmsStreamId,
      reason: details.reason
    });
    return { ignored: true, reason: "no_active_session" };
  }

  await session.finish(details.reason ?? "zoom_rtms_stopped");
  return { callSessionId: session.callSessionId };
}

async function handleZoomWebhook(req: IncomingMessage, res: ServerResponse) {
  const rawBody = await readRawBody(req);
  if (!verifyZoomSignature(req, rawBody)) {
    json(res, 401, { error: "Invalid Zoom signature." });
    return;
  }

  let envelope: JsonObject;
  try {
    envelope = JSON.parse(rawBody.toString("utf8")) as JsonObject;
  } catch {
    json(res, 400, { error: "Invalid JSON." });
    return;
  }

  if (envelope.event === "endpoint.url_validation") {
    const response = urlValidationResponse(envelope);
    if (!response) {
      json(res, 400, { error: "Invalid Zoom validation payload." });
      return;
    }
    json(res, 200, response);
    return;
  }

  try {
    const startDetails = extractStartDetails(envelope);
    if (startDetails) {
      const result = await handleStart(startDetails);
      json(res, 200, { ok: true, result });
      return;
    }

    const stopDetails = extractStopDetails(envelope);
    if (stopDetails) {
      const result = await handleStop(stopDetails);
      json(res, 200, { ok: true, result });
      return;
    }

    log("zoom_rtms_webhook_ignored", {
      event: stringLike(envelope.event) ?? "unknown"
    });
    json(res, 200, { ok: true, ignored: true });
  } catch (error) {
    log("zoom_rtms_webhook_failed", {
      event: stringLike(envelope.event) ?? "unknown",
      error: safeError(error)
    });
    json(res, 500, { error: safeError(error) });
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, {
      ok: true,
      service: "sidetone-zoom-rtms",
      workerSessionId,
      activeSessions: activeSessionsByStream.size
    });
    return;
  }

  if (req.method === "POST" && url.pathname === WEBHOOK_PATH) {
    void handleZoomWebhook(req, res).catch((error) => {
      log("zoom_rtms_unhandled_webhook_error", { error: safeError(error) });
      if (!res.headersSent) {
        json(res, 500, { error: "Zoom RTMS webhook failed." });
      } else {
        res.end();
      }
    });
    return;
  }

  json(res, 404, { error: "Not found." });
});

async function shutdown(signal: string) {
  log("zoom_rtms_worker_shutdown_started", {
    signal,
    activeSessions: activeSessionsByStream.size
  });
  server.close();
  await Promise.all(Array.from(activeSessionsByStream.values()).map((session) =>
    session.finish(`worker_${signal.toLowerCase()}`).catch((error) => {
      log("zoom_rtms_shutdown_session_failed", {
        callSessionId: session.callSessionId,
        error: safeError(error)
      });
    })
  ));
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

server.listen(PORT, () => {
  log("zoom_rtms_worker_listening", {
    port: PORT,
    webhookPath: WEBHOOK_PATH
  });
});
