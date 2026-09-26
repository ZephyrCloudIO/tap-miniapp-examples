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

Introspection and Directory requests use `redirect: 'manual'` and reject 3xx
responses without following `Location`, so authorization headers stay at the
configured authority. The pinned Workers runtime rejects `redirect: 'error'`
during request construction, before any network request. Auth tests construct
real Workers `Request` objects to catch this class of runtime incompatibility.

`GET /health` is a process-liveness probe. `GET /ready` additionally validates
non-secret runtime configuration, queue bindings, encryption-key shape, and D1
connectivity. Neither route returns configuration or secret values.

## Production

Conversation detail reads use `GET /v1/accounts/:accountId/threads/:threadId`
with an optional `cursor` query parameter. Each response includes
`thread.providerRevision` and `thread.pageInfo: { nextCursor, complete }`.
Pages visit newest messages first, with messages inside each page in chronological
order. Cursors bind the profile, account, thread, and provider revision; a
`409 thread_changed` requires restarting at the first page.

Pages contain at most 20 messages and target 2 MiB of serialized UTF-8 JSON,
including the response envelope and cursor. One heavily escaped message may
exceed the target, up to the shared 8 MiB producer/client ceiling. Bodies and
attachment metadata are preserved. Oversized provider threads retain all message
identities and fetch older bodies on demand. Failed body reads return actionable
errors rather than successful empty messages.

Apply migration `0014_conversation_history.sql` before deploying this coordinator,
then release the matching email client. The migration marks previously cached
conversations for refresh on their next read because earlier versions may have
discarded messages beyond the newest 20. The new client requires explicit page
information and provides “Load older messages” and retry controls.

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

Manual queue-delivery recovery is intentionally separate from the manual deploy
commands above. Never resume a queue that an incident owner intentionally paused.

For a mailbox-sync queue whose API response has no delivery state, first inspect
its live state and backlog in the Cloudflare dashboard. If it was not
intentionally paused, initialize only mailbox-sync delivery:

```bash
pnpm exec wrangler queues resume-delivery tap-email-sync-production
```

The command queue can archive, label, draft, or send mail. Before considering a
command-queue resume, inspect its Cloudflare delivery state and backlog, confirm
its consumer configuration, and count pending command kinds without reading
message content:

```bash
pnpm exec wrangler queues info tap-email-commands-production
pnpm exec wrangler queues consumer list tap-email-commands-production --json
pnpm exec wrangler d1 execute DB --remote --env production --command \
  "SELECT kind, state, COUNT(*) AS command_count FROM mail_commands WHERE state IN ('accepted', 'leased', 'retryable') GROUP BY kind, state ORDER BY kind, state;"
```

Queued command delivery can execute accumulated outbound actions. Resume it only
after the incident owner explicitly authorizes those actions to proceed. Keep
this command out of deployment and inspection copy/paste blocks:

```bash
pnpm exec wrangler queues resume-delivery tap-email-commands-production
```

The automated workflow preserves every explicit pause, automatically
initializes only a missing mailbox-sync delivery state, and fails closed when
the command queue's delivery state is not explicitly active.

After a manual deploy, also confirm both queues still name
`tap-email-coordinator-production` as their Worker consumer and retain their
configured dead-letter queues with `wrangler queues consumer list <queue>`.
The automated production workflow performs this check and reports each live
queue backlog.

`Monitor TAP Email Coordinator` runs every five minutes and can also be started
manually after a release. It performs read-only Cloudflare Queue and aggregate
D1 checks, opens one deduplicated GitHub issue when delivery, topology,
dead-letter, backlog-age, or durable-progress checks fail, and closes that issue
after recovery. Monitor output contains operational counts and timestamps only;
it never queries or prints mailbox identifiers, subjects, bodies, or recipients.
The monitor never resumes either queue. Configure the production Environment
secret `CLOUDFLARE_MONITOR_API_TOKEN` with only account-scoped `Queues Read` and
`D1 Read`; the workflow temporarily falls back to the deployment token so
monitoring remains active while that least-privilege credential is provisioned.

Rotate `GOOGLE_TOKEN_ENCRYPTION_KEY` only with an explicit data-migration plan;
existing encrypted credentials and bodies depend on it. Verify the production
redirect URI, TAP introspection URL, allowed origin, and miniapp coordinator
origin before connecting a real mailbox.

Every mailbox sync is persisted as a provider event before queue dispatch. The
consumer claims it with a lease, retries transient reads with bounded backoff,
dead-letters exhausted or permanent failures, and lets the scheduled handler
redispatch interrupted or accepted-but-never-leased work. Duplicate deliveries
that lose the durable claim are acknowledged, and the claim lease exceeds the
maximum Queue consumer invocation, so they cannot overtake active work. Queue
payloads are validated again at the Worker boundary before any account-scoped
operation runs.

## Mailbox pagination

