# Contributing

Use Node 22.12+ and `npm ci`. Run setup with your own development accounts or use the synthetic test suite. Never commit credentials, recordings, transcripts, provider exports, `.vercel` links, or customer fixtures. Redact logs in issues.

Run `npm test`, `npm run test:live-cards`, `npm run typecheck`, `npm run build`, and `npm run scan:secrets` before a pull request. Add behavior tests for authorization or billing changes. Keep capture sources optional and keep queries bounded. Test migrations with a disposable backend. Describe any remaining live-provider validation clearly.

Contributions are submitted under Apache-2.0 unless agreed otherwise. Preserve dependency license notices. Feature proposals for local transcription, alternate authentication, archive pagination, and desktop capture are welcome.
