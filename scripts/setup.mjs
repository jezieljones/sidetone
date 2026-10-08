import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { envPath } from './config.mjs';
if (existsSync(envPath)) {
  console.log('Existing local configuration preserved. Run npm run doctor to check it.');
} else {
  let text = readFileSync('apps/sidetone/.env.example', 'utf8');
  for (const key of ['SIDETONE_WORKER_TOKEN','SIDETONE_STREAM_SHARED_SECRET','SIDETONE_INTEGRATION_SECRET_KEY','INNGEST_EVENT_KEY','INNGEST_SIGNING_KEY']) {
    text = text.replace(new RegExp(`^${key}=$`, 'm'), `${key}=${randomBytes(32).toString('hex')}`);
  }
  writeFileSync(envPath, text, { flag: 'wx', mode: 0o600 });
  console.log('Created apps/sidetone/.env.local with unique internal secrets. Add your own provider settings, then run npm run doctor.');
}
