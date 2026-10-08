import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { BuildiumError, buildiumRequest, verifyBuildiumWebhookSignature } from "./buildium";

const credentials = {
  environment: "production" as const,
  clientId: "client-id",
  clientSecret: "client-secret"
};

test("Buildium client uses /v1 URL and API key headers", async () => {
  const originalFetch = global.fetch;
  let capturedUrl = "";
  let capturedHeaders: Headers | undefined;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await buildiumRequest<{ ok: boolean }>(credentials, "/rentals?limit=1");
    assert.equal(result.ok, true);
    assert.equal(capturedUrl, "https://api.buildium.com/v1/rentals?limit=1");
    assert.equal(capturedHeaders?.get("x-buildium-client-id"), "client-id");
    assert.equal(capturedHeaders?.get("x-buildium-client-secret"), "client-secret");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Buildium client retries 429 responses", async () => {
  const originalFetch = global.fetch;
  let count = 0;
  global.fetch = (async () => {
    count += 1;
    if (count === 1) {
      return new Response(JSON.stringify({ message: "rate limited" }), { status: 429 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await buildiumRequest<{ ok: boolean }>(credentials, "/rentals?limit=1");
    assert.equal(result.ok, true);
    assert.equal(count, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Buildium client surfaces auth failures", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    return new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      buildiumRequest(credentials, "/rentals?limit=1"),
      (err) => err instanceof BuildiumError && err.status === 401
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("Buildium webhook HMAC accepts documented timestamp signature shape", () => {
  const body = JSON.stringify({ event: "tenant.updated" });
  const timestamp = "1760000000";
  const secret = "webhook-secret";
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  assert.equal(verifyBuildiumWebhookSignature({ body, timestamp, signature, secret }), true);
  assert.equal(verifyBuildiumWebhookSignature({ body, timestamp, signature: "bad", secret }), false);
});
