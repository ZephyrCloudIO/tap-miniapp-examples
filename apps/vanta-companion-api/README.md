# Vanta Companion API

This Cloudflare Worker is the real inbound event layer for Vanta Companion. It receives Vanta/Svix webhooks, verifies the unmodified request body and all three Svix headers, rejects deliveries outside the 5-minute replay window, and stores each `svix-id` once in D1. The Access-protected event feed returns metadata only; raw payloads remain server-side.

## Security boundary

- `POST /v1/webhooks/vanta` is public by necessity, but every request must pass Vanta's HMAC-SHA256 signature check.
- `GET /v1/session` and `GET /v1/events` require a valid Cloudflare Access JWT with the configured issuer and audience.
- The Worker stores no Vanta OAuth token and does not proxy arbitrary Vanta API requests.
- One deployment is scoped to one TAP workspace through `WORKSPACE_ID`.
- D1's primary key on `message_id` provides durable duplicate protection. A daily scheduled handler removes rows older than `EVENT_RETENTION_DAYS`.

## Local verification

Copy `.dev.vars.example` to `.dev.vars`, replace the signing secret, then run:

```bash
pnpm types
pnpm migrate:local
pnpm test
pnpm typecheck
pnpm build
```

## Production configuration

Create a Cloudflare Access self-hosted application for the API hostname. Protect `/v1/session*` and `/v1/events*`, bypass Access for `/v1/webhooks/vanta`, and either bypass `OPTIONS` to the Worker or configure the Access application's CORS preflight response. For cross-origin desktop requests, keep the Access application cookie `SameSite=None` and allow the exact TAP host origins—never `*`.

The deployment workflow expects these GitHub environment variables:

- `VANTA_WORKSPACE_ID`
- `CF_ACCESS_TEAM_DOMAIN` (for example, `https://team.cloudflareaccess.com`)
- `CF_ACCESS_AUD`
- `TAP_ALLOWED_ORIGINS` (comma-separated exact origins)

It expects these GitHub environment secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `VANTA_WEBHOOK_SECRET`

The workflow checks for `tap-vanta-companion-events-production` and creates it when it does not exist, then applies committed D1 migrations before deploying the Worker. Its concurrency group prevents two production provisioning runs from racing.

After deployment, register `https://<api-host>/v1/webhooks/vanta` in Vanta under **Settings → Webhooks** and choose the event types the workspace is authorized to process. The application endpoint setting is the API origin only, such as `https://vanta-companion-api.example.com`.
