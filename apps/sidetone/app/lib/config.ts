export function featureEnabled(feature: "phone" | "zoom" | "vexa" | "discord" | "sms" | "integrations") {
  return process.env[`SIDETONE_${feature.toUpperCase()}_ENABLED`] === "true";
}

export function billingEnabled() {
  return process.env.SIDETONE_BILLING_ENABLED === "true";
}

export function publicBaseUrl() {
  return (process.env.SIDETONE_PUBLIC_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}

export function getWorkerToken() {
  const token = process.env.SIDETONE_WORKER_TOKEN?.trim();
  if (!token || token.length < 32) throw new Error("Configure SIDETONE_WORKER_TOKEN (at least 32 characters) in the app, Convex, and enabled workers.");
  return token;
}
