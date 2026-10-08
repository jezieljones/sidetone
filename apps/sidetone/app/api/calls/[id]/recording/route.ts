import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import { getConvexAuthToken } from "../../../../lib/clerk-convex";
import { getCallRecordingDownloadUrl } from "../../../../lib/telnyx";
import { getVexaRecordingDownloadUrl } from "../../../../lib/vexa";

function safeFilename(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "sidetone-call";
}

function extensionForRecording(recording: { format?: string; fileName?: string }) {
  const format = recording.format?.trim();
  if (format) {
    return format;
  }
  const extension = recording.fileName?.split(".").pop()?.toLowerCase();
  return extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : "mp3";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { id } = await params;
  const url = new URL(request.url);
  const recordingDocId = url.searchParams.get("recordingId");
  const shouldDownload = url.searchParams.get("download") === "1";

  if (!recordingDocId) {
    return NextResponse.json({ error: "Missing recording." }, { status: 400 });
  }

  const token = await getConvexAuthToken();
  const recording = await fetchQuery(api.calls.recordingAccessForOwner, {
    callSessionId: id as any,
    recordingDocId
  }, { token });

  if (!recording || recording.status !== "ready") {
    return NextResponse.json({ error: "Recording is not ready yet." }, { status: 404 });
  }

  const format = extensionForRecording(recording);
  const vexaDownload = recording.provider === "vexa"
    ? recording.vexaMediaFileId
      ? await getVexaRecordingDownloadUrl({
        recordingId: recording.recordingId,
        mediaFileId: recording.vexaMediaFileId
      })
      : null
    : null;
  const downloadUrl = recording.provider === "convex_storage" || recording.provider === "zoom_rtms"
    ? recording.storageUrl
    : recording.provider === "vexa"
      ? vexaDownload?.url
      : await getCallRecordingDownloadUrl({
        recordingId: recording.recordingId,
        format: format === "wav" ? "wav" : "mp3"
      });

  if (!downloadUrl) {
    return NextResponse.json({ error: "Recording file is not available yet." }, { status: 404 });
  }

  const range = request.headers.get("range");
  const upstreamHeaders = new Headers(vexaDownload?.headers);
  if (range) {
    upstreamHeaders.set("range", range);
  }
  const upstream = await fetch(downloadUrl, {
    headers: upstreamHeaders,
    cache: "no-store"
  });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Unable to load recording." }, { status: upstream.status || 502 });
  }

  const contentType = recording.mimeType
    ?? vexaDownload?.contentType
    ?? upstream.headers.get("content-type")
    ?? (format === "wav" ? "audio/wav" : format === "webm" ? "video/webm" : "audio/mpeg");
  const responseHeaders = new Headers();
  responseHeaders.set("content-type", contentType);
  responseHeaders.set("cache-control", "private, no-store");
  responseHeaders.set(
    "content-disposition",
    `${shouldDownload ? "attachment" : "inline"}; filename="${safeFilename(recording.fileName ?? `sidetone-call-${id}`)}.${format}"`
  );

  for (const header of ["content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(header);
    if (value) {
      responseHeaders.set(header, value);
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders
  });
}
