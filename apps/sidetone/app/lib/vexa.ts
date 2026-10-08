type VexaDownloadResponse = {
  url?: string | null;
  download_url?: string | null;
  filename?: string | null;
  content_type?: string | null;
  file_size_bytes?: number | null;
  detail?: string | null;
  error?: string | null;
};

function vexaApiBase() {
  return (process.env.VEXA_API_BASE?.trim() || "https://api.cloud.vexa.ai").replace(/\/+$/, "");
}

function vexaApiKey() {
  const key = process.env.VEXA_API_KEY?.trim() || process.env.VEXA_BOT_KEY?.trim();
  if (!key) {
    throw new Error("VEXA_API_KEY or VEXA_BOT_KEY is not configured.");
  }
  return key;
}

export async function getVexaRecordingDownloadUrl({
  recordingId,
  mediaFileId
}: {
  recordingId: string;
  mediaFileId: string;
}) {
  const apiBase = vexaApiBase();
  const apiKey = vexaApiKey();
  const response = await fetch(
    `${apiBase}/recordings/${encodeURIComponent(recordingId)}/media/${encodeURIComponent(mediaFileId)}/download`,
    {
      headers: {
        "X-API-Key": apiKey
      },
      cache: "no-store"
    }
  );
  const body = await response.json().catch(() => null) as VexaDownloadResponse | null;
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(body?.detail ?? body?.error ?? `Vexa recording lookup failed (${response.status}).`);
  }

  const url = body?.url ?? body?.download_url;
  if (!url) {
    return null;
  }

  return {
    url: `${apiBase}/recordings/${encodeURIComponent(recordingId)}/media/${encodeURIComponent(mediaFileId)}/raw`,
    headers: {
      "X-API-Key": apiKey
    },
    fileName: body?.filename ?? undefined,
    contentType: body?.content_type ?? undefined,
    sizeBytes: body?.file_size_bytes ?? undefined
  };
}
