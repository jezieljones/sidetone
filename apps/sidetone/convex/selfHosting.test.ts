/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { normalizeSegments } from './transcriptLimits';
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const workerToken = 'test-worker-credential-for-local-tests-only';

beforeEach(() => {
  vi.stubEnv('SIDETONE_WORKER_TOKEN', workerToken);
  vi.stubEnv('SIDETONE_BILLING_ENABLED', 'false');
  vi.stubEnv('SIDETONE_PHONE_ENABLED', 'false');
  vi.stubEnv('SIDETONE_SMS_ENABLED', 'false');
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('INNGEST_EVENT_KEY', '');
  vi.stubEnv('SIDETONE_ALLOW_DETERMINISTIC_POST_CALL_FALLBACK', 'true');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function fixture() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: 'alice', issuer: 'https://auth.example.test', tokenIdentifier: 'https://auth.example.test|alice' });
  const stranger = t.withIdentity({ subject: 'bob', issuer: 'https://auth.example.test', tokenIdentifier: 'https://auth.example.test|bob' });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(['test audio'], { type: 'audio/wav' })));
  const { callSessionId } = await owner.mutation(api.calls.createUploadedRecordingCall, { workerToken, storageId, fileName: 'meeting.wav', mimeType: 'audio/wav', sizeBytes: 10 });
  return { t, owner, stranger, callSessionId };
}

