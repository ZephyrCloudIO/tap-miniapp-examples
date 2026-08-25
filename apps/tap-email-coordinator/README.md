# TAP Email coordinator

The coordinator is the account-scoped cloud boundary between TAP Email and
Gmail. It owns Google OAuth credentials, the encrypted mailbox read model,
coverage state, reminders, and the durable command outbox. The miniapp never
receives a Google refresh token or calls Gmail directly.

## Google setup

1. Create a Google Cloud OAuth web client and enable the Gmail API.
2. Register the local and production callback URLs from `wrangler.jsonc`.
3. Configure the consent screen for `openid`, `email`, and
   `https://www.googleapis.com/auth/gmail.modify`.
4. Complete Google's verification requirements before using the restricted
   Gmail scope outside an approved test-user group.

## Local development

Copy the ignored example file and fill in local credentials:

```bash
cp .dev.vars.example .dev.vars
```

`GOOGLE_TOKEN_ENCRYPTION_KEY` must be exactly 32 random bytes encoded as
unpadded base64url. Never reuse the production key locally or commit
`.dev.vars`.

Then prepare and run the Worker:

```bash
pnpm --filter @tap-examples/tap-email-coordinator migrate:local
pnpm --filter @tap-examples/tap-email-coordinator dev
```

`ALLOW_DEV_IDENTITY` is enabled only in the default local environment. The
production environment requires a TAP session that passes platform
introspection.

`GET /health` is a process-liveness probe. `GET /ready` additionally validates
non-secret runtime configuration, queue bindings, encryption-key shape, and D1
connectivity. Neither route returns configuration or secret values.

## Production

The production environment binds the custom domain
`tap-email-coordinator.theaiplatform.app`. Confirm that domain is in the target
Cloudflare account, then install each secret through Wrangler's interactive
prompt:

```bash
pnpm exec wrangler secret put GOOGLE_CLIENT_ID --env production
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --env production
pnpm exec wrangler secret put GOOGLE_TOKEN_ENCRYPTION_KEY --env production
```

Run the credential-independent release gate, apply migrations, and deploy:

```bash
pnpm run release:check
pnpm run migrate:production
pnpm run deploy:production
curl --fail https://tap-email-coordinator.theaiplatform.app/health
curl --fail https://tap-email-coordinator.theaiplatform.app/ready
```

Rotate `GOOGLE_TOKEN_ENCRYPTION_KEY` only with an explicit data-migration plan;
existing encrypted credentials and bodies depend on it. Verify the production
redirect URI, TAP introspection URL, allowed origin, and miniapp coordinator
origin before connecting a real mailbox.

Every mailbox sync is persisted as a provider event before queue dispatch. The
consumer claims it with a lease, retries transient reads with bounded backoff,
dead-letters exhausted or permanent failures, and lets the scheduled handler
redispatch interrupted work. Queue payloads are validated again at the Worker
boundary before any account-scoped operation runs.
