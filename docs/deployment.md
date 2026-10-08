# Deployment and recovery

## Managed services, your infrastructure

The v0.1 quick start runs the web application and optional realtime worker on any Docker/Node host, with the operator's own Clerk, Convex, Inngest, OpenAI, AssemblyAI, and optional Telnyx accounts. No original production infrastructure is contacted.

Use separate development/production keys. Configure HTTPS, application domains in Clerk, a `convex` JWT template, externally reachable job callbacks, and signing verification. Do not expose an unauthenticated Inngest development server on the public internet.

The web server's `/health` endpoint is a liveness/configuration summary, not a functional-provider test. Run the fresh-account validation checklist before inviting users.

## More self-hosting

Convex and Inngest both offer their own self-hosting guides:

- [Convex self-hosting](https://docs.convex.dev/self-hosting)
- [Inngest self-hosting](https://www.inngest.com/docs/platform-and-operations/self-host-inngest)

You may point Sidetone at your own deployments. Supply the actual Convex client and HTTP-actions URLs; do not derive them by replacing `.cloud` when using custom/self-hosted hosts. Use `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` only in the local Convex administration environment, never browser configuration.

Clerk remains a hosted authentication dependency in this release. A fully offline stack, alternate authentication, and bundled Convex/Inngest infrastructure are not implemented. Do not advertise this preview as a one-command offline application.

## Backups and upgrades

The web/realtime containers are stateless. Back up your Convex data and file storage using your deployment's supported snapshot/export facilities; test a restore. Self-hosted Convex/Inngest need durable volumes and their own backups. Never prune their volumes as part of routine application upgrades.

Before upgrading, record the current application commit/image, back up backend data, read schema changes, deploy compatible Convex functions/schema first, then replace the web/worker containers. Test a recording after each update. A web-image rollback alone cannot reverse a destructive database migration.

## Troubleshooting

- Setup page instead of sign-in: missing Clerk public/private configuration or the public Convex URL. Rebuild for changed browser variables.
- Signed in but Convex says unauthenticated: verify the Clerk JWT template is named `convex`, audience is `convex`, and issuer matches `CLERK_JWT_ISSUER_DOMAIN` on that backend.
- Upload saved but never processed: check Inngest app sync, event destination, signing keys, and actual function runs. Inspect the worker token and explicit Convex HTTP-actions URL.
- Phone connects with no transcript: verify worker WebSocket reachability, stream secret, worker token, AssemblyAI key, and native call merge.
- Realtime worker refuses startup: complete all worker credentials; never disable authentication to make it start.
- Oversized transcript: split the recording. The app intentionally fails instead of silently summarizing only the beginning.
- Large upload rejected on Vercel: use the container deployment; this version sends uploaded audio through the web route.
