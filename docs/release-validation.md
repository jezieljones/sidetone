# Developer preview validation

Validated on October 8, 2026. This is a standalone source release with new Git history; it contains no production environment files, deployment links, recordings, or customer databases.

## Completed

- Fresh dependency installation and a production web build on Linux amd64 in Docker. The web container runs as the unprivileged `node` user.
- Node 22 production builds and TypeScript checks for the web app, shared contracts, realtime worker, Discord worker, and Zoom RTMS worker.
- 27 automated tests: 9 isolated Convex tests, 5 configuration/setup tests, and 13 existing live-card/integration tests.
- Owner isolation, worker authentication, disabled phone capture, subscription-free entitlements, a per-call duration limit, and owner-controlled share-link revocation.
- Synthetic stored-recording transcript processing into notes, plus owner-authorized regeneration with a mocked OpenAI response. These tests do not contact an AI or transcription provider.
- Setup generates distinct secrets with owner-only file permissions, preserves existing configuration, and does not print secrets.
- Production Node and container smoke checks: public pages and `/health` return 200; missing authentication/database configuration redirects private pages to setup and rejects APIs with 503.
- Browser inspection of the landing page, setup redirect, and guide. No browser console errors observed in that flow.
- Realtime worker container builds and refuses startup when required credentials are missing.
- Gitleaks scan of tracked source and release Git history. Original private configuration values were also compared locally against the extracted source without printing or copying them; no matches were found.
- `npm audit --omit=dev` reports zero known vulnerabilities at validation time.

## Known limitations

GitHub Actions is provided as `.github/ci-template.yml` and is not activated in this initial publication because the publishing login lacks workflow permission. All checks listed above were run locally. Follow the README to activate CI with an appropriately authorized login.

The full dependency audit still reports 8 development-tool advisories (5 high, 3 moderate) through Tailwind 3's glob/selector tooling. They are outside the production dependency audit; npm reports no compatible automatic fix for the current toolchain. Avoid building untrusted source/patterns. A future Tailwind migration needs its own visual regression testing.

Live Clerk login/JWT issuance, AssemblyAI transcription, OpenAI model access, Inngest registration/execution, and provider delivery have not been tested against new operator accounts in this release. No original production account was used to manufacture a successful first-run test.

Telnyx number provisioning, signed call events, real audio streaming, SMS, Zoom, Vexa, Discord, hosted billing, and a fully self-hosted Convex/Inngest stack require additional operator validation. The Zoom/Discord images are supplied but only their TypeScript builds were checked. The web and realtime images were tested on Linux amd64; arm64 container builds have not been verified.

Clerk is still hosted. AI and transcription are still external services. Desktop system-audio capture, alternative authentication, local models, and complete archive pagination are not implemented. Provider usage and infrastructure still cost money.

## Fresh-account acceptance checklist

1. Follow the README using new development accounts and an HTTPS test domain/tunnel. Run the configuration checker and synchronize the selected Convex deployment.
2. Sign in as two different users. Verify one user cannot see, edit, or play the other's recordings.
3. Upload a short consented recording. Verify actual Inngest function execution, full transcript, finished notes, editable/exportable Call Doc, and playback.
4. Enable a share link, test it signed out, revoke it, and verify the revoked link stops working.
5. Exercise failed transcription/AI requests and confirm the recording shows an actionable failure rather than an indefinitely processing result.
6. If enabling phone capture, follow the Telnyx guide and validate a real call end to end. Verify the duration cutoff with a short test limit.
7. Restrict registration as appropriate, configure retention/backups and provider spending controls, and test a restore before inviting other users.

An independent security audit and real-provider acceptance testing remain release work for a production-supported version.
