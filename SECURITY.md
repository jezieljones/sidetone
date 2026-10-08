# Security

Do not publish credentials, exploit details containing private data, or customer recordings in public issues. Use the repository's private vulnerability-reporting feature when enabled. If it is unavailable, ask the maintainer for a private reporting channel without posting sensitive details.

This is a developer preview, not an independently audited security product. Worker and webhook functions require server credentials; user functions must enforce owner isolation. Missing authentication configuration blocks private API access. Self-hosting does not remove your AI providers' access to data sent to them.

Operators should restrict Clerk registration for private deployments, use HTTPS and independent development/production credentials, protect provider dashboards, redact worker stream query strings in logs, and configure retention/backups. Rotate exposed credentials immediately; removing them from source does not revoke them.

The current tests cover worker authorization, owner isolation, self-hosted entitlements, transcript processing, and optional-source gates. See `docs/release-validation.md` for live-provider and container validation status.
