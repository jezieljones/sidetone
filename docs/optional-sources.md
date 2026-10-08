# Experimental conversation sources

These adapters are included for developers, but the first release's acceptance scope is recording upload and optional telephone capture. Enable each only after testing with your own provider account. None is enabled by default. Admin-only screens require Clerk private metadata `{ "admin": true }`; never make the first public registrant an administrator automatically.

## Zoom RTMS

Set `SIDETONE_ZOOM_ENABLED=true` in the app and Convex. Create your own Zoom RTMS application with audio/transcript access, OAuth redirect `https://YOUR_APP/api/zoom/oauth/callback`, and webhook endpoint `https://YOUR_WORKER/webhooks/zoom/rtms`. Dashboard-initiated RTMS uses the `meeting:update:participant_rtms_app_status` scope. Set RTMS client ID/secret and webhook secret in the appropriate app/worker environments. Configure the generated integration encryption key in the web app for stored OAuth credentials.

Build `workers/sidetone-zoom-rtms/Dockerfile` from the repository root. Run one continuously active worker during capture; in-memory sessions require shared coordination before scaling to multiple replicas. Do not deploy it to a request-only serverless runtime that freezes after webhook responses. Zoom policies and user permissions can affect capture.

## Vexa / Meet and Teams

Set `SIDETONE_VEXA_ENABLED=true`, `VEXA_API_BASE`, and `VEXA_API_KEY` in the app, and the feature flag in Convex. Use your own hosted or self-hosted Vexa installation. This repository does not provision a Kubernetes cluster. Verify admission, transcript polling, recording retrieval, and completion; do not assume a bot-start response proves capture.

## Discord

Set `SIDETONE_DISCORD_ENABLED=true` in the app/Convex and configure your Discord application's ID, public key, client secret, and bot token. Run the worker with `CONVEX_SITE_URL`, `SIDETONE_WORKER_TOKEN`, `DISCORD_BOT_TOKEN`, and `SIDETONE_APP_URL`. The OAuth callback is `/api/discord/oauth/callback`; the interaction endpoint is `/api/discord/interactions`.

Register the application's slash commands and required intents/permissions using Discord's developer tooling. The worker requires Node 22.12+ and Discord voice receive support. Its default capture maximum is 60 seconds for the feasibility test; adjust only after verifying an audible WAV and complete notes. Do not run this long-lived worker in Vercel.