describe('self-hosted installation', () => {
  test('enables intelligence without a Stripe customer or trial', async () => {
    const { t, owner } = await fixture();
    expect(await owner.mutation(api.billing.ensureTrialForAuthenticatedOwner, {})).toEqual({ subscriptionId: null });
    expect(await owner.query(api.billing.entitlementsForAuthenticatedOwner, {})).toMatchObject({ callIntelligence: true, status: 'active', overageEligible: false });
    const rows = await t.run(async ctx => ({ subscriptions: await ctx.db.query('billingSubscriptions').take(1), customers: await ctx.db.query('billingCustomers').take(1) }));
    expect(rows).toEqual({ subscriptions: [], customers: [] });
  });

  test('rejects missing/wrong worker credentials before transcript or webhook writes', async () => {
    const { t, callSessionId } = await fixture();
    for (const token of ['', 'incorrect']) {
      await expect(t.mutation(api.calls.appendTranscriptSegmentFromRealtime, { workerToken: token, callSessionId, provider: 'other', speakerTrack: 'mixed', text: 'forged', startMs: 0, endMs: 1, isFinal: true })).rejects.toThrow('Unauthorized');
      await expect(t.mutation(api.calls.patchCallFromWebhook, { workerToken: token, callSessionId, status: 'ready' })).rejects.toThrow('Unauthorized');
      await expect(t.query(api.calls.callSessionForRealtime, { workerToken: token, callSessionId })).rejects.toThrow('Unauthorized');
    }
    vi.stubEnv('SIDETONE_WORKER_TOKEN', '');
    await expect(t.query(api.calls.callSessionForRealtime, { workerToken: '', callSessionId })).rejects.toThrow('Unauthorized');
    expect(await t.run(ctx => ctx.db.query('transcriptSegments').take(1))).toEqual([]);
  });

  test('allows a configured worker and keeps records isolated between owners', async () => {
    const { t, owner, stranger, callSessionId } = await fixture();
    await t.mutation(api.calls.appendTranscriptSegmentFromRealtime, { workerToken, callSessionId, provider: 'other', speakerTrack: 'mixed', text: 'Private conversation', startMs: 0, endMs: 1000, isFinal: true });
    expect(await owner.query(api.calls.callRecordView, { callSessionId })).not.toBeNull();
    await expect(stranger.query(api.calls.callRecordView, { callSessionId })).rejects.toThrow("Call session not found");
    await expect(t.action(api.calls.generateCallArtifactFromTranscript, { callSessionId })).rejects.toThrow();
    await expect(stranger.action(api.calls.generateCallArtifactFromTranscript, { callSessionId })).rejects.toThrow();
  });

  test('processes a stored recording into complete notes without telephone setup', async () => {
    const { t, owner, callSessionId } = await fixture();
    await t.mutation(internal.calls.recordUploadedRecordingTranscriptInternal, { callSessionId, assemblyAiTranscriptId: 'fixture-transcript', segments: [
      { text: 'We will launch the project on Friday.', startMs: 0, endMs: 2000, speakerLabel: 'Alice' },
      { text: 'I will send the final proposal tomorrow.', startMs: 2000, endMs: 4000, speakerLabel: 'Bob' }
    ] });
    await t.action(internal.calls.finalizeUploadedRecordingInternal, { callSessionId });
    const record = await owner.query(api.calls.callRecordView, { callSessionId });
    expect(record?.callSession.status).toBe('ready');
    expect(record?.segments.map(s => s.text).join(' ')).toContain('final proposal tomorrow');
    expect(record?.artifact?.status).toBe('ready');
    expect(await t.run(ctx => ctx.db.query('phoneCallUsageEvents').take(1))).toEqual([]);
  });

  test('disabled phone capture cannot be invoked directly through Convex', async () => {
    const { t, callSessionId } = await fixture();
    const call = await t.run(ctx => ctx.db.get(callSessionId));
    await expect(t.mutation(api.calls.createConferenceInSessionFromWebhook, { workerToken, entityId: call!.entityId, toPhoneNumber: '+12025550123' })).rejects.toThrow('disabled');
  });

  test('an owner can regenerate notes using their configured AI model', async () => {
    const { t, owner, callSessionId } = await fixture();
    await t.mutation(internal.calls.recordUploadedRecordingTranscriptInternal, { callSessionId, assemblyAiTranscriptId: 'fixture-transcript', segments: [{ text: 'Alice will send the proposal on Friday.', startMs: 0, endMs: 3000 }] });
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-test-credential');
    vi.stubEnv('SIDETONE_POST_CALL_MODEL', 'fixture-model');
    const artifact = { title: 'Friday Proposal Delivery', summary: 'Alice will send the proposal on Friday.', decisions: [], actionItems: ['Alice: send the proposal on Friday.'], risks: [], followUpDraft: '', crmNoteDraft: '' };
    const request = vi.fn(async () => new Response(JSON.stringify({ output_text: JSON.stringify(artifact) }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', request);
    const result = await owner.action(api.calls.generateCallArtifactFromTranscript, { callSessionId });
    expect(result).toMatchObject({ status: 'ready', modelName: 'fixture-model' });
    expect(request).toHaveBeenCalledOnce();
    const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(JSON.parse(String(options.body)).model).toBe('fixture-model');
    expect((await owner.query(api.calls.callRecordView, { callSessionId }))?.artifact?.summary).toBe(artifact.summary);
  });

  test('sharing is owner-controlled and revocation blocks public reads', async () => {
    const { t, owner, stranger, callSessionId } = await fixture();
    const shareToken = 'synthetic-share-token-for-local-tests-only';
    expect(await t.query(api.calls.publicCallRecordByShareToken, { shareToken })).toBeNull();
    await expect(stranger.mutation(api.calls.enableCallShare, { callSessionId, shareToken })).rejects.toThrow('Call session not found');
    await owner.mutation(api.calls.enableCallShare, { callSessionId, shareToken });
    expect(await t.query(api.calls.publicCallRecordByShareToken, { shareToken })).not.toBeNull();
    await owner.mutation(api.calls.disableCallShare, { callSessionId });
    expect(await t.query(api.calls.publicCallRecordByShareToken, { shareToken })).toBeNull();
  });

  test('keeps an operator call-duration limit without subscription cutoffs', async () => {
    const { t, callSessionId } = await fixture();
    vi.stubEnv('SIDETONE_MAX_CALL_MINUTES', '5');
    await t.run(ctx => ctx.db.patch(callSessionId, { status: 'live', startedAt: Date.now() - 6 * 60_000, telnyxCallControlId: 'fixture-control' }));
    const result = await t.mutation(internal.billing.monitorLiveCallInternal, { callSessionId });
    expect(result).toMatchObject({ shouldEndCall: true, shouldSendGraceSms: false, callControlIds: ['fixture-control'] });
  });
});

test('normalization preserves long Unicode transcripts and fails instead of truncating', () => {
  const text = '🎧'.repeat(2200);
  const result = normalizeSegments([{ text, startMs: 0, endMs: 2200 }]);
  expect(result.map(s => s.text).join('')).toBe(text);
  expect(result.length).toBe(3);
  expect(result.at(-1)?.endMs).toBe(2200);
  expect(() => normalizeSegments(Array.from({ length: 1001 }, () => ({ text: 'test', startMs: 0, endMs: 1 })))).toThrow('limit');
});
