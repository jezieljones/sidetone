import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { WebSocket, WebSocketServer } from "ws";

const port = Number(process.env.PORT ?? 8080);
const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
const assemblyAiKey = process.env.ASSEMBLYAI_API_KEY;
const assemblyAiStreamingModel = process.env.ASSEMBLYAI_STREAMING_MODEL ?? "universal-streaming-english";
const streamSharedSecret = process.env.SIDETONE_STREAM_SHARED_SECRET?.trim();
const workerToken = process.env.SIDETONE_WORKER_TOKEN?.trim();
if (!convexUrl || !assemblyAiKey || !workerToken || workerToken.length < 32 || !streamSharedSecret || streamSharedSecret.length < 32) {
  throw new Error("Set CONVEX_URL, ASSEMBLYAI_API_KEY, and distinct SIDETONE_WORKER_TOKEN / SIDETONE_STREAM_SHARED_SECRET values of at least 32 characters.");
}
const api: any = anyApi;
const convex = convexUrl ? new ConvexHttpClient(convexUrl) : null;

const assemblyAiTurnDetection = {
  end_of_turn_confidence_threshold: Number(process.env.ASSEMBLYAI_EOT_CONFIDENCE_THRESHOLD ?? 0.7),
  min_turn_silence: Number(process.env.ASSEMBLYAI_MIN_TURN_SILENCE_MS ?? 800),
  max_turn_silence: Number(process.env.ASSEMBLYAI_MAX_TURN_SILENCE_MS ?? 5000)
};

type TelnyxStreamMessage = {
  event?: string;
  sequence_number?: string;
  stream_id?: string;
  start?: {
    call_control_id?: string;
    call_session_id?: string;
    client_state?: string;
    custom_parameters?: Record<string, string> | Array<{ name?: string; value?: string }>;
    stream_params?: Record<string, string> | Array<{ name?: string; value?: string }>;
  };
  media?: {
    track?: "inbound" | "outbound";
    chunk?: string;
    timestamp?: string;
    payload?: string;
  };
  stop?: {
    call_control_id?: string;
    call_session_id?: string;
    client_state?: string;
  };
};

type AssemblyTurnMessage = {
  type?: string;
  transcript?: string;
  utterance?: string;
  end_of_turn?: boolean;
  confidence?: number;
  words?: Array<{ text: string; start: number; end: number; confidence?: number }>;
};

