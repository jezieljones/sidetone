import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
const binary = process.env.GITLEAKS_BIN || 'gitleaks';
if (spawnSync(binary, ['version'], { stdio: 'ignore' }).status !== 0) {
  console.error('Install Gitleaks (https://github.com/gitleaks/gitleaks), then rerun.'); process.exit(1);
}
const result = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
if (result.status !== 0 || !result.stdout) { console.error('Initialize Git and stage the reviewed release files before scanning.'); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), 'sidetone-source-scan-'));
try {
  for (const file of result.stdout.split('\0').filter(Boolean)) {
    const target = join(dir, file); mkdirSync(dirname(target), { recursive: true }); copyFileSync(resolve(file), target);
  }
  const current = spawnSync(binary, ['dir', dir, '--redact', '--no-banner'], { stdio: 'inherit' });
  const hasHistory = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { stdio: 'ignore' }).status === 0;
  const history = hasHistory ? spawnSync(binary, ['git', '.', '--redact', '--no-banner'], { stdio: 'inherit' }) : { status: 0 };
  process.exitCode = current.status || history.status || 0;
} finally { rmSync(dir, { recursive: true, force: true }); }
