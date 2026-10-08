import test from 'node:test';
import assert from 'node:assert/strict';
import { checkConfig } from './config.mjs';
const ready = {
  NEXT_PUBLIC_APP_URL: 'https://notes.example.test', SIDETONE_PUBLIC_BASE_URL: 'https://notes.example.test',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'public-test-value', CLERK_SECRET_KEY: 'private-test-value',
  CLERK_JWT_ISSUER_DOMAIN: 'https://auth.example.test', NEXT_PUBLIC_CONVEX_URL: 'https://data.example.test', CONVEX_SITE_URL: 'https://functions.example.test',
  OPENAI_API_KEY: 'provider-test-value', ASSEMBLYAI_API_KEY: 'provider-test-value', SIDETONE_WORKER_TOKEN: 'local-test-worker-token-at-least-32-chars', SIDETONE_INTEGRATION_SECRET_KEY: 'local-test-encryption-key-at-least-32-chars', INNGEST_DEV: '1'
};
test('core setup does not require phone, meeting, or Stripe credentials', () => assert.deepEqual(checkConfig(ready).errors, []));
test('production rejects development job authentication', () => assert.ok(checkConfig(ready, { production: true }).errors.some(e => e.includes('INNGEST_DEV'))));
test('enabling phone requires routing and distinct worker secrets', () => {
 const errors = checkConfig({ ...ready, SIDETONE_PHONE_ENABLED: 'true', SIDETONE_STREAM_SHARED_SECRET: ready.SIDETONE_WORKER_TOKEN }).errors;
 assert.ok(errors.some(e => e.includes('TELNYX_API_KEY'))); assert.ok(errors.some(e => e.includes('different')));
});
test('diagnostics never disclose values', () => assert.ok(!JSON.stringify(checkConfig({ ...ready, CLERK_SECRET_KEY: '' })).includes('provider-test-value')));
