import { createPublicKey, verify as verifySignature } from "node:crypto";

type TelnyxMethod = "GET" | "POST" | "PATCH";

type TelnyxNumberRecord = {
  id: string;
  phone_number: string;
  locality?: string;
  administrative_area?: string;
  region_information?: Array<{
    region_name?: string;
    region_type?: string;
  }>;
  cost_information?: {
    monthly_cost?: string;
    upfront_cost?: string;
  };
};

type TelnyxCallResponse = {
  data: {
    call_control_id?: string;
    call_leg_id?: string;
    call_session_id?: string;
    client_state?: string;
  };
};

type TelnyxLegRole = "owner" | "external";

type TelnyxConferenceResponse = {
  data: {
    id?: string;
  };
};

type TelnyxCallControlApplicationResponse = {
  data: {
    id: string;
    application_name?: string;
    outbound?: {
      channel_limit?: number | null;
      outbound_voice_profile_id?: string | null;
    };
    webhook_event_url?: string | null;
  };
};

type TelnyxCallRecording = {
  id?: string;
  recording_id?: string;
  format?: string;
  channels?: string;
  started_at?: string;
  ended_at?: string;
  duration_millis?: number;
  duration_secs?: number;
  status?: string;
  recording_urls?: {
    mp3?: string;
    wav?: string;
  };
  public_recording_urls?: {
    mp3?: string;
    wav?: string;
  };
};

type TelnyxRecordingResponse = {
  data: {
    id: string;
    download_urls?: {
      mp3?: string;
      wav?: string;
    };
    recording_urls?: {
      mp3?: string;
      wav?: string;
    };
    public_recording_urls?: {
      mp3?: string;
      wav?: string;
    };
  };
};

type TelnyxCallRecordingsResponse = {
  data?: Array<TelnyxCallRecording>;
};

type TelnyxCallRecordingResult = {
  recordingId: string;
  status?: string;
  format?: "mp3" | "wav";
  channels?: "single" | "dual";
  recordingUrls?: {
    mp3?: string;
    wav?: string;
  };
  publicRecordingUrls?: {
    mp3?: string;
    wav?: string;
  };
  recordingStartedAt?: number;
  recordingEndedAt?: number;
  durationMs?: number;
};

export type SidetoneAvailableNumber = {
  phoneNumber: string;
  locality?: string;
  region?: string;
  monthlyCost?: string;
  upfrontCost?: string;
};

const TELNYX_BASE_URL = "https://api.telnyx.com/v2";

export class TelnyxConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelnyxConfigurationError";
  }
}

export class TelnyxRequestError extends Error {
  status?: number;
  responseBody?: unknown;

  constructor(message: string, options?: { status?: number; responseBody?: unknown }) {
    super(message);
    this.name = "TelnyxRequestError";
    this.status = options?.status;
    this.responseBody = options?.responseBody;
  }
}

function env(name: string) {
  return process.env[name]?.trim() || undefined;
}

function requireEnv(name: string) {
  const value = env(name);
  if (!value) {
    throw new TelnyxConfigurationError(`Missing required environment variable: ${name}`);
  }

  return value;
}

function decodeTelnyxPublicKey(publicKey: string) {
  const normalized = publicKey.trim();
  const raw = /^[0-9a-f]+$/i.test(normalized)
    ? Buffer.from(normalized, "hex")
    : Buffer.from(normalized, "base64");

  if (raw.length !== 32) {
    throw new TelnyxConfigurationError("TELNYX_PUBLIC_KEY must decode to a 32-byte Ed25519 public key.");
  }

  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  return createPublicKey({
    key: Buffer.concat([spkiPrefix, raw]),
    format: "der",
    type: "spki"
  });
}

export function verifyTelnyxWebhookSignature({
  headers,
  rawBody
}: {
  headers: Headers;
  rawBody: string;
}) {
  const publicKey = env("TELNYX_PUBLIC_KEY");
  if (!publicKey) {
    return process.env.NODE_ENV !== "production";
  }

  const signature = headers.get("telnyx-signature-ed25519");
  const timestamp = headers.get("telnyx-timestamp");
  if (!signature || !timestamp) {
    return false;
  }

  const timestampMs = Number(timestamp) * 1000;
  if (Number.isFinite(timestampMs)) {
    const ageMs = Math.abs(Date.now() - timestampMs);
    if (ageMs > 5 * 60 * 1000) {
      return false;
    }
  }

  const message = Buffer.from(`${timestamp}|${rawBody}`, "utf8");
  const signatureBytes = Buffer.from(signature, "base64");
  return verifySignature(null, message, decodeTelnyxPublicKey(publicKey), signatureBytes);
}

