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

`GOOGLE_TOKEN_ENCRYPTION_KEY` and `ATTACHMENT_STAGING_ENCRYPTION_KEY` must each
be exactly 32 random bytes encoded as unpadded base64url. Use distinct keys.
Never reuse production keys locally or commit `.dev.vars`.

Then run the Worker. The `dev` script applies any pending local D1 migrations
before Wrangler starts:

```bash
pnpm --filter @tap-examples/tap-email-coordinator dev
```

`ALLOW_DEV_IDENTITY` is enabled only in the default local environment. The
production environment requires a TAP session that passes platform
introspection.

### Platform session contract

The coordinator treats `tap_pkg_examples_tap_email_0001` as its canonical,
collision-safe session audience. For every authenticated request it sends the
bearer token to `TAP_INTROSPECTION_URL` with this JSON body:

```json
{
  "audience": "tap_pkg_examples_tap_email_0001",
  "requiredAction": "tap-email.view"
}
```

`requiredAction` is `tap-email.view` for authenticated GET routes and
`tap-email.manage` for every authenticated mutation route. The platform must
return an active profile-bound response whose audience echoes the exact value
and whose `grantedActions` array contains the requested action:

```json
{
  "active": true,
  "profileId": "profile_…",
  "audience": "tap_pkg_examples_tap_email_0001",
  "grantedActions": ["tap-email.view", "tap-email.manage"]
}
```

Missing grants, a different audience, malformed fields, or an unavailable
introspection service fail closed. Local development remains an explicit
`ALLOW_DEV_IDENTITY=true` grant and must never be enabled in production.

`GET /health` is a process-liveness probe. `GET /ready` additionally validates
non-secret runtime configuration, queue bindings, encryption-key shape, and D1
connectivity. Neither route returns configuration or secret values.

## Production

The production environment binds the custom domain
`tap-email-coordinator.theaiplatform.app`. Confirm that domain is in the target
Cloudflare account.

The normal production path is the repository's **Deploy TAP Email Coordinator**
GitHub Actions workflow. Its required environment secrets, first-deploy
behavior, smoke tests, and rollback sequence are documented in the
[TAP Email launch runbook](../tap-email/LAUNCH.md). The commands below remain a
manual operator fallback for installing the Worker secrets:

```bash
pnpm exec wrangler secret put GOOGLE_CLIENT_ID --env production
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --env production
pnpm exec wrangler secret put GOOGLE_TOKEN_ENCRYPTION_KEY --env production
pnpm exec wrangler secret put ATTACHMENT_STAGING_ENCRYPTION_KEY --env production
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

## Mailbox pagination

`GET /v1/mailbox` returns the newest 100 cached threads plus
`pageInfo.nextCursor`. When that cursor is non-null, request the next cached page
with `GET /v1/mailbox?cursor=<opaque cursor>`. An optional `limit` from 1 through
100 may be supplied. Pages use `(received_at, account_id, thread_id)` keyset
ordering, so equal timestamps and multiple connected accounts remain stable
without relying on Gmail-specific identifiers in the client.

## Provider-visible drafts and scheduled delivery

`save_draft`, `send_draft`, and `schedule_send` share one stable TAP draft key
and monotonically increasing revision. Gmail is the durable draft store; a
retry updates or reconciles that draft before any send is attempted. A
transport failure after Gmail's send boundary is recorded as `uncertain` and
is never retried blindly.

Scheduled delivery stores an encrypted bounded draft payload in D1. Command
rows likewise keep only `{}` in their legacy JSON column and seal recipients,
body content, and outbound attachment descriptors at rest. New payload
ciphertexts use AES-GCM authenticated data bound to the table, profile,
account, row ID, and command kind, so moving ciphertext between rows fails
closed. Migration 0010
adds the ciphertext columns; bounded lazy reads and the minute scheduler
upgrade legacy unbound envelopes, encrypt, and atomically scrub any pre-0010
plaintext rows. Do not consider a
deployment migration complete until no non-empty legacy payload rows remain.

The minute scheduler turns a due row into a
separate idempotent `send_draft` command. `cancel_scheduled_send` can stop
pending or not-yet-leased delivery without deleting the Gmail draft, and the
optional cancel-on-reply policy reads the exact Gmail thread immediately
before dispatch and stops a pending send when it finds external mail newer
than the original schedule command. A failed provider check leaves the send
pending rather than guessing. `GET /v1/scheduled-sends` returns content-minimal
live rows (account, recipient, subject, due time, state, and receipt IDs); it
never returns body content.

An uncertain immediate send can be explicitly reconciled with managed
`POST /v1/commands/:commandId/reconcile`. The coordinator reuses the original
command, draft key, idempotency identity, and provider-visible Message-ID under
fenced command and draft leases. A transient reconciliation failure remains
terminal-uncertain and is never turned into an automatic resend.

Outbound attachments are selected through the host file picker, staged as
encrypted chunks in the private `ATTACHMENT_STAGING` R2 bucket, and referenced
from commands only by coordinator-issued IDs plus validated metadata. Stages
expire automatically; their R2 chunks and D1 metadata are deleted after a
confirmed provider send. An uncertain send keeps them available for exact
provider-draft reconciliation.

## Platform MCP staging

`src/mcp.ts` and `src/mcp-mail.ts` contain the tested, read-only MCP substrate
for account discovery, structured thread search, thread metadata, exact bounded
plaintext reads, and command receipts. It is intentionally not mounted by the
Worker and is not declared as a hosted package MCP server yet.

The transport calls the shared, profile-bound `MailReadPort`; the current D1
adapter maps Google-backed rows to extensible provider keys and provider-neutral
coverage revisions. Future provider adapters retain the same account-scoped port
instead of adding provider-specific tool schemas.

The ordinary TAP platform session currently proves a profile but does not
attest an MCP audience or metadata/content scopes. Mount the server only after
the host supplies a remotely verifiable `tap-email-mcp` principal with explicit
`email.metadata.read` and `email.content.read` grants. The five hosted-tool input
schemas are already staged and source-validated in
[`../tap-email/schemas/mcp`](../tap-email/schemas/mcp). They remain outside the
current signed artifact because no active contribution references them;
activation must add manifest tool contributions that reference and therefore
sign those assets. Do not forward the platform session as a package MCP header
credential or add an unlisted `/mcp` route.

## Attachments

Mailbox and thread snapshots contain bounded attachment metadata only. The
provider locator stays encrypted in D1, and attachment bytes are fetched only
after an authenticated request to
`GET /v1/accounts/:accountId/threads/:threadId/messages/:messageId/attachments/:resourceId`.
The complete tuple is authorized before Gmail is contacted. Responses are
private, non-cacheable, exact-size binary bodies capped at 8 MiB; the desktop
app places successful downloads in its integrity-checked private profile cache
and exports them only through the host-owned Save picker.
