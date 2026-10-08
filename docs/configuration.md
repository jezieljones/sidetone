# Configuration

Canonical template: `apps/sidetone/.env.example`. Keep private values in `.env.local` or your hosting platform's secret manager. Never prefix a private credential with `NEXT_PUBLIC_`. These public prefixes are intentionally embedded in browser bundles.

| Runtime | Required settings |
| --- | --- |
| Web app | Clerk public/secret keys; public Convex URL; Convex HTTP-actions URL; both app URLs; OpenAI and AssemblyAI keys; worker token; Inngest connection/signing settings |
| Convex | Clerk JWT issuer; OpenAI key; worker token; app URL; billing and feature flags; Inngest event key/base URL; optional Telnyx/SMS settings |
| Realtime worker | `CONVEX_URL` (same value as the public Convex client URL), AssemblyAI key, worker token, stream secret |
| Zoom worker | Convex HTTP-actions URL, worker token, Zoom RTMS client ID/secret, webhook secret |
| Discord worker | Convex HTTP-actions URL, worker token, bot token, `SIDETONE_APP_URL` |

`npm run convex:configure` synchronizes the backend subset using a temporary file with owner-only permissions. It does not copy the Clerk secret key, AssemblyAI key, or Inngest signing key to Convex. Those belong in the app/appropriate worker. Configure the matching worker token in every runtime that needs trusted writes. Generate different stream and worker secrets; do not reuse provider API keys for internal authentication.

## Defaults

- Billing and all optional capture sources are disabled.
- Upload/transcription/notes use the core accounts.
- SMS requires an explicit flag, sender, and messaging profile.
- No fallback points to the original production domain.
- Blank authentication blocks API access and sends private pages to setup.
- The realtime worker refuses to start without its credentials.
- Webhook verification is mandatory in production.

`SIDETONE_BILLING_ENABLED=true` retains the original hosted-billing code for advanced deployments. It requires Stripe secrets/prices and a separately validated billing configuration. The self-hosted quick start does not enable or test that path.

Use `SIDETONE_POST_CALL_MODEL`, `SIDETONE_SHARED_CHAT_MODEL`, `SIDETONE_CALL_INTELLIGENCE_MODEL`, and the documented live-card model settings to choose models your account supports. They select OpenAI model IDs, not arbitrary compatible-provider endpoints. Local-model support is not implemented.

For optional advanced notes-lab experiments, the existing adapters accept `ANTHROPIC_API_KEY` or `GOOGLE_API_KEY` / `GEMINI_API_KEY`. They are unnecessary for the core installation.
