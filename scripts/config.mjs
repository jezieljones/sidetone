import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
export const envPath = resolve('apps/sidetone/.env.local');
export function loadEnv(path = envPath) {
  try { return { ...parseEnv(readFileSync(path, 'utf8')), ...process.env }; }
  catch (error) { if (error.code === 'ENOENT') return { ...process.env }; throw error; }
}
export function checkConfig(env, { production = false } = {}) {
  const errors = [], warnings = [];
  const requireKeys = (keys) => keys.forEach(key => { if (!env[key]?.trim()) errors.push(`Missing ${key}`); });
  requireKeys(['NEXT_PUBLIC_APP_URL','SIDETONE_PUBLIC_BASE_URL','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','CLERK_SECRET_KEY','CLERK_JWT_ISSUER_DOMAIN','NEXT_PUBLIC_CONVEX_URL','CONVEX_SITE_URL','OPENAI_API_KEY','ASSEMBLYAI_API_KEY','SIDETONE_WORKER_TOKEN']);
  for (const key of ['SIDETONE_WORKER_TOKEN','SIDETONE_INTEGRATION_SECRET_KEY']) if ((env[key]?.length ?? 0) < 32) errors.push(`${key} must contain at least 32 characters`);
  for (const key of ['NEXT_PUBLIC_APP_URL','SIDETONE_PUBLIC_BASE_URL','NEXT_PUBLIC_CONVEX_URL','CONVEX_SITE_URL','CLERK_JWT_ISSUER_DOMAIN']) {
    if (!env[key]) continue;
    try { const url = new URL(env[key]); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) errors.push(`${key} must be an HTTP(S) URL without credentials`); else if (production && url.protocol !== 'https:') errors.push(`${key} must use HTTPS in production`); }
    catch { errors.push(`${key} must be a valid URL`); }
  }
  if (env.NEXT_PUBLIC_APP_URL && env.SIDETONE_PUBLIC_BASE_URL && env.NEXT_PUBLIC_APP_URL.replace(/\/$/,'') !== env.SIDETONE_PUBLIC_BASE_URL.replace(/\/$/,'')) errors.push('NEXT_PUBLIC_APP_URL and SIDETONE_PUBLIC_BASE_URL must match');
  if (production) {
    if (['1','true'].includes(env.INNGEST_DEV)) errors.push('Set INNGEST_DEV=0 in production');
    requireKeys(['INNGEST_EVENT_KEY','INNGEST_SIGNING_KEY']);
  }
  if (env.SIDETONE_PHONE_ENABLED === 'true') {
    requireKeys(['TELNYX_API_KEY','TELNYX_PUBLIC_KEY','TELNYX_CALL_CONTROL_CONNECTION_ID','SIDETONE_REALTIME_URL','SIDETONE_STREAM_SHARED_SECRET']);
    if ((env.SIDETONE_STREAM_SHARED_SECRET?.length ?? 0) < 32) errors.push('SIDETONE_STREAM_SHARED_SECRET must contain at least 32 characters');
    if (env.SIDETONE_STREAM_SHARED_SECRET === env.SIDETONE_WORKER_TOKEN) errors.push('Use different stream and worker secrets');
    const limit = Number(env.SIDETONE_MAX_CALL_MINUTES ?? 120);
    if (!Number.isFinite(limit) || limit < 1 || limit > 360) errors.push('SIDETONE_MAX_CALL_MINUTES must be between 1 and 360');
    warnings.push('Verify number assignment, outbound profile, signed webhooks, and a real call before enabling public access');
  }
  if (env.SIDETONE_SMS_ENABLED === 'true') requireKeys(['TELNYX_API_KEY','TELNYX_MESSAGING_PROFILE_ID','SIDETONE_OWNER_SUMMARY_SMS_FROM_NUMBER']);
  if (env.SIDETONE_ZOOM_ENABLED === 'true') requireKeys(['ZOOM_RTMS_CLIENT_ID','ZOOM_RTMS_CLIENT_SECRET','ZOOM_WEBHOOK_SECRET_TOKEN']);
  if (env.SIDETONE_VEXA_ENABLED === 'true') requireKeys(['VEXA_API_BASE','VEXA_API_KEY']);
  if (env.SIDETONE_DISCORD_ENABLED === 'true') requireKeys(['DISCORD_APPLICATION_ID','DISCORD_PUBLIC_KEY','DISCORD_CLIENT_SECRET','DISCORD_BOT_TOKEN']);
  if (env.SIDETONE_BILLING_ENABLED === 'true') warnings.push('Hosted billing is an advanced path; self-hosted deployments should leave it disabled');
  return { errors, warnings };
}
