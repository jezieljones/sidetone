import crypto from "node:crypto";

export type BuildiumEnvironment = "production" | "sandbox";

export type BuildiumCredentials = {
  environment: BuildiumEnvironment;
  clientId: string;
  clientSecret: string;
};

export class BuildiumError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.name = "BuildiumError";
    this.status = status;
    this.payload = payload;
  }
}

let activeBuildiumRequests = 0;
const buildiumQueue: Array<() => void> = [];

function buildiumBaseUrl(environment: BuildiumEnvironment) {
  return environment === "sandbox"
    ? "https://apisandbox.buildium.com/v1"
    : "https://api.buildium.com/v1";
}

async function withBuildiumSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeBuildiumRequests >= 10) {
    await new Promise<void>((resolve) => buildiumQueue.push(resolve));
  }
  activeBuildiumRequests += 1;
  try {
    return await work();
  } finally {
    activeBuildiumRequests = Math.max(0, activeBuildiumRequests - 1);
    buildiumQueue.shift()?.();
  }
}

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function buildiumRequest<T>(
  credentials: BuildiumCredentials,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = `${buildiumBaseUrl(credentials.environment)}${normalizePath(path)}`;
  let lastError: BuildiumError | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await withBuildiumSlot(() => fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-buildium-client-id": credentials.clientId,
        "x-buildium-client-secret": credentials.clientSecret,
        ...(init.headers ?? {})
      },
      cache: "no-store"
    }));
    const body = await response.json().catch(() => null);
    if (response.ok) {
      return body as T;
    }
    const message = typeof body?.Message === "string"
      ? body.Message
      : typeof body?.message === "string"
        ? body.message
        : `Buildium request failed (${response.status}).`;
    lastError = new BuildiumError(response.status, message, body);
    if (response.status !== 429) {
      throw lastError;
    }
    await sleep(200 * (attempt + 1));
  }
  throw lastError ?? new BuildiumError(429, "Buildium rate limit retry failed.");
}

export async function testBuildiumConnection(credentials: BuildiumCredentials) {
  await buildiumRequest(credentials, "/rentals?limit=1");
  return { ok: true };
}

export function normalizeBuildiumCredentials(input: {
  environment?: unknown;
  clientId?: unknown;
  clientSecret?: unknown;
}): BuildiumCredentials {
  const environment = input.environment === "sandbox" ? "sandbox" : "production";
  const clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
  const clientSecret = typeof input.clientSecret === "string" ? input.clientSecret.trim() : "";
  if (!clientId || !clientSecret) {
    throw new Error("Buildium client ID and client secret are required.");
  }
  return { environment, clientId, clientSecret };
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyBuildiumWebhookSignature(input: {
  body: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
}) {
  if (!input.timestamp || !input.signature || !input.secret) {
    return false;
  }
  const signedPayload = `${input.timestamp}.${input.body}`;
  const digest = crypto.createHmac("sha256", input.secret).update(signedPayload).digest();
  const expectedHex = digest.toString("hex");
  const expectedBase64 = digest.toString("base64");
  return safeEqual(input.signature, expectedHex) || safeEqual(input.signature, expectedBase64);
}
