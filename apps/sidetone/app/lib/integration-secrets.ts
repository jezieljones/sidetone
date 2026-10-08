import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function keyMaterial() {
  const raw = process.env.SIDETONE_INTEGRATION_SECRET_KEY?.trim();
  if (!raw) {
    throw new Error("SIDETONE_INTEGRATION_SECRET_KEY is required to store integration credentials.");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptIntegrationSecret(payload: unknown) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, keyMaterial(), iv);
  const plaintext = JSON.stringify(payload);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return JSON.stringify({
    version: "aes-256-gcm:v1",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  });
}

export function decryptIntegrationSecret<T = unknown>(encryptedPayload: string): T {
  const envelope = JSON.parse(encryptedPayload) as {
    version?: string;
    iv?: string;
    tag?: string;
    ciphertext?: string;
  };
  if (envelope.version !== "aes-256-gcm:v1" || !envelope.iv || !envelope.tag || !envelope.ciphertext) {
    throw new Error("Unsupported integration credential envelope.");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, keyMaterial(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
  return JSON.parse(plaintext) as T;
}
