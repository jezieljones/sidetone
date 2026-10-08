export function isSelfHosted() {
  return process.env.SIDETONE_BILLING_ENABLED !== "true";
}

export function requireWorkerToken(token: string) {
  const expected = process.env.SIDETONE_WORKER_TOKEN?.trim();
  if (!expected || expected.length < 32 || token !== expected) throw new Error("Unauthorized.");
}

export function requireFeature(feature: "phone" | "zoom" | "vexa" | "discord" | "integrations") {
  if (process.env[`SIDETONE_${feature.toUpperCase()}_ENABLED`] !== "true") throw new Error(`${feature} is disabled for this installation.`);
}