export function resolvePublicBaseUrl() {
  return env("SIDETONE_PUBLIC_BASE_URL") ?? env("TELNYX_PUBLIC_BASE_URL") ?? env("NEXT_PUBLIC_APP_URL") ?? null;
}

export function resolveCallControlWebhookUrl() {
  return env("TELNYX_CALL_CONTROL_WEBHOOK_URL")
    ?? (resolvePublicBaseUrl() ? `${resolvePublicBaseUrl()!.replace(/\/$/, "")}/api/telnyx/call-control` : null);
}

function withStreamSecret(url: string) {
  const secret = env("SIDETONE_STREAM_SHARED_SECRET");
  if (!secret) {
    return url;
  }

  const parsed = new URL(url);
  if (!parsed.searchParams.has("sidetone_token")) {
    parsed.searchParams.set("sidetone_token", secret);
  }
  return parsed.toString();
}

function toWebSocketUrl(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol === "https:") {
    parsed.protocol = "wss:";
  } else if (parsed.protocol === "http:") {
    parsed.protocol = "ws:";
  }
  return parsed.toString();
}

export function resolveMediaStreamUrl() {
  const explicit = env("TELNYX_MEDIA_STREAM_URL");
  if (explicit) {
    return withStreamSecret(toWebSocketUrl(explicit));
  }

  const realtimeUrl = env("SIDETONE_REALTIME_URL");
  return realtimeUrl ? withStreamSecret(toWebSocketUrl(`${realtimeUrl.replace(/\/$/, "")}/telnyx/media-stream`)) : null;
}

export function telnyxConfigSummary() {
  const mediaStreamUrl = resolveMediaStreamUrl();
  return {
    hasApiKey: Boolean(env("TELNYX_API_KEY")),
    publicKeyConfigured: Boolean(env("TELNYX_PUBLIC_KEY")),
    callControlConnectionId: env("TELNYX_CALL_CONTROL_CONNECTION_ID") ?? null,
    publicBaseUrl: resolvePublicBaseUrl(),
    callControlWebhookUrl: resolveCallControlWebhookUrl(),
    mediaStreamUrl: mediaStreamUrl ? mediaStreamUrl.replace(/([?&]sidetone_token=)[^&]+/, "$1redacted") : null
  };
}

export async function getCallControlApplicationStatus() {
  const connectionId = env("TELNYX_CALL_CONTROL_CONNECTION_ID");
  if (!connectionId || !env("TELNYX_API_KEY")) {
    return null;
  }

  const response = await telnyxRequest<TelnyxCallControlApplicationResponse>(
    "GET",
    `/call_control_applications/${connectionId}`
  );

  return {
    id: response.data.id,
    name: response.data.application_name,
    outboundVoiceProfileId: response.data.outbound?.outbound_voice_profile_id ?? null,
    webhookEventUrl: response.data.webhook_event_url ?? null
  };
}

export function friendlyCallThroughFailure(error: unknown) {
  if (
    error instanceof TelnyxRequestError
    && /Outbound Profile assigned/i.test(error.message)
  ) {
    return "Outbound calling is not enabled for this Sidetone number yet. Attach an outbound voice profile to the Telnyx Call Control application, then try again.";
  }

  return error instanceof Error ? error.message : "Unable to start call.";
}

async function telnyxRequest<T>(
  method: TelnyxMethod,
  resourcePath: string,
  options: { body?: unknown } = {}
): Promise<T> {
  const response = await fetch(
    resourcePath.startsWith("http")
      ? resourcePath
      : `${TELNYX_BASE_URL}${resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${requireEnv("TELNYX_API_KEY")}`,
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {})
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store"
    }
  );

  const contentType = response.headers.get("content-type") ?? "";
  const responseBody = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const detail = telnyxErrorDetail(responseBody) || response.statusText;

    throw new TelnyxRequestError(
      `Telnyx API ${method} ${resourcePath} failed (${response.status}): ${detail || "Unknown error"}`,
      {
        status: response.status,
        responseBody
      }
    );
  }

  return responseBody as T;
}

