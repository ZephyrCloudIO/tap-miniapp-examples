# Quickmail review for TAP Email

Date: 2026-08-18

Repository: [DivinPrince/quickmail](https://github.com/DivinPrince/quickmail)

Reviewed commit: [`9bb5b74f99690b7ae55a069462a56b0bb551edde`](https://github.com/DivinPrince/quickmail/tree/9bb5b74f99690b7ae55a069462a56b0bb551edde)

## Executive conclusion

Quickmail supports the case for a cloud component, but it does not support a cloud-only design for TAP Email.

Quickmail is a small self-hosted mail system for domains that the operator owns. It receives and sends mail through Resend or Cloudflare Email, stores mailbox records in D1, stores attachments in R2, and renders a SvelteKit web client. It is not a Gmail client, an offline client, a keyboard-first client, or an AI/MCP product. The project states this scope directly in its [README](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/README.md#L1-L17) and allows only one configured provider per deployment in its [provider comparison](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/README.md#L21-L44).

The strongest reusable ideas are:

1. Event-driven cloud ingestion instead of client polling.
2. A small provider adapter between product code and mail delivery infrastructure.
3. Separate structured records and attachment blobs.
4. Idempotent webhook handling and explicit delivery states.
5. A combined view with a fast single-domain filter.
6. A visible destination for mail that the router cannot assign.
7. Scriptless, isolated rendering for received HTML.

The strongest warnings are:

1. Persist the send intent before calling the provider.
2. Do not perform the full ingestion transaction inside a webhook request.
3. Do not treat an event-claim row as a complete durable inbox.
4. Do not write a blob and its database record without reconciliation.
5. Do not infer Gmail threads from subjects and participants.
6. Do not use SQL `LIKE` body search as the long-term search architecture.
7. Do not use this UI as the interaction model for TAP Email.
8. Do not ship a daily-driver mailbox without automated tests and reproducible locks.

## What Quickmail is

Quickmail deploys one SvelteKit application to Cloudflare Workers. D1 stores users, sessions, messages, domains, addresses, delivery state, and attachment metadata. R2 stores attachment bytes. The deployment selects either Resend or Cloudflare Email through `EMAIL_PROVIDER`; it does not connect an existing Gmail mailbox. See the [Worker configuration](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/wrangler.jsonc), [initial schema](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/migrations/0001_init.sql), and [domain/address migration](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/migrations/0005_resend_domains.sql).

Inbound Resend notifications arrive as signed webhooks. The Worker then fetches the message body and attachments from Resend. Cloudflare Email instead invokes the Worker's `email()` handler with the MIME stream. Both paths converge on the same D1/R2 storage functions. See [Resend inbound handling](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/inbound.ts), the [webhook endpoint](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/routes/api/webhooks/resend/%2Bserver.ts), the [Worker entry point](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/worker.ts), and [Cloudflare MIME ingestion](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/cloudflare-inbound.ts).

This difference matters: Quickmail is the receiving mailbox. TAP Email connects to Gmail, which remains authoritative. TAP Email must consume Gmail change history and reconcile a replica; it must not adopt Quickmail's D1 database as a second mailbox authority.

## Architecture lessons to adopt

### 1. Put continuous provider coordination in the cloud

Quickmail can receive mail while no browser is open because its Worker is the delivery endpoint. That property is a strong match for TAP Email's need to renew provider watches, process changes, run summaries, and support tools while the desktop application is closed. Quickmail documents the two push paths in its [README](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/README.md#L21-L44).

For TAP Email, adapt the pattern as follows:

- Gmail notification enters a cloud endpoint.
- The endpoint durably records the notification and acknowledges it quickly.
- An account-scoped processor advances the Gmail history cursor.
- The processor emits idempotent deltas for the local SQLite replica.
- The cloud service publishes derived facts for Home, Chloe, workflows, and MCP.

The cloud service must not replace the local SQLite cache. Cached navigation, drafting, local search, and offline mutations remain local requirements.

### 2. Keep a provider adapter

Quickmail places provider-specific send and domain operations behind a small `EmailProvider` contract. Resend and Cloudflare implementations map their own errors and capabilities into that contract. See the [provider interface](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/email-provider.ts), [Resend adapter](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/providers/resend-provider.ts), and [Cloudflare adapter](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/providers/cloudflare-provider.ts).

TAP Email should use a richer account-scoped provider port. It should cover:

- authenticate and revoke;
- start and renew change notification;
- advance history;
- fetch messages and attachments;
- structured provider search;
- create and update drafts;
- send with a stable idempotency key;
- mutate labels, read state, archive state, and trash state;
- expose provider capability and coverage status.

Google is the only v0 implementation. The interface prevents Gmail details from leaking into the UI, local replica, tools, and derived-data model.

### 3. Separate database records from attachment blobs

Quickmail moved attachment bytes from D1 base64 columns to R2 objects while retaining attachment metadata in D1. Downloads first prove ownership by joining the attachment to the user's message. See the [attachment migration](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/migrations/0004_attachment_r2.sql), [attachment store](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/attachments.ts), and [authorized download route](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/routes/api/mail/%5Bid%5D/attachments/%5BattachmentId%5D/%2Bserver.ts).

TAP Email should keep the same conceptual separation:

- SQLite: message metadata, cached bodies, sync cursors, reminders, derived facts, and mutation state.
- Scoped files: attachment bytes and search-index segments.
- Cloud object storage: only data required for cloud workflows or explicitly selected retention.

TAP Email must add a reconciler because database and blob writes are not one transaction.

### 4. Treat provider events as replayable and idempotent

Quickmail verifies the raw signed webhook body, accepts both current signature header names, enforces a five-minute timestamp window, compares signatures without early exit, and claims webhook IDs before processing. See [signature verification](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/webhook.ts) and [webhook claiming](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/routes/api/webhooks/resend/%2Bserver.ts).

TAP Email should preserve the verification and idempotency principles. It should use a stronger durable-inbox state machine:

- `received`;
- `processing` with an expiring lease;
- `applied` with the resulting cursor;
- `retryable` with the next attempt;
- `dead_letter` with a visible coverage failure.

This prevents a process failure after event claim from turning into a silent permanent drop.

### 5. Never lose unassignable input silently

Quickmail routes inbound mail by exact address, then catch-all owner, then an `unrouted_emails` table that the administrator can inspect. See the [routing schema and rationale](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/migrations/0005_resend_domains.sql) and the [inbound route](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/inbound.ts).

TAP Email needs the equivalent for synchronization, classification, and tool execution. Every input must end as applied, duplicate, deferred, rejected with reason, or visible dead letter. Operational Zero and critical-coverage claims must fail closed while any account has an unresolved synchronization dead letter.

Unlike Quickmail's metadata-only unrouted record, TAP Email should preserve a recoverable Gmail account/message handle so the item can be replayed after repair.

### 6. Reuse combined and filtered identity views

Quickmail supports a combined mailbox and a domain-specific filter. It also binds each send to an address owned by the active user. See the [domain-aware mailbox query](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/mail-store.ts), [sender resolution](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/outbox.ts), and [compose identity selector](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/routes/compose/%2Bpage.svelte).

This validates TAP Email's unified-by-default and single-account-on-demand model. TAP must use immutable account and alias IDs rather than domain IDs, and every write must carry the account identity explicitly.

### 7. Isolate received HTML from the application document

Quickmail renders message HTML in a `srcdoc` iframe without `allow-scripts`, adds `noopener noreferrer` to links, sets `referrerpolicy="no-referrer"`, adapts ordinary correspondence to dark mode, preserves designed mail on a white canvas, and collapses quoted history. See [EmailBody](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/components/EmailBody.svelte) and [email document construction](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/utils/email-html.ts).

TAP Email should adopt the separate-document rendering model. It should add sanitized markup, a restrictive content security policy, a host-controlled remote-resource policy, safe URL handling, and explicit protection against nested active content. Remote images can remain enabled by default because that requirement is already settled, but the miniapp setting must be enforceable at the renderer network boundary.

### 8. Keep delivery evidence provider-specific

Quickmail distinguishes Resend's queued and delivery webhook states from Cloudflare Email's accepted-send state. It does not claim final delivery when the provider lacks that evidence. See [`initialOutboundStatus`](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/email-provider.ts) and [delivery event mapping](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/inbound.ts).

TAP Email should use a normalized state model but preserve evidence provenance. Gmail API acceptance can prove that Gmail accepted the send. It must not be presented as recipient delivery unless the provider supplies that evidence.

## Patterns to reject or strengthen

### 1. Do not call the provider before persisting the outbox item

Quickmail's `sendAndStore` calls the provider and only then inserts the sent message into D1. The idempotency key defaults to a new UUID inside the provider call and is not first stored as durable intent. A provider success followed by a D1 failure can produce a sent message that the product does not record; a retry can use a new key. See [sendAndStore](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/outbox.ts) and [sendOutboundEmail](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/send-mail.ts).

TAP Email must use a transactional outbox:

1. Store the exact send intent and stable idempotency key.
2. Commit it as `undo_window` or `ready`.
3. Let the cloud coordinator claim it with a lease.
4. Call Gmail once for that idempotency identity.
5. Record provider acknowledgement and reconcile the Gmail thread.
6. Surface uncertain outcomes instead of retrying blindly.

### 2. Do not write blobs without a repair protocol

Quickmail writes the R2 object before it inserts the D1 metadata row. A metadata failure can leave an orphaned object. Its permanent-delete path deletes R2 objects before deleting D1 records, which can leave metadata that references a missing object if the later database operation fails. See [attachment insertion](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/attachments.ts) and [permanent deletion](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/mail-store.ts).

TAP Email should stage blobs under an operation ID, commit metadata, promote the blob, and run a bounded reconciler for stale stages and missing objects.

### 3. Do not infer Gmail conversation boundaries

Quickmail uses `In-Reply-To` and `References` when available. Because one provider does not return the outbound wire Message-ID, it falls back to normalized subject, overlapping participants, and a 180-day window. See the [thread resolver](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/threads.ts) and [thread backfill](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/migrations/0007_threads.sql).

That is a pragmatic fallback for an independent mail server. TAP Email must not use it for Gmail. The settled provider-native thread boundary is safer and prevents unrelated messages with the same subject from merging.

### 4. Do not use the mailbox query as the TAP search architecture

Quickmail searches subject, sender, recipient, and body with wildcard `LIKE`, counts distinct thread IDs, and uses offset pagination. See [`buildScope` and `listMailbox`](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/mail-store.ts).

This is appropriate for a small personal deployment. TAP Email needs:

- indexed local structured search;
- stable cursor pagination;
- immediate local results;
- Gmail search fallback for uncached history;
- account-aware deduplication and coverage reporting.

### 5. Do not copy the interaction model

Quickmail is a conventional click-first web mailbox. The source has no keyboard command registry, `J/K/E/H` loop, command palette, auto-advance, Remind Me, Operational Zero, Priority/Other model, or achievement layer. Mailbox actions generally call an API and then invalidate the server-rendered state; only some row state, such as stars, is changed optimistically. See [MailboxView](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/components/MailboxView.svelte).

Compose is a full page. Draft saving is a manual button, not continuous autosave, and the editor uses the deprecated `document.execCommand` API. See [compose](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/routes/compose/%2Bpage.svelte), [draft endpoint](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/routes/api/drafts/%2Bserver.ts), and [RichTextEditor](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/components/RichTextEditor.svelte).

Superhuman remains the correct interaction reference for TAP Email. Quickmail is an infrastructure reference.

### 6. Strengthen tenant isolation

Quickmail uses one D1 database and includes `user_id` checks in message, draft, and attachment queries. This is a useful baseline, but it makes isolation depend on every query including the correct predicate. See [mail-store ownership predicates](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/mail-store.ts) and [attachment ownership lookup](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/attachments.ts).

TAP Email should derive tenant and account scope from the authenticated capability, not from caller-supplied IDs alone. Repository functions should receive an already scoped account store. Cross-account writes must require both the scoped capability and the immutable account ID. Cloud state should be partitioned by TAP profile and Google account, with encryption keys and idempotency namespaces derived from that partition.

### 7. Add application-level data protection and retention controls

Quickmail stores message bodies directly in D1 columns and attachment bytes directly in R2. The source does not implement per-user content encryption or a content-retention state machine. See the [message schema](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/migrations/0001_init.sql) and [R2 writes](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/src/lib/server/attachments.ts).

TAP Email already has a stricter boundary: Gmail is canonical, raw bodies are fetched as needed, cloud retention is short by default, and local caches are encrypted. Keep that boundary.

### 8. Require a stronger release gate

At the reviewed commit, the repository has no automated test or specification files. `package.json` exposes build and Svelte type-check scripts but no test script. See [package.json](https://github.com/DivinPrince/quickmail/blob/9bb5b74f99690b7ae55a069462a56b0bb551edde/package.json) and the [commit tree](https://github.com/DivinPrince/quickmail/tree/9bb5b74f99690b7ae55a069462a56b0bb551edde).

Local verification produced these results:

- `bun install --frozen-lockfile`: passed.
- `bun run check`: passed with zero diagnostics.
- `bun run build`: passed.
- `npm ci`: failed because `package-lock.json` does not match `package.json`; the lock contains `postal-mime` 2.7.4 while the manifest requires 3.0.0 and omits current transitive types.

The build emitted the full Remix Icon font family, including a roughly 3 MB SVG asset and several 189-613 KB font files. TAP Email should use a small, tree-shaken icon set and enforce the settled startup and interaction budgets.

TAP Email needs automated coverage for provider replay, history gaps, idempotent mutations, outbox recovery, draft conflict, account isolation, route isolation, HTML safety, attachment reconciliation, keyboard commands, and performance budgets.

## Tools and MCP lesson

Quickmail does not implement MCP. An open first-party issue proposes `list_threads`, `get_thread`, `search_mail`, `send_message`, `reply`, and attachment tools, with authentication shared by a possible CLI. See [issue #6](https://github.com/DivinPrince/quickmail/issues/6) and [issue #5](https://github.com/DivinPrince/quickmail/issues/5).

The proposed tool list is a useful minimum inventory, but TAP Email needs one canonical service API rather than separate UI, CLI, MCP, specialist, and workflow implementations. Writes require explicit account identity, idempotency, authorization, and confirmation policy. Reads can span selected accounts and must report coverage.

## Recommended TAP Email shape after this review

```text
Gmail
  |
  | watch notification + history API + typed mutations
  v
TAP Email cloud coordinator
  - Google credentials
  - notification inbox and replay
  - per-account history cursor
  - single mutation writer
  - scheduled send and due reminders
  - derived facts and summary snapshots
  - capability API for UI, Chloe, workflows, specialist, and MCP
  |
  | account-scoped deltas, commands, and acknowledgements
  v
Encrypted local profile storage
  - SQLite read model
  - attachment and search-index files
  - optimistic state
  - offline mutation queue
  |
  v
TAP Email panel
```

The cloud coordinator is package-owned and platform-hosted. Other miniapps receive no route to it unless the host grants a specific capability. A shared deployment can serve multiple TAP Email users, but every database, object, queue, idempotency, log, and tool operation is partitioned by authenticated TAP profile and Google account.

The cloud coordinator is the only TAP component that writes to Gmail. Local actions change the local read model immediately and enqueue a stable command. The coordinator applies the command once, records the provider result, and sends the acknowledgement back to every local replica.

## V0 adopt/adapt/avoid table

| Quickmail pattern | TAP Email decision | Reason |
| --- | --- | --- |
| Cloud event receiver | Adopt | Sync continues while the desktop application is closed. |
| Provider adapter | Adopt and expand | Keeps Gmail outside the product and tool layers. |
| D1 metadata plus R2 blobs | Adapt | Use D1-like cloud state only where needed; keep the responsive replica in local SQLite. |
| Combined domains plus one-domain filter | Adapt | Maps well to unified and single-account views. |
| Signed, idempotent webhook | Adopt and strengthen | Add a durable inbox, leases, retry state, and dead letters. |
| Unrouted-mail view | Adopt as coverage failures | No synchronization or classification failure can disappear silently. |
| Scriptless iframe rendering | Adopt and strengthen | Add sanitization, CSP, and host-enforced remote-resource policy. |
| Delivery-status normalization | Adopt with provenance | Never claim recipient delivery without provider evidence. |
| Send, then insert record | Reject | Can create unrecorded sends and duplicate retries. |
| R2 write, then D1 row | Reject without reconciliation | Can create orphaned or missing attachment state. |
| Subject/participant threading | Reject for Gmail | Gmail thread identity is authoritative. |
| SQL `LIKE` body search | Reject as scale path | Does not satisfy fast hybrid local/provider search. |
| Click-first mailbox UI | Reject | Does not support the keyboard-first daily-driver goal. |
| Manual draft save | Reject | TAP Email requires continuous local-first autosave. |
| Cloud-only mailbox | Reject | Breaks offline use and latency budgets. |
| No automated tests | Reject | Mail safety requires a release-blocking reliability suite. |

## Bottom line

Quickmail is evidence for a package-owned cloud mail coordinator. It is not evidence for removing local storage or for adopting its UI. The correct TAP Email architecture remains hybrid: an always-on cloud coordinator for Google synchronization and shared tools, plus an encrypted local SQLite replica for speed, offline operation, and keyboard-first interaction.
