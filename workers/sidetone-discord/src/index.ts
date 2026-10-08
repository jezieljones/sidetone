import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  type VoiceBasedChannel
} from "discord.js";
import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel
} from "@discordjs/voice";
import prism from "prism-media";

type ClaimedCapture = {
  _id: string;
  callSessionId?: string;
  discordGuildId: string;
  discordGuildName?: string;
  discordStartedByUserId: string;
};

type CaptureState = {
  status: "queued" | "joining" | "recording" | "processing" | "ready" | "failed" | "stopped";
  stoppedAt?: number;
  updatedAt?: number;
};

type CaptureFile = {
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number;
  cleanup?: () => Promise<void>;
};

const workerSessionId = randomUUID();

function env(name: string, fallback?: string) {
  const value = process.env[name]?.trim() || fallback;
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

const DISCORD_BOT_TOKEN = env("DISCORD_BOT_TOKEN");
const CONVEX_SITE_URL = env("CONVEX_SITE_URL", process.env.NEXT_PUBLIC_CONVEX_SITE_URL).replace(/\/+$/, "");
const SIDETONE_WORKER_TOKEN = env("SIDETONE_WORKER_TOKEN");
const SIDETONE_APP_URL = env("SIDETONE_APP_URL", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const CAPTURE_FIXTURE_PATH = process.env.DISCORD_CAPTURE_FIXTURE_PATH?.trim();
const CAPTURE_MAX_MS = envInt("DISCORD_CAPTURE_MAX_MS", 60_000);
const EMPTY_CHANNEL_GRACE_MS = envInt("DISCORD_EMPTY_CHANNEL_GRACE_MS", 15_000);

const OPUS_SAMPLE_RATE = 48_000;
const OPUS_CHANNELS = 2;
const FRAME_DURATION_MS = 20;
const FRAME_SAMPLES = OPUS_SAMPLE_RATE / (1000 / FRAME_DURATION_MS);
const PCM_BYTES_PER_SAMPLE = 2;
const PCM_FRAME_BYTES = FRAME_SAMPLES * OPUS_CHANNELS * PCM_BYTES_PER_SAMPLE;
const DISCORD_API_BASE_URL = "https://discord.com/api/v10";

function log(message: string, metadata?: Record<string, unknown>) {
  console.log(JSON.stringify({
    service: "sidetone-discord",
    workerSessionId,
    message,
    ...(metadata ?? {})
  }));
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
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? `Convex step ${operation} failed.`);
  }
  return payload?.result as T;
}

async function discordApi<T>(path: string) {
  const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json"
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message ?? `Discord API ${path} failed.`);
  }
  return payload as T;
}

async function resolveVoiceChannelId(client: Client, guildId: string, userId: string) {
  const guild = await client.guilds.fetch(guildId);
  const cachedChannelId = guild.voiceStates.cache.get(userId)?.channelId;
  if (cachedChannelId) {
    return { guild, channelId: cachedChannelId, source: "cache" as const };
  }

  const voiceState = await discordApi<{ channel_id?: string | null }>(
    `/guilds/${guildId}/voice-states/${userId}`
  ).catch((error: Error) => {
    log("discord_voice_state_fetch_failed", { guildId, userId, error: error.message });
    return null;
  });
  return {
    guild,
    channelId: voiceState?.channel_id ?? null,
    source: "rest" as const
  };
}

function mimeTypeForFile(fileName: string) {
  switch (extname(fileName).toLowerCase()) {
    case ".wav":
      return "audio/wav";
    case ".ogg":
    case ".oga":
      return "audio/ogg";
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".webm":
    default:
      return "audio/webm";
  }
}

