import { getWorkerToken } from "../../../lib/config";
import { auth } from "@clerk/nextjs/server";
import { isIndustryProfileId } from "@sidetone/contracts";
import { fetchMutation } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { inngest } from "../../../inngest/client";
import { getConvexAuthToken } from "../../../lib/clerk-convex";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ACCEPTED_AUDIO_PREFIXES = ["audio/"];
const ACCEPTED_AUDIO_TYPES = new Set([
  "video/mp4",
  "application/octet-stream"
]);

function stringField(value: FormDataEntryValue | null, maxLength: number) {
  return typeof value === "string" && value.trim()
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : undefined;
}

function acceptedAudioType(type: string) {
  const normalized = type.toLowerCase();
  return ACCEPTED_AUDIO_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || ACCEPTED_AUDIO_TYPES.has(normalized);
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose an audio recording to upload." }, { status: 400 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "That recording is empty." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Keep uploads under 100 MB for now." }, { status: 413 });
  }
  if (file.type && !acceptedAudioType(file.type)) {
    return NextResponse.json({ error: "Upload an audio recording file." }, { status: 415 });
  }

  const token = await getConvexAuthToken();
  const uploadUrl = await fetchMutation(api.calls.generateRecordingUploadUrl, {}, { token });
  const storageResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream"
    },
    body: file
  });
  const storagePayload = await storageResponse.json().catch(() => null);
  if (!storageResponse.ok || !storagePayload?.storageId) {
    return NextResponse.json({ error: "Unable to save the recording upload." }, { status: 502 });
  }

  const requestedIndustryProfile = stringField(formData?.get("industryProfile") ?? null, 80);
  const created = await fetchMutation(api.calls.createUploadedRecordingCall, {
    workerToken: getWorkerToken(),
    storageId: storagePayload.storageId,
    fileName: file.name || "recording",
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    entityName: stringField(formData?.get("entityName") ?? null, 160),
    industryProfile: isIndustryProfileId(requestedIndustryProfile)
      ? requestedIndustryProfile
      : undefined
  }, { token });

  await inngest.send({
    name: "sidetone/recording-upload.requested",
    data: {
      callSessionId: String(created.callSessionId)
    }
  });

  return NextResponse.json({
    ok: true,
    callSessionId: created.callSessionId
  });
}