function telnyxErrorDetail(responseBody: unknown) {
  if (!responseBody || typeof responseBody !== "object") {
    return "";
  }

  const errors = (responseBody as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return "";
  }

  return errors
    .map((error: any) => {
      const source = error?.source?.pointer ?? error?.source?.parameter;
      return [
        error?.detail,
        error?.title,
        error?.code,
        source ? `at ${source}` : null
      ].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join("; ");
}

function normalizeAreaCode(areaCode: string) {
  const digits = areaCode.replace(/\D/g, "");
  if (digits.length !== 3) {
    throw new Error("Area code must be three digits.");
  }
  return digits;
}

function mapAvailableNumber(record: TelnyxNumberRecord): SidetoneAvailableNumber {
  const regionInformation = record.region_information?.find((item) => item.region_type === "rate_center");
  return {
    phoneNumber: record.phone_number,
    locality: record.locality,
    region: record.administrative_area ?? regionInformation?.region_name,
    monthlyCost: record.cost_information?.monthly_cost,
    upfrontCost: record.cost_information?.upfront_cost
  };
}

function queryString(input: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

function encodeTelnyxClientState(input: { callSessionId: string; legRole?: TelnyxLegRole }) {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64");
}

function mediaStreamRequestFields(callSessionId: string) {
  const streamUrl = resolveMediaStreamUrl();
  if (!streamUrl) {
    return {};
  }

  const parsedStreamUrl = new URL(streamUrl);
  parsedStreamUrl.searchParams.set("sidetone_call_session_id", callSessionId);

  return {
    stream_url: parsedStreamUrl.toString(),
    stream_track: "both_tracks",
    stream_codec: "PCMU"
  };
}

export async function searchAvailableLocalNumbers(areaCode: string, limit = 8) {
  const normalizedAreaCode = normalizeAreaCode(areaCode);
  const params = new URLSearchParams();
  params.set("filter[country_code]", "US");
  params.set("filter[phone_number_type]", "local");
  params.set("filter[best_effort]", "true");
  params.set("filter[limit]", String(limit));
  params.set("filter[national_destination_code]", normalizedAreaCode);
  params.append("filter[features][]", "voice");

  const response = await telnyxRequest<{ data: TelnyxNumberRecord[] }>(
    "GET",
    `/available_phone_numbers?${params.toString()}`
  );

  return response.data.map(mapAvailableNumber);
}

async function findOwnedNumber(phoneNumber: string) {
  const response = await telnyxRequest<{ data: TelnyxNumberRecord[] }>(
    "GET",
    `/phone_numbers?${queryString({ "filter[phone_number]": phoneNumber })}`
  );

  return response.data.find((record) => record.phone_number === phoneNumber) ?? null;
}

async function waitForOwnedNumber(phoneNumber: string) {
  let lastResult: TelnyxNumberRecord | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    lastResult = await findOwnedNumber(phoneNumber);
    if (lastResult) {
      return lastResult;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return lastResult;
}

async function attachCallControlConnection(numberId: string) {
  const connectionId = requireEnv("TELNYX_CALL_CONTROL_CONNECTION_ID");
  await telnyxRequest("PATCH", `/phone_numbers/${numberId}`, {
    body: {
      connection_id: connectionId
    }
  });
  return connectionId;
}

async function attachMessagingProfile(numberId: string) {
  const messagingProfileId = env("TELNYX_MESSAGING_PROFILE_ID");
  if (!messagingProfileId) {
    return undefined;
  }

  await telnyxRequest("PATCH", `/phone_numbers/${numberId}/messaging`, {
    body: {
      messaging_profile_id: messagingProfileId
    }
  });

  return messagingProfileId;
}

export async function provisionTelnyxLocalNumber(input: {
  areaCode: string;
  phoneNumber: string;
}) {
  const normalizedAreaCode = normalizeAreaCode(input.areaCode);
  const connectionId = requireEnv("TELNYX_CALL_CONTROL_CONNECTION_ID");
  const messagingProfileId = env("TELNYX_MESSAGING_PROFILE_ID");

  const alreadyOwnedNumber = await findOwnedNumber(input.phoneNumber);
  if (alreadyOwnedNumber) {
    const attachedConnectionId = await attachCallControlConnection(alreadyOwnedNumber.id);
    const attachedMessagingProfileId = await attachMessagingProfile(alreadyOwnedNumber.id);
    return {
      areaCode: normalizedAreaCode,
      phoneNumber: input.phoneNumber,
      orderId: null,
      telnyxPhoneNumberId: alreadyOwnedNumber.id,
      connectionId: attachedConnectionId,
      messagingProfileId: attachedMessagingProfileId,
      callControlWebhookUrl: resolveCallControlWebhookUrl(),
      mediaStreamUrl: resolveMediaStreamUrl()
    };
  }

  let orderResponse: { data: { id: string } };
  try {
    orderResponse = await telnyxRequest<{ data: { id: string } }>("POST", "/number_orders", {
      body: {
        phone_numbers: [{ phone_number: input.phoneNumber }],
        connection_id: connectionId,
        ...(messagingProfileId ? { messaging_profile_id: messagingProfileId } : {}),
        customer_reference: `sidetone-${normalizedAreaCode}-${Date.now()}`
      }
    });
  } catch (error) {
    const ownedNumberAfterFailure = await findOwnedNumber(input.phoneNumber).catch(() => null);
    if (ownedNumberAfterFailure) {
      const attachedConnectionId = await attachCallControlConnection(ownedNumberAfterFailure.id);
      const attachedMessagingProfileId = await attachMessagingProfile(ownedNumberAfterFailure.id);
      return {
        areaCode: normalizedAreaCode,
        phoneNumber: input.phoneNumber,
        orderId: null,
        telnyxPhoneNumberId: ownedNumberAfterFailure.id,
        connectionId: attachedConnectionId,
        messagingProfileId: attachedMessagingProfileId,
        callControlWebhookUrl: resolveCallControlWebhookUrl(),
        mediaStreamUrl: resolveMediaStreamUrl()
      };
    }

    if (error instanceof TelnyxRequestError && error.status === 422) {
      throw new TelnyxRequestError(
        `${error.message} Pick a fresh number and try again. If this keeps happening, the Telnyx account may require a requirement group, billing group, or different number type for this order.`,
        {
          status: error.status,
          responseBody: error.responseBody
        }
      );
    }

    throw error;
  }

  const ownedNumber = await waitForOwnedNumber(input.phoneNumber);
  if (!ownedNumber) {
    throw new TelnyxRequestError("Number order succeeded but the purchased number was not found in inventory.");
  }

  const attachedConnectionId = await attachCallControlConnection(ownedNumber.id);
  const attachedMessagingProfileId = await attachMessagingProfile(ownedNumber.id);

  return {
    areaCode: normalizedAreaCode,
    phoneNumber: input.phoneNumber,
    orderId: orderResponse.data.id,
    telnyxPhoneNumberId: ownedNumber.id,
    connectionId: attachedConnectionId,
    messagingProfileId: attachedMessagingProfileId,
    callControlWebhookUrl: resolveCallControlWebhookUrl(),
    mediaStreamUrl: resolveMediaStreamUrl()
  };
}

export async function startCallThrough(input: {
  fromPhoneNumber: string;
  toPhoneNumber: string;
  callSessionId: string;
  legRole?: TelnyxLegRole;
  timeoutSecs?: number;
  answeringMachineDetection?: "premium" | "detect" | "detect_beep" | "detect_words" | "greeting_end";
}) {
  const webhookUrl = resolveCallControlWebhookUrl();
  if (!webhookUrl) {
    throw new TelnyxConfigurationError("Set SIDETONE_PUBLIC_BASE_URL or TELNYX_CALL_CONTROL_WEBHOOK_URL before starting calls.");
  }

  const response = await telnyxRequest<TelnyxCallResponse>("POST", "/calls", {
    body: {
      connection_id: requireEnv("TELNYX_CALL_CONTROL_CONNECTION_ID"),
      from: input.fromPhoneNumber,
      to: input.toPhoneNumber,
      webhook_url: webhookUrl,
      client_state: encodeTelnyxClientState({
        callSessionId: input.callSessionId,
        legRole: input.legRole
      }),
      timeout_secs: input.timeoutSecs ?? 45,
      answering_machine_detection: input.answeringMachineDetection,
      send_silence_when_idle: true,
      ...mediaStreamRequestFields(input.callSessionId)
    }
  });

  return {
    callControlId: response.data.call_control_id,
    callSessionId: response.data.call_session_id
  };
}

export async function startMediaStreaming(input: {
  callControlId: string;
  callSessionId: string;
}) {
  const mediaStreamUrl = resolveMediaStreamUrl();
  if (!mediaStreamUrl) {
    return { started: false, reason: "Media stream URL is not configured." };
  }

  const parsedMediaStreamUrl = new URL(mediaStreamUrl);
  parsedMediaStreamUrl.searchParams.set("sidetone_call_session_id", input.callSessionId);

  await telnyxRequest("POST", `/calls/${input.callControlId}/actions/streaming_start`, {
    body: {
      stream_url: parsedMediaStreamUrl.toString(),
      stream_track: "both_tracks",
      stream_codec: "PCMU",
      custom_parameters: [
        {
          name: "callSessionId",
          value: input.callSessionId
        }
      ],
      client_state: encodeTelnyxClientState({ callSessionId: input.callSessionId })
    }
  });

  return { started: true, mediaStreamUrl };
}

export async function stopMediaStreaming(input: { callControlId: string }) {
  await telnyxRequest("POST", `/calls/${input.callControlId}/actions/streaming_stop`);
}

export async function startCallRecording(input: {
  callControlId: string;
  callSessionId: string;
}) {
  await telnyxRequest("POST", `/calls/${input.callControlId}/actions/record_start`, {
    body: {
      format: "mp3",
      channels: "single",
      client_state: encodeTelnyxClientState({ callSessionId: input.callSessionId }),
      command_id: `sidetone-record-${input.callSessionId}`
    }
  });
}

export async function getCallRecordingDownloadUrl(input: {
  recordingId: string;
  format?: "mp3" | "wav";
}) {
  const format = input.format ?? "mp3";
  const response = await telnyxRequest<TelnyxRecordingResponse>(
    "GET",
    `/recordings/${input.recordingId}`
  );

  return response.data.download_urls?.[format]
    ?? response.data.recording_urls?.[format]
    ?? response.data.public_recording_urls?.[format]
    ?? null;
}

export async function listCallRecordings(input: {
  callControlId: string;
}): Promise<TelnyxCallRecordingResult[]> {
  const response = await telnyxRequest<TelnyxCallRecordingsResponse>(
    "GET",
    `/calls/${input.callControlId}/recordings`
  );

  const recordings = Array.isArray(response?.data)
    ? response.data
    : Array.isArray((response as { recordings?: Array<TelnyxCallRecording> }).recordings)
      ? (response as { recordings: Array<TelnyxCallRecording> }).recordings
      : [];

      const normalized = recordings
    .map((recording): TelnyxCallRecordingResult | null => {
      const recordingId = recording?.recording_id ?? recording?.id;
      if (!recordingId || typeof recordingId !== "string") {
        return null;
      }
      return {
        recordingId,
        status: recording.status,
        format: recording.format === "wav" ? "wav" : recording.format === "mp3" ? "mp3" : undefined,
        channels: recording.channels === "dual" ? "dual" : recording.channels === "single" ? "single" : undefined,
        recordingUrls: recording.recording_urls,
        publicRecordingUrls: recording.public_recording_urls,
        recordingStartedAt: Number.isFinite(Date.parse(String(recording.started_at || "")))
          ? Date.parse(String(recording.started_at))
          : undefined,
        recordingEndedAt: Number.isFinite(Date.parse(String(recording.ended_at || "")))
          ? Date.parse(String(recording.ended_at))
          : undefined,
        durationMs: typeof recording.duration_millis === "number"
          ? recording.duration_millis
          : typeof recording.duration_secs === "number"
            ? recording.duration_secs * 1000
            : undefined
      };
  });

  return normalized.filter((item): item is TelnyxCallRecordingResult => item !== null);
}

export async function hangupCall(input: { callControlId: string }) {
  await telnyxRequest("POST", `/calls/${input.callControlId}/actions/hangup`);
}

export async function sendTelnyxSms(input: {
  fromPhoneNumber: string;
  toPhoneNumber: string;
  text: string;
  messagingProfileId?: string;
}) {
  const body: Record<string, string> = {
    from: input.fromPhoneNumber,
    to: input.toPhoneNumber,
    text: input.text
  };
  const messagingProfileId = input.messagingProfileId ?? env("TELNYX_MESSAGING_PROFILE_ID");
  if (messagingProfileId) {
    body.messaging_profile_id = messagingProfileId;
  }

  const response = await telnyxRequest<{ data?: { id?: string } }>("POST", "/messages", { body });
  return {
    providerMessageId: response.data?.id
  };
}

export async function answerCall(input: { callControlId: string; callSessionId: string }) {
  await telnyxRequest("POST", `/calls/${input.callControlId}/actions/answer`, {
    body: {
      client_state: encodeTelnyxClientState({ callSessionId: input.callSessionId }),
      send_silence_when_idle: true,
      ...mediaStreamRequestFields(input.callSessionId)
    }
  });
}

function publicAssetUrl(path: string) {
  const baseUrl = resolvePublicBaseUrl();
  if (!baseUrl) {
    return null;
  }

  return new URL(path, `${baseUrl.replace(/\/$/, "")}/`).toString();
}

function promptAudioUrl(envName: string, defaultPath: string) {
  const explicit = env(envName);
  if (explicit) {
    return { url: explicit, checkAvailability: false };
  }

  const url = publicAssetUrl(defaultPath);
  return url ? { url, checkAvailability: true } : null;
}

async function audioUrlIsAvailable(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function playAudioUrl(input: {
  callControlId: string;
  callSessionId: string;
  audioUrl: string;
  commandId: string;
}) {
  await telnyxRequest("POST", `/calls/${input.callControlId}/actions/playback_start`, {
    body: {
      audio_url: input.audioUrl,
      audio_type: input.audioUrl.toLowerCase().includes(".wav") ? "wav" : "mp3",
      cache_audio: true,
      client_state: encodeTelnyxClientState({ callSessionId: input.callSessionId }),
      command_id: input.commandId,
      loop: 1,
      overlay: false,
      target_legs: "self"
    }
  });
}

async function tryPlayPromptAudio(input: {
  callControlId: string;
  callSessionId: string;
  envName: string;
  defaultPath: string;
  commandName: string;
}) {
  const audio = promptAudioUrl(input.envName, input.defaultPath);
  if (!audio) {
    return false;
  }
  if (audio.checkAvailability && !(await audioUrlIsAvailable(audio.url))) {
    return false;
  }

  await playAudioUrl({
    callControlId: input.callControlId,
    callSessionId: input.callSessionId,
    audioUrl: audio.url,
    commandId: `${input.commandName}-${input.callSessionId}`
  });
  return true;
}

export async function speakDisclosure(input: { callControlId: string; callSessionId: string }) {
  try {
    const played = await tryPlayPromptAudio({
      callControlId: input.callControlId,
      callSessionId: input.callSessionId,
      envName: "SIDETONE_DISCLOSURE_AUDIO_URL",
      defaultPath: "/audio/sidetone-disclosure.mp3",
      commandName: "sidetone-disclosure"
    });
    if (played) {
      return;
    }
  } catch (error) {
    console.warn("Unable to play Sidetone disclosure audio. Falling back to Telnyx speech.", error);
  }

  const text = env("SIDETONE_DISCLOSURE_TEXT") ?? "This call is being recorded and transcribed by Sidetone.";
  await telnyxRequest("POST", `/calls/${input.callControlId}/actions/speak`, {
    body: {
      payload: text,
      voice: env("SIDETONE_DISCLOSURE_VOICE") ?? "female",
      language: env("SIDETONE_DISCLOSURE_LANGUAGE") ?? "en-US",
      client_state: encodeTelnyxClientState({ callSessionId: input.callSessionId })
    }
  });
}

export async function speakFirstCallOnboarding(input: {
  callControlId: string;
  callSessionId: string;
  includeDisclosure: boolean;
}) {
  const audioEnvName = input.includeDisclosure
    ? "SIDETONE_FIRST_CALL_PROMPT_AUDIO_URL"
    : "SIDETONE_FIRST_CALL_PROMPT_NO_DISCLOSURE_AUDIO_URL";
  const defaultAudioPath = input.includeDisclosure
    ? "/audio/sidetone-first-call-onboarding.mp3"
    : "/audio/sidetone-first-call-onboarding-no-disclosure.mp3";

  try {
    const played = await tryPlayPromptAudio({
      callControlId: input.callControlId,
      callSessionId: input.callSessionId,
      envName: audioEnvName,
      defaultPath: defaultAudioPath,
      commandName: input.includeDisclosure
        ? "sidetone-first-call-onboarding"
        : "sidetone-first-call-onboarding-no-disclosure"
    });
    if (played) {
      return;
    }
  } catch (error) {
    console.warn("Unable to play Sidetone first-call audio. Falling back to Telnyx speech.", error);
  }

  const defaultText = [
    "Welcome to Sidetone.",
    input.includeDisclosure ? "This call is being recorded and transcribed by Sidetone." : undefined,
    "Keep this call open.",
    "In your phone app, tap Add Call, call the person you want to speak with, then tap Merge Calls.",
    "Once the calls are merged, Sidetone will listen and start taking notes."
  ].filter(Boolean).join(" ");
  const text = env("SIDETONE_FIRST_CALL_PROMPT_TEXT") ?? defaultText;

  await telnyxRequest("POST", `/calls/${input.callControlId}/actions/speak`, {
    body: {
      payload: text,
      voice: env("SIDETONE_ONBOARDING_VOICE") ?? env("SIDETONE_DISCLOSURE_VOICE") ?? "female",
      language: env("SIDETONE_ONBOARDING_LANGUAGE") ?? env("SIDETONE_DISCLOSURE_LANGUAGE") ?? "en-US",
      client_state: encodeTelnyxClientState({ callSessionId: input.callSessionId })
    }
  });
}

export async function speakCallStatus(input: { callControlId: string; callSessionId: string; message: string }) {
  await telnyxRequest("POST", `/calls/${input.callControlId}/actions/speak`, {
    body: {
      payload: input.message,
      voice: env("SIDETONE_DISCLOSURE_VOICE") ?? "female",
      language: env("SIDETONE_DISCLOSURE_LANGUAGE") ?? "en-US",
      client_state: encodeTelnyxClientState({ callSessionId: input.callSessionId })
    }
  });
}

export async function createConferenceForCall(input: { callControlId: string; callSessionId: string }) {
  const response = await telnyxRequest<TelnyxConferenceResponse>("POST", "/conferences", {
    body: {
      call_control_id: input.callControlId,
      name: `sidetone-${input.callSessionId}`,
      beep_enabled: "never",
      comfort_noise: false,
      duration_minutes: 240,
      client_state: encodeTelnyxClientState({ callSessionId: input.callSessionId })
    }
  });

  return {
    conferenceId: response.data.id
  };
}

export async function joinConferenceForCall(input: {
  conferenceId: string;
  callControlId: string;
  callSessionId: string;
  legRole?: TelnyxLegRole;
}) {
  await telnyxRequest("POST", `/conferences/${input.conferenceId}/actions/join`, {
    body: {
      call_control_id: input.callControlId,
      beep_enabled: "never",
      client_state: encodeTelnyxClientState({
        callSessionId: input.callSessionId,
        legRole: input.legRole
      })
    }
  });
}

export function callSessionIdFromClientState(clientState?: string | null) {
  if (!clientState) {
    return null;
  }

  for (const encoding of ["base64", "base64url"] as const) {
    try {
      const decoded = Buffer.from(clientState, encoding).toString("utf8");
      const parsed = JSON.parse(decoded) as { callSessionId?: string };
      if (parsed.callSessionId) {
        return parsed.callSessionId;
      }
    } catch {
      // Try the next supported encoding.
    }
  }

  return null;
}

export function callLegRoleFromClientState(clientState?: string | null): TelnyxLegRole | null {
  if (!clientState) {
    return null;
  }

  for (const encoding of ["base64", "base64url"] as const) {
    try {
      const decoded = Buffer.from(clientState, encoding).toString("utf8");
      const parsed = JSON.parse(decoded) as { legRole?: string };
      if (parsed.legRole === "owner" || parsed.legRole === "external") {
        return parsed.legRole;
      }
    } catch {
      // Try the next supported encoding.
    }
  }

  return null;
}
