# Your own Telnyx account

1. Create an API key and obtain the account's Ed25519 webhook public key. Keep the API key server-side.
2. Create a Call Control application. Set its webhook URL to `https://YOUR_APP/api/telnyx/call-control` and attach an outbound voice profile if using outbound call-through.
3. Set `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, and `TELNYX_CALL_CONTROL_CONNECTION_ID` in the web app. Use the same appropriate Telnyx settings in Convex via the configuration script.
4. Run the realtime container. Set its `CONVEX_URL`, `ASSEMBLYAI_API_KEY`, `SIDETONE_WORKER_TOKEN`, and `SIDETONE_STREAM_SHARED_SECRET`. Both internal secrets must contain at least 32 characters and be distinct.
5. Expose the worker behind HTTPS with WebSocket upgrade support, and set `SIDETONE_REALTIME_URL=https://YOUR_WORKER`. The app derives `wss://YOUR_WORKER/telnyx/media-stream`. Redact query strings in proxy access logs because stream URLs carry a stream credential.
6. Enable `SIDETONE_PHONE_ENABLED=true` in the web app and Convex, rebuild/restart as needed, and configure a verified owner phone number in Clerk. Use the dashboard to provision/assign a number. Number provisioning incurs charges on your Telnyx account.
7. Make a short test call with a consenting participant. Verify signed webhook delivery, actual transcript text, recording playback, completed notes, and a Call Doc. A health endpoint or a received webhook alone is insufficient.

Calling is optional. Do not configure telephone services merely to upload recordings. In self-hosted mode no Stripe subscription is needed, but Telnyx/AssemblyAI/OpenAI usage is still billed by those providers.

The default maximum call duration is 120 minutes. Set `SIDETONE_MAX_CALL_MINUTES` (1–360) in Convex to change it. The background monitor enforces it while Inngest is healthy; provider-level spend limits remain necessary for hard account-wide caps.

## Optional SMS

Enable `SIDETONE_SMS_ENABLED=true` only after configuring `TELNYX_MESSAGING_PROFILE_ID` and `SIDETONE_OWNER_SUMMARY_SMS_FROM_NUMBER` in both web and Convex environments. Configure messaging delivery events at `https://YOUR_APP/api/telnyx/messages`. Complete any sender registration required by Telnyx for your use. Leave SMS disabled if you only need notes in the app.

Phone calls may automatically create a share link for the owner-summary text when SMS is explicitly enabled. Tell users about that behavior and retain their ability to disable sharing.
