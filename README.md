# Sidetone

Open-source conversation notes on your infrastructure. Upload a recording, get a transcript and structured notes, edit/export a Call Doc, and ask questions across your conversations. Optionally connect your own Telnyx account for live phone capture.

**Developer preview · Apache-2.0.** The software has no subscription requirement. You pay your own hosting, AI, transcription, and telephone providers. This release uses Clerk for authentication, Convex for database/storage, Inngest for jobs, AssemblyAI for transcription, and OpenAI for notes/search. It is not an offline app and does not yet capture desktop system audio.

## Quick start

Requirements: Node.js 22.12+, npm, and your own provider accounts. No original Sidetone credentials or infrastructure are needed.

```sh
git clone https://github.com/jezieljones/sidetone.git
cd sidetone
npm ci
npm run setup
```

`setup` creates `apps/sidetone/.env.local` with unique internal secrets. It never overwrites an existing file or prints credentials. Fill in the blank core settings in that file.

1. **Clerk:** create your application, enable your preferred sign-in methods, and add localhost as an allowed development origin. Create a JWT template named `convex` using Clerk's Convex template. Set the publishable key, secret key, and JWT issuer domain. Phone sign-in is optional; phone calling additionally requires a verified phone number on the user's Clerk account.
2. **Convex:** run `npm run convex:dev` and select/create your own project. If the initial deployment asks for the issuer setting, add `CLERK_JWT_ISSUER_DOMAIN` in that deployment's dashboard and retry. Set `NEXT_PUBLIC_CONVEX_URL` to its client URL and `CONVEX_SITE_URL` to its HTTP-actions URL. Do not confuse the `.cloud` and `.site` addresses.
3. **AI:** add your OpenAI and AssemblyAI API keys. Model names are configurable; your OpenAI account must have access to the selected models. Semantic search also uses OpenAI embeddings.
4. **Background jobs:** for local use, start `npm run dev:inngest`. If using hosted Convex, localhost is not reachable from Convex's servers: use an HTTPS tunnel to the local Inngest server and set `INNGEST_BASE_URL` to that reachable URL, or use your own Inngest Cloud account. For self-hosted Convex, use an address reachable from its runtime.
5. **Synchronize server settings:** run `npm run convex:configure`. This copies only backend settings to the selected Convex deployment and refuses conflicting existing values. Review the deployment selected by the Convex CLI first. For your production deployment, use `npm run convex:configure -- --prod`.
6. Run `npm run doctor`, then `npm run dev`. Open [localhost:3000](http://localhost:3000), sign in, and upload a short recording you have permission to transcribe.

Keep `npm run convex:dev`, the web app, and your local Inngest server running during development. Inngest must register `/api/inngest`; a received event alone does not prove the function ran. Follow a test upload through transcript, notes, and document generation.

## Deploy

The supported first-release layout is your own Node/Docker web server with your own managed provider accounts. No Vercel or Google Cloud project is hardcoded.

1. Configure Clerk's production application and domain. Select your Convex production deployment, synchronize backend settings, and run `npm run convex:deploy`.
2. Set both app URLs to your HTTPS domain. Set `INNGEST_DEV=0`, configure real event/signing keys, and register your public `https://YOUR_DOMAIN/api/inngest` endpoint in your Inngest installation. For Inngest Cloud, remove the local `INNGEST_BASE_URL` override.
3. Run `npm run doctor -- --production`.
4. Build and start:

```sh
docker compose --env-file apps/sidetone/.env.local up --build -d
```

Put an HTTPS reverse proxy in front of `127.0.0.1:3000`. Configure its upload limit (up to 100 MB) and request timeout. Database/files live in your Convex deployment; the web container is stateless. Public browser settings are build arguments; changing them requires rebuilding. Secret keys are injected only at runtime and excluded from the Docker build context.

For a plain Node server, use `npm run build` and `npm start`. Vercel can host the web app using root directory `apps/sidetone` and the root workspace install, but its request-size limits constrain this release's server-proxied uploads. Use the container path for large audio files.

See [deployment and recovery](docs/deployment.md), [configuration](docs/configuration.md), and [validation status](docs/release-validation.md).

## Optional phone calling

Keep `SIDETONE_PHONE_ENABLED=false` for upload-only use. To enable phone calls, follow [the Telnyx guide](docs/telnyx.md). It covers your Call Control application, number, outbound profile, webhook verification, and realtime worker. SMS is independently disabled by default.

```sh
docker compose --env-file apps/sidetone/.env.local --profile phone up --build -d
```

There are no subscription-based phone limits in self-hosted mode. `SIDETONE_MAX_CALL_MINUTES` limits an individual call to 120 minutes by default to help bound provider spending. Configure provider-level spending limits too.

Zoom RTMS, Vexa, and Discord adapters are included as **experimental** optional integrations. They require their own applications, permissions, and workers; see [optional sources](docs/optional-sources.md). The default installation does not require any of them, Stripe, a Kubernetes cluster, or a Google Cloud account.

## Data and privacy

Recordings and transcripts are private to their owner until the owner enables a share link. Anyone holding an enabled share link can access its shared content. Disable sharing to revoke it. Audio is sent to AssemblyAI; transcript content is sent to OpenAI. Clerk manages authentication; Inngest processes workflow events/results. Configure retention and access policies with each provider. The bundled privacy page describes this default flow; adapt it to your installation.

This preview displays the most recent 50 calls per workspace (up to five workspaces). A recording is bounded to 1,000 transcript segments of at most 1,024 Unicode characters each. Long provider utterances are split without dropping text. Oversized transcripts fail explicitly instead of producing an incomplete summary. Recordings are limited to 100 MB. Pagination for larger archives is future work; older records are not deleted.

## Development

```sh
npm test
npm run test:live-cards
npm run typecheck
npm run build
npm run scan:secrets
```

`scan:secrets` requires [Gitleaks](https://github.com/gitleaks/gitleaks) and scans tracked source plus Git history. Tests use isolated in-memory Convex data and synthetic recordings, never production accounts.

A GitHub Actions configuration is included at `.github/ci-template.yml`. **CI is not active yet:** the publishing login did not have GitHub's `workflow` permission. To enable it, use an account/login with workflow access and commit a copy at `.github/workflows/ci.yml`. It runs tests, type checks, builds, production dependency auditing, and secret scanning.

```text
apps/sidetone/              Next.js app and Convex functions
packages/sidetone-contracts/ Shared domain types and prompts
workers/sidetone-realtime/  Telnyx audio → AssemblyAI → Convex
workers/sidetone-discord/   Optional Discord voice capture
workers/sidetone-zoom-rtms/  Optional Zoom RTMS capture
scripts/                   Setup, configuration checks, secret scanning
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). The Apache license covers this repository's code; dependencies retain their own licenses, listed in the [dependency inventory](docs/dependency-licenses.json). Sidetone names/marks do not imply endorsement of a fork or independently operated service.