`GET /v1/mailbox` returns the newest 100 cached threads plus
`pageInfo.nextCursor`. When that cursor is non-null, request the next cached page
with `GET /v1/mailbox?cursor=<opaque cursor>`. An optional `limit` from 1 through
100 may be supplied. Pages use `(received_at, account_id, thread_id)` keyset
ordering, so equal timestamps and multiple connected accounts remain stable
without relying on Gmail-specific identifiers in the client.

Every page is additive and includes a `pageInfo.revision` watermark. Connection
polls use the same page merge. Head refresh runs independently of historical
loading, including when a device resumes a saved history cursor. A completed
timestamp-ordered traversal alone is **not** proof that absent rows were deleted:
provider writes can move rows between those pages.

`GET /v1/mailbox/changes?after=0` bootstraps a complete reconciliation. Each
response includes `mailbox`, `pageInfo.revision`, and `changes` containing
`nextRevision`, `hasMore`, and account-scoped `deletedThreads`. Follow
`nextRevision` until `hasMore` is false; subsequent polls start from that revision.
The same optional `limit` bounds the number of change identities to 100. Account
metadata markers consume slots even when no thread is returned. Accounts are a
complete list on every response. Rows, previews, tombstones, and the watermark
are read together in a [D1 batch transaction](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

Migration `0013_mailbox_changes.sql` seeds existing threads and records projection
writes in the same transaction as their source rows. The stream retains the
latest revision of each identity and durable deletion tombstones; it does not
expire cursors or discard tombstones. Repeated changes move an identity forward
in revision order, so replay catches mutations during traversal. Only a finished
bootstrap may remove unseen cached rows, and it preserves rows received from a
newer concurrent head response. Per-identity revision guards prevent late history
pages from reverting metadata or restoring deleted threads. Local commands and
their optimistic intents remain separate from the provider projection.

Change cursors are session-only: interruption retries the last applied revision,
and app restart replays from zero. This costs one bounded traversal per startup
but prevents a durable cursor from skipping rows after a failed cache save. A
future durable delta checkpoint must commit rows and cursor together. Historical
page checkpoints capture the corresponding React state and serialize the row
save before the cursor save; a failed save leaves the prior checkpoint intact.

Rollout order: apply migration 0013, deploy the coordinator, then publish the
miniapp. The new client rejects unversioned coordinator pages and retains its
device cache. Older clients can continue reading the existing page endpoint.

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

## HTML and referral attribution

TAP drafts default to preferred HTML with a plain-text MIME alternative. The
generated `Sent with TAP Email on The AI Platform` footer is added only to the
final send. Reused Gmail drafts retain provider-side edits and attachments.

New production send/schedule commands require the SDK 0.19 `expectedContext`.
Session/action verification plus authenticated Directory lookups establish the
canonical sender/workspace. Migration 0015 stores the profile/user binding and
immutable command attribution. Apply it before deploying this coordinator.

The `WEBSITE_REFERRALS` Service Binding targets the website's named
`WebsiteReferralsPublisher` entrypoint. It must be deployed in the same account:
`tap-website-referrals-production` in production, `tap-website-referrals-dev`
locally. Returned links are persisted before sending and reused on retries.
Website owns `/refer/:token`, redirects, and `tap_email_referral_clicked` PostHog
events; this coordinator does not generate click events on send. Referral
unavailability leaves sends pending for retry.

Production rollout still needs deployed session/Directory verification and the
background TAP send-permission recheck tracked in upstream #11055. Current
execution checks the connected Gmail account but does not recheck revoked TAP
workspace/action grants. See [implementation and rollout notes](../../research/tap-email-sent-with-attribution.md).

## Platform MCP

`src/mcp.ts` and `src/mcp-mail.ts` expose the authenticated live Email MCP.
It includes account listing, coverage-aware metadata search, exact plaintext reads,
provider draft saves, sends through the existing command queue, and receipt lookup.
SDK 0.19 packages register this server and its signed input schemas.

The `/mcp` route accepts only the scoped, expiring token created in TAP Email
settings, supplied through TAP's host-held `tap-email-access-token` credential.
Ordinary platform sessions cannot access MCP. The authenticated platform session
can create, inspect, or revoke its own credential at `/v1/mcp/credential`; token
creation/revocation requires `tap-email.manage`. MCP tokens cannot use that route.
Write-enabled tokens also capture the Session/Directory-verified sending user and
workspace at creation; sends preserve that attribution and the existing referral pipeline.

Apply migration `0016_mcp_credentials.sql` before deploying this version. The
`/v1/activity/receipts` route supplies bounded, profile-scoped command receipts to
Email's local activity ledger without returning mail content. Draft payloads are
read one at a time to bound memory. See [ADR 0005](../tap-email/docs/adr/0005-sdk-019-activity-and-email-tools.md)
for release, host connection, permissions, and activity coverage details.