function json(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function callSessionIdFromClientState(clientState?: string | null) {
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

function customParameterValue(
  customParameters: Record<string, string> | Array<{ name?: string; value?: string }> | undefined,
  key: string
) {
  if (!customParameters) {
    return undefined;
  }

  if (Array.isArray(customParameters)) {
    return customParameters.find((item) => item.name === key)?.value;
  }

  return customParameters[key];
}

function callSessionIdFromMessage(message: TelnyxStreamMessage) {
  return (
    customParameterValue(message.start?.custom_parameters, "callSessionId") ??
    customParameterValue(message.start?.stream_params, "callSessionId") ??
    callSessionIdFromClientState(message.start?.client_state) ??
    callSessionIdFromClientState(message.stop?.client_state)
  );
}

function mulawByteToPcm16(muLawByte: number) {
  const mu = ~muLawByte & 0xff;
  const sign = mu & 0x80;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

function decodeMulawBase64ToPcm16(payload: string) {
  const muLaw = Buffer.from(payload, "base64");
  const pcm = Buffer.alloc(muLaw.length * 2);
  for (let index = 0; index < muLaw.length; index += 1) {
    pcm.writeInt16LE(mulawByteToPcm16(muLaw[index]), index * 2);
  }
  return pcm;
}

async function appendTranscriptSegment(input: {
  callSessionId: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  speakerTrack: "inbound" | "outbound" | "mixed" | "unknown";
}) {
  if (!convex || !input.text.trim()) {
    return null;
  }

  const chars = Array.from(input.text.trim());
  let result = null;
  for (let offset = 0; offset < chars.length; offset += 1024) {
    const end = Math.min(chars.length, offset + 1024);
    result = await convex.mutation(api.calls.appendTranscriptSegmentFromRealtime, {
      workerToken,
      callSessionId: input.callSessionId,
      provider: "assemblyai",
      speakerTrack: input.speakerTrack,
      text: chars.slice(offset, end).join(""),
      startMs: input.startMs + (input.endMs - input.startMs) * offset / chars.length,
      endMs: input.startMs + (input.endMs - input.startMs) * end / chars.length,
      confidence: input.confidence,
      isFinal: true
    });
  }
  return result;
}

class AssemblyAiStream {
  private socket: WebSocket | null = null;
  private ready = false;
  private startedAt = Date.now();
  private audioBuffer = Buffer.alloc(0);
  private emittedText = new Set<string>();

  constructor(
    private readonly callSessionId: string,
    private readonly speakerTrack: "inbound" | "outbound" | "mixed" | "unknown"
  ) {}

  connect() {
    if (!assemblyAiKey) {
      return;
    }

    const params = new URLSearchParams({
      sample_rate: "8000",
      speech_model: assemblyAiStreamingModel,
      format_turns: "true"
    });
    this.socket = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params.toString()}`, {
      headers: {
        Authorization: assemblyAiKey
      }
    });

    this.socket.on("open", () => {
      this.ready = true;
      this.socket?.send(JSON.stringify({
        type: "UpdateConfiguration",
        ...assemblyAiTurnDetection
      }));
      console.log("AssemblyAI stream opened.", {
        callSessionId: this.callSessionId,
        speakerTrack: this.speakerTrack,
        speechModel: assemblyAiStreamingModel,
        turnDetection: assemblyAiTurnDetection
      });
    });

    this.socket.on("message", (data) => {
      void this.handleAssemblyMessage(data.toString());
    });

    this.socket.on("close", () => {
      this.ready = false;
      console.log("AssemblyAI stream closed.", {
        callSessionId: this.callSessionId,
        speakerTrack: this.speakerTrack
      });
    });

    this.socket.on("error", (error) => {
      console.warn("AssemblyAI streaming error.", error);
    });
  }

  sendPcm(pcm: Buffer) {
    if (!this.socket || !this.ready || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.audioBuffer = Buffer.concat([this.audioBuffer, pcm]);
    // AssemblyAI streaming expects audio chunks larger than Telnyx's
    // 20ms media frames. At 8kHz 16-bit mono, 100ms is 1600 bytes.
    if (this.audioBuffer.length >= 1600) {
      this.socket.send(this.audioBuffer);
      this.audioBuffer = Buffer.alloc(0);
    }
  }

  close() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      if (this.audioBuffer.length) {
        this.socket.send(this.audioBuffer);
        this.audioBuffer = Buffer.alloc(0);
      }

      this.socket.send(JSON.stringify({ type: "Terminate" }));
      setTimeout(() => {
        if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.close();
        }
      }, 1500);
    }
  }

  private async handleAssemblyMessage(raw: string) {
    let message: AssemblyTurnMessage;
    try {
      message = JSON.parse(raw) as AssemblyTurnMessage;
    } catch {
      return;
    }

    const transcript = (message.utterance ?? (message.end_of_turn ? message.transcript : "") ?? "").trim();
    if (!transcript || this.emittedText.has(transcript.toLowerCase())) {
      return;
    }
    this.emittedText.add(transcript.toLowerCase());

    const startMs = Math.max(0, Date.now() - this.startedAt - 3000);
    const endMs = Math.max(startMs + 1000, Date.now() - this.startedAt);
    await appendTranscriptSegment({
      callSessionId: this.callSessionId,
      text: transcript,
      startMs,
      endMs,
      confidence: message.confidence,
      speakerTrack: this.speakerTrack
    }).catch((error) => {
      console.warn("Unable to append transcript segment.", error);
      return null;
    });
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    json(response, 200, {
      ok: true,
      service: "sidetone-realtime",
      version: "0.2.0",
      convex: Boolean(convexUrl),
      assemblyai: Boolean(assemblyAiKey)
    });
    return;
  }

  json(response, 404, { error: "not_found" });
});

const wss = new WebSocketServer({
  noServer: true
});

wss.on("connection", (socket, request) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  let callSessionId: string | null = requestUrl.searchParams.get("sidetone_call_session_id");
  let inboundStream: AssemblyAiStream | null = null;
  let outboundStream: AssemblyAiStream | null = null;

  socket.on("message", (data) => {
    let message: TelnyxStreamMessage;
    try {
      message = JSON.parse(data.toString()) as TelnyxStreamMessage;
    } catch {
      return;
    }

    if (message.event === "start") {
      callSessionId = callSessionId ?? callSessionIdFromMessage(message);
      if (callSessionId) {
        console.log("Telnyx media stream started.", {
          callSessionId,
          streamId: message.stream_id,
          callControlId: message.start?.call_control_id,
          callSessionIdFromTelnyx: message.start?.call_session_id
        });
        inboundStream = new AssemblyAiStream(callSessionId, "inbound");
        outboundStream = new AssemblyAiStream(callSessionId, "outbound");
        inboundStream.connect();
        outboundStream.connect();
      } else {
        console.warn("Telnyx media stream started without a Sidetone call session id.", {
          streamId: message.stream_id,
          startKeys: Object.keys(message.start ?? {})
        });
      }
      return;
    }

    if (message.event === "media" && callSessionId && message.media?.payload) {
      const pcm = decodeMulawBase64ToPcm16(message.media.payload);
      const target = message.media.track === "outbound" ? outboundStream : inboundStream;
      target?.sendPcm(pcm);
      return;
    }

    if (message.event === "stop") {
      inboundStream?.close();
      outboundStream?.close();
    }
  });

  socket.on("close", () => {
    inboundStream?.close();
    outboundStream?.close();
  });
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname !== "/telnyx/media-stream") {
    socket.destroy();
    return;
  }

  if (streamSharedSecret) {
    const token = url.searchParams.get("sidetone_token") ?? url.searchParams.get("token");
    if (token !== streamSharedSecret) {
      socket.destroy();
      return;
    }
  }

  wss.handleUpgrade(request, socket, head, (websocket) => {
    wss.emit("connection", websocket, request);
  });
});

server.listen(port, () => {
  console.log(`sidetone realtime listening on :${port}`);
});
