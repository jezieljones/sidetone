import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadEnv } from './config.mjs';
const env = loadEnv();
if (!env.CONVEX_DEPLOYMENT && !env.CONVEX_SELF_HOSTED_URL) throw new Error('First run npm run convex:dev to select your own Convex project.');
const allow = new Set(['CLERK_JWT_ISSUER_DOMAIN','OPENAI_API_KEY','TELNYX_API_KEY','TELNYX_MESSAGING_PROFILE_ID','INNGEST_EVENT_KEY','INNGEST_BASE_URL','INNGEST_DEV']);
const entries = Object.entries(env).filter(([key,value]) => value && (allow.has(key) || key.startsWith('SIDETONE_')));
const folder = mkdtempSync(join(tmpdir(), 'sidetone-env-'));
try {
  const file = join(folder, 'convex.env');
  writeFileSync(file, entries.map(([key,value]) => `${key}=${JSON.stringify(value)}`).join('\n'), { mode: 0o600 });
  const args = [resolve('node_modules/convex/bin/main.js'), 'env', 'set', '--from-file', file];
  if (process.argv.includes('--prod')) args.push('--prod');
  // The CLI refuses conflicting existing values; no force-overwrite by default.
  const child = spawnSync(process.execPath, args, { cwd: resolve('apps/sidetone'), env: { ...process.env, ...env }, stdio: 'inherit' });
  process.exitCode = child.status ?? 1;
} finally { rmSync(folder, { recursive: true, force: true }); }
