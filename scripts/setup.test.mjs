import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

test('setup creates distinct private secrets without printing or overwriting them', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sidetone-setup-test-'));
  try {
    mkdirSync(join(directory, 'apps/sidetone'), { recursive: true });
    copyFileSync('apps/sidetone/.env.example', join(directory, 'apps/sidetone/.env.example'));
    const run = () => spawnSync(process.execPath, [resolve('scripts/setup.mjs')], { cwd: directory, encoding: 'utf8' });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const path = join(directory, 'apps/sidetone/.env.local');
    const original = readFileSync(path, 'utf8');
    const env = parseEnv(original);
    const secrets = ['SIDETONE_WORKER_TOKEN', 'SIDETONE_STREAM_SHARED_SECRET', 'SIDETONE_INTEGRATION_SECRET_KEY', 'INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY'].map(key => env[key]);
    assert.equal(new Set(secrets).size, secrets.length);
    for (const secret of secrets) {
      assert.match(secret, /^[a-f0-9]{64}$/);
      assert.equal(first.stdout.includes(secret), false);
    }
    if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(env.OPENAI_API_KEY, '');
    assert.equal(env.SIDETONE_PHONE_ENABLED, 'false');
    assert.equal(run().status, 0);
    assert.equal(readFileSync(path, 'utf8'), original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