function wavHeader(dataBytes: number) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(OPUS_CHANNELS, 22);
  header.writeUInt32LE(OPUS_SAMPLE_RATE, 24);
  header.writeUInt32LE(OPUS_SAMPLE_RATE * OPUS_CHANNELS * PCM_BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(OPUS_CHANNELS * PCM_BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

function clipSample(value: number) {
  return Math.max(-32768, Math.min(32767, value));
}

class PcmWavRecorder {
  readonly filePath: string;
  readonly seenUserIds = new Set<string>();
  private readonly stream;
  private readonly buffers = new Map<string, Buffer[]>();
  private readonly bufferedBytes = new Map<string, number>();
  private readonly startedAt = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private dataBytes = 0;
  private stopped = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.stream = createWriteStream(filePath);
    this.stream.write(Buffer.alloc(44));
  }

  start() {
    this.timer = setInterval(() => this.writeMixedFrame(), FRAME_DURATION_MS);
  }

  push(userId: string, chunk: Buffer) {
    if (this.stopped || !chunk.length) {
      return;
    }
    this.seenUserIds.add(userId);
    const queue = this.buffers.get(userId) ?? [];
    queue.push(Buffer.from(chunk));
    this.buffers.set(userId, queue);
    this.bufferedBytes.set(userId, (this.bufferedBytes.get(userId) ?? 0) + chunk.byteLength);
  }

  async stop() {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.writeMixedFrame();
    this.stream.end();
    await once(this.stream, "finish");
    const file = await open(this.filePath, "r+");
    try {
      await file.write(wavHeader(this.dataBytes), 0, 44, 0);
    } finally {
      await file.close();
    }
  }

  durationMs() {
    return Math.max(0, Date.now() - this.startedAt);
  }

  private readUserFrame(userId: string) {
    const available = this.bufferedBytes.get(userId) ?? 0;
    if (available < PCM_FRAME_BYTES) {
      return null;
    }
    const queue = this.buffers.get(userId) ?? [];
    const frame = Buffer.allocUnsafe(PCM_FRAME_BYTES);
    let offset = 0;
    while (offset < PCM_FRAME_BYTES) {
      const head = queue[0];
      if (!head) {
        break;
      }
      const needed = PCM_FRAME_BYTES - offset;
      const take = Math.min(needed, head.byteLength);
      head.copy(frame, offset, 0, take);
      offset += take;
      if (take === head.byteLength) {
        queue.shift();
      } else {
        queue[0] = head.subarray(take);
      }
    }
    this.buffers.set(userId, queue);
    this.bufferedBytes.set(userId, available - PCM_FRAME_BYTES);
    return frame;
  }

  private writeMixedFrame() {
    if (this.stopped && this.buffers.size === 0) {
      return;
    }
    const frames: Buffer[] = [];
    for (const userId of this.buffers.keys()) {
      const frame = this.readUserFrame(userId);
      if (frame) {
        frames.push(frame);
      }
    }
    const output = Buffer.alloc(PCM_FRAME_BYTES);
    if (frames.length) {
      for (let offset = 0; offset < PCM_FRAME_BYTES; offset += 2) {
        let mixed = 0;
        for (const frame of frames) {
          mixed += frame.readInt16LE(offset);
        }
        output.writeInt16LE(clipSample(mixed), offset);
      }
    }
    this.stream.write(output);
    this.dataBytes += output.byteLength;
  }
}

async function uploadCaptureFile(capture: ClaimedCapture, file: CaptureFile, participantCount?: number) {
  log("discord_upload_started", {
    captureId: capture._id,
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes
  });
  const upload = await convexStep<{ uploadUrl?: string }>("discord-generate-upload-url");
  if (!upload?.uploadUrl) {
    throw new Error("Convex did not return a Discord upload URL.");
  }

  const storageResponse = await fetch(upload.uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": file.mimeType
    },
    body: createReadStream(file.filePath) as unknown as BodyInit,
    duplex: "half"
  } as RequestInit & { duplex: "half" });
  const storagePayload = await storageResponse.json().catch(() => null);
  if (!storageResponse.ok || !storagePayload?.storageId) {
    throw new Error("Unable to upload Discord recording to Convex storage.");
  }

  const completeResponse = await fetch(`${SIDETONE_APP_URL}/api/discord/worker/complete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SIDETONE_WORKER_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      captureId: capture._id,
      workerSessionId,
      storageId: storagePayload.storageId,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      durationMs: file.durationMs,
      participantCount
    })
  });
  const completePayload = await completeResponse.json().catch(() => null);
  if (!completeResponse.ok) {
    throw new Error(completePayload?.error ?? "Unable to complete Discord capture.");
  }
  log("discord_upload_completed", {
    captureId: capture._id,
    fileName: file.fileName,
    sizeBytes: file.sizeBytes
  });
}

async function fixtureCaptureFile(): Promise<CaptureFile> {
  if (!CAPTURE_FIXTURE_PATH) {
    throw new Error("No fixture path configured.");
  }
  const info = await stat(CAPTURE_FIXTURE_PATH);
  const fileName = basename(CAPTURE_FIXTURE_PATH);
  return {
    filePath: CAPTURE_FIXTURE_PATH,
    fileName,
    mimeType: mimeTypeForFile(fileName),
    sizeBytes: info.size
  };
}

function nonBotMemberCount(channel: VoiceBasedChannel) {
  return channel.members.filter((member) => !member.user.bot).size;
}

function missingVoicePermissions(channel: VoiceBasedChannel) {
  const permissions = channel.guild.members.me
    ? channel.permissionsFor(channel.guild.members.me)
    : null;
  const required = [
    ["View Channel", PermissionFlagsBits.ViewChannel],
    ["Connect", PermissionFlagsBits.Connect],
    ["Speak", PermissionFlagsBits.Speak],
    ["Use Voice Activity", PermissionFlagsBits.UseVAD]
  ] as const;

  return required
    .filter(([, permission]) => !permissions?.has(permission))
    .map(([label]) => label);
}

async function sendVoiceNotice(channel: VoiceBasedChannel, message: string) {
  if ("send" in channel && typeof channel.send === "function") {
    await channel.send(message).catch((error: Error) => {
      log("discord_channel_notice_failed", { error: error.message });
    });
  }
}

async function waitForStopOrTimeout(capture: ClaimedCapture, channel: VoiceBasedChannel, startedAt: number) {
  let emptySince: number | null = null;
  while (Date.now() - startedAt < CAPTURE_MAX_MS) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const state = await convexStep<CaptureState>("discord-capture-state", {
      captureId: capture._id,
      workerSessionId
    });
    if (state.status === "stopped" || state.status === "failed") {
      return state.status;
    }
    const humans = nonBotMemberCount(channel);
    if (humans === 0) {
      emptySince ??= Date.now();
      if (Date.now() - emptySince >= EMPTY_CHANNEL_GRACE_MS) {
        return "empty";
      }
    } else {
      emptySince = null;
    }
  }
  return "timeout";
}

async function recordDiscordVoiceCapture(
  client: Client,
  capture: ClaimedCapture,
  channel: VoiceBasedChannel
): Promise<CaptureFile & { participantCount: number }> {
  const tempDir = await mkdtemp(join(tmpdir(), "sidetone-discord-"));
  const filePath = join(tempDir, `${capture._id}.wav`);
  const recorder = new PcmWavRecorder(filePath);
  const subscriptions = new Set<string>();
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    const participantCount = nonBotMemberCount(channel);
    await convexStep("discord-mark-recording", {
      captureId: capture._id,
      workerSessionId,
      discordChannelId: channel.id,
      discordChannelName: "name" in channel ? channel.name : undefined,
      participantCount
    });
    log("discord_recording_started", {
      captureId: capture._id,
      guildId: capture.discordGuildId,
      channelId: channel.id,
      participantCount
    });

    await sendVoiceNotice(
      channel,
      "Sidetone is recording this voice channel for notes. Use `/sidetone stop` to end."
    );
    recorder.start();

    connection.receiver.speaking.on("start", (userId) => {
      if (userId === client.user?.id || subscriptions.has(userId)) {
        return;
      }
      subscriptions.add(userId);
      const audioStream = connection.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterInactivity,
          duration: 1500
        }
      });
      const decoder = new prism.opus.Decoder({
        rate: OPUS_SAMPLE_RATE,
        channels: OPUS_CHANNELS,
        frameSize: FRAME_SAMPLES
      });
      decoder.on("data", (chunk: Buffer) => recorder.push(userId, chunk));
      decoder.on("error", (error) => log("discord_opus_decode_failed", { userId, error: error.message }));
      audioStream.on("end", () => subscriptions.delete(userId));
      audioStream.on("error", (error) => log("discord_audio_stream_failed", { userId, error: error.message }));
      audioStream.pipe(decoder);
    });

    const stopReason = await waitForStopOrTimeout(capture, channel, Date.now());
    log("discord_recording_stopped", {
      captureId: capture._id,
      guildId: capture.discordGuildId,
      channelId: channel.id,
      stopReason,
      speakers: recorder.seenUserIds.size
    });

    await recorder.stop();
    const info = await stat(filePath);
    return {
      filePath,
      fileName: `discord-${capture._id}.wav`,
      mimeType: "audio/wav",
      sizeBytes: info.size,
      durationMs: recorder.durationMs(),
      participantCount,
      cleanup: () => rm(tempDir, { recursive: true, force: true })
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  } finally {
    connection.destroy();
  }
}

async function processQueuedCapture(client: Client) {
  const capture = await convexStep<ClaimedCapture | null>("discord-claim-capture", { workerSessionId });
  if (!capture) {
    return;
  }

  let captureFile: CaptureFile | undefined;
  try {
    log("discord_capture_claimed", {
      captureId: capture._id,
      guildId: capture.discordGuildId,
      startedByUserId: capture.discordStartedByUserId
    });
    const { channelId, source } = await resolveVoiceChannelId(
      client,
      capture.discordGuildId,
      capture.discordStartedByUserId
    );
    log("discord_voice_state_resolved", {
      captureId: capture._id,
      guildId: capture.discordGuildId,
      startedByUserId: capture.discordStartedByUserId,
      channelId,
      source
    });
    if (!channelId) {
      await convexStep("discord-fail-capture", {
        captureId: capture._id,
        workerSessionId,
        error: "Join a Discord voice channel first, then run /sidetone start again."
      });
      return;
    }

    const channel = await client.channels.fetch(channelId);
    const missingPermissions = channel?.isVoiceBased()
      ? missingVoicePermissions(channel)
      : [];
    log("discord_channel_fetched", {
      captureId: capture._id,
      channelId,
      channelType: channel?.type,
      isVoiceBased: Boolean(channel?.isVoiceBased()),
      joinable: channel?.isVoiceBased() ? channel.joinable : undefined,
      speakable: channel?.isVoiceBased() && "speakable" in channel ? channel.speakable : undefined,
      missingPermissions
    });
    if (!channel?.isVoiceBased() || channel.type !== ChannelType.GuildVoice) {
      throw new Error("Sidetone can only record standard server voice channels.");
    }

    if (!channel.joinable) {
      throw new Error(missingPermissions.length
        ? `Sidetone is missing Discord channel permission: ${missingPermissions.join(", ")}.`
        : "Sidetone does not have permission to join that voice channel.");
    }
    if (!channel.speakable) {
      throw new Error(missingPermissions.length
        ? `Sidetone is missing Discord channel permission: ${missingPermissions.join(", ")}.`
        : "Sidetone does not have permission to speak in that voice channel.");
    }

    captureFile = CAPTURE_FIXTURE_PATH
      ? await fixtureCaptureFile()
      : await recordDiscordVoiceCapture(client, capture, channel);

    if (CAPTURE_FIXTURE_PATH) {
      await convexStep("discord-mark-recording", {
        captureId: capture._id,
        workerSessionId,
        discordChannelId: channel.id,
        discordChannelName: "name" in channel ? channel.name : undefined,
        participantCount: nonBotMemberCount(channel)
      });
    }

    const participantCount = "participantCount" in captureFile && typeof captureFile.participantCount === "number"
      ? captureFile.participantCount
      : nonBotMemberCount(channel);
    await uploadCaptureFile(capture, captureFile, participantCount);
    log("discord_capture_completed", {
      captureId: capture._id,
      guildId: capture.discordGuildId,
      channelId: channel.id,
      fileName: captureFile.fileName,
      sizeBytes: captureFile.sizeBytes
    });
    await captureFile.cleanup?.();
    captureFile = undefined;
  } catch (error) {
    log("discord_capture_failed", {
      captureId: capture._id,
      error: error instanceof Error ? error.message : "Discord voice capture failed."
    });
    await convexStep("discord-fail-capture", {
      captureId: capture._id,
      workerSessionId,
      error: error instanceof Error ? error.message : "Discord voice capture failed."
    });
  } finally {
    await captureFile?.cleanup?.();
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.once(Events.ClientReady, (readyClient) => {
  log("gateway_ready", { userId: readyClient.user.id });
  setInterval(() => {
    void processQueuedCapture(client).catch((error) => {
      log("capture_poll_failed", { error: error.message });
    });
  }, 3000);
  log("worker_started", {
    captureMode: CAPTURE_FIXTURE_PATH ? "fixture" : "live_dave",
    captureMaxMs: CAPTURE_MAX_MS
  });
});

client.on(Events.Error, (error) => {
  log("gateway_error", { error: error.message });
});

await client.login(DISCORD_BOT_TOKEN);
