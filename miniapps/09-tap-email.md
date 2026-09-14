# TAP Email

**Catalog:** Miniapp 9

**Status:** Locked; live v0 implemented, deployment configuration required

**Audience:** Consumer

**Data approach:** Package-owned cloud Gmail coordinator with encrypted tokens
and message bodies; package-scoped private profile SQLite and vector storage
through SDK 0.15.0

## Product promise

TAP Email is the keyboard-first daily email driver inside TAP. It matches the
interaction quality and keyboard philosophy of Superhuman while differentiating
through a genuine unified multi-account inbox, email-to-conversation handoff,
specialist and workflow access, coverage-aware critical-mail protection, and
platform-level daily and weekly summaries.

The default outcome is **Operational Zero**: no actionable or critical thread is
silently missed. FYI and automated mail may remain outside the active queue.
Every zero claim is conditional on visible per-account sync coverage.

## Locked v0 decisions

- Google is the first and only provider, but provider details stay behind a
  provider port.
- Multiple Google accounts are supported from day zero. The default is a
  unified view with an immediate single-account view.
- Gmail owns messages, provider threads, ordinary drafts, labels, read state,
  stars, archive, trash, and sent state.
- TAP owns unified queues, priority, reminders, obligations, sentiment,
  summaries, achievements, conversation links, workflow provenance, and
  coverage receipts.
- A cloud coordinator is the only TAP component allowed to mutate Gmail.
- The live client uses the coordinator read model, optimistic actions, a
  durable cloud command queue, and a package-scoped private profile SQLite
  cache. Cache encryption controls beyond host profile isolation are deferred.
- The coordinator persists a stable command and idempotency key before calling
  Gmail. Unknown send outcomes never retry blindly.
- Initial sync fetches newest mail first and backfills older history without
  blocking the usable inbox.
- `H` is Remind Me. It removes the thread from the active TAP queue and defaults
  to `if no reply`; `Tab` changes the condition to `regardless`. It is distinct
  from `E`, which marks Done and archives at Gmail.
- Core Superhuman muscle memory is preserved. TAP-only commands get new,
  remappable bindings.
- TAP Email has its own panel. Chloe receives bounded active-context events and
  can interact through tools, but does not replace the email surface.
- Email can create or seed a TAP conversation through an explicit user action.
- Notifications are limited by default to direct critical mail, failed sends,
  and due reminders. They are configurable per account.
- Remote images and tracking pixels may load by default and are configurable in
  miniapp settings. Spam and phishing filtering remain provider responsibilities.
- Desktop is the first layout target, but the miniapp has no direct OS or system
  integrations.

## Hybrid architecture

```text
Gmail
  -> TAP Email coordinator
     - encrypted Google credentials
     - newest-first Gmail sync and history-cursor refresh
     - per-account history cursors and coverage
     - transactional command outbox / sole Gmail writer
     - idempotent send reconciliation and due reminders
     - derived facts for Home, summaries, tools, and workflows
  -> package-scoped private local profile
     - SQLite mailbox read model (implemented)
     - on-demand attachment cache and export (implemented)
     - deterministic and local semantic search indexes (implemented)
     - device-local cache controls (implemented)
  -> TAP Email panel
```

The hosted deployment can be shared, but every query, object, queue message,
idempotency key, log, and tool operation is partitioned by authenticated TAP
profile and immutable Google account ID. Caller-supplied account IDs never
establish authority on their own.

## Interaction contract

The working loop is deliberately small:

| Intent | Key | Result |
| --- | ---: | --- |
| Next thread | `J` | Advance without changing mailbox state |
| Previous thread | `K` | Move back |
| Remind Me | `H` | Schedule TAP reminder and advance |
| Done | `E` | Optimistically archive at Gmail and advance |
| Undo | `Z` | Reverse the last reversible action |
| Compose | `C` | Open a draft with explicit From account |
| Search | `/` | Focus unified, coverage-aware search |
| Command palette | `Cmd/Ctrl+K` | Search actions and learn bindings |

Every core operation must be possible without a mouse. A focused text editor
owns ordinary character input, and global shortcuts must not steal keystrokes
from compose, reply, search, or dialogs.

## Workflow portfolio

The post-v0 workflow portfolio includes three separate capabilities:

- A **Mailbox Rollup** powers Morning Brief, EOD Wrap, daily rollup, weekly
  review, and missed-mail audit views. It names the included accounts,
  resources, time range, and coverage rather than implying a complete mailbox.
- An **Email Activity Summary** reports content-free counts of committed,
  user-authored actions. It excludes subjects, bodies, correspondents,
  recipients, and sync/import/background work, and can be shared with Chloe
  without misusing the trusted-device active-time ledger.
- A **Mail Merge Run** creates a finite set of personalized, recipient-bound
  provider drafts from a user-selected audience and template. Each recipient
  is previewed and validated; every eventual send remains an individual,
  review-gated, idempotent command with its own receipt. Direct bulk send is
  never the default.

Saved workflows may launch and observe these recipes when the required read or
write capabilities are available. Recurring delivery requires coordinator or
platform scheduling; an accepted workflow invocation or a notification is not
evidence that a rollup was delivered or a message was sent.

## Current SDK boundaries

SDK 0.15.0 provides package-scoped private profile files, SQLite, and vector
storage in addition to revisioned non-secret JSON storage, channels,
host-mediated HTTP, notifications, and bounded Home attention types. TAP Email
requests the minimum 1 GiB private profile quota and stores its cached mailbox
state in `tap-email-mailbox-v1.sqlite`; the host scopes and routes that handle,
so package code never receives a filesystem path.

The SDK still does **not** expose a host keybinding registry or conflict
resolver. V0 therefore keeps keyboard handlers inside the focused surface and
never intercepts ordinary keys in compose, reply, search, or dialogs. The
browser preview uses an explicitly labeled disposable fixture store. Provider
HTML is sanitized into a sandboxed, network-denied iframe. Remote images are
fetched only through the coordinator under the user's privacy setting and
hydrated as bounded data URLs, so the message frame cannot contact
sender-controlled hosts directly.

## Implemented live slice

- Google OAuth uses server-generated state and PKCE, stores stable Google
  subject identifiers, and encrypts refresh/access tokens with AES-256-GCM.
- Initial sync fetches the newest Inbox page first, then queues older pages.
  Every sync request is durably persisted before dispatch, claimed with a
  lease, retried with bounded backoff, and dead-lettered after exhaustion.
  Later refreshes use Gmail history and visibly fail coverage closed when a
  cursor becomes stale or the account needs reconnecting.
- The coordinator stores message bodies encrypted. Mailbox summaries expose a
  bounded latest-message preview, and full thread bodies use a separate route.
- Archive, star, read state, labels, trash, reminders, compose, and reply all
  carry explicit immutable account IDs. Sends create a draft checkpoint and
  reconcile a deterministic message ID before any retry.
- Packaged mode can connect more than one Google account, switch between a
  unified and single-account view, request sync, poll command receipts, and
  use the `J`, `K`, `E`, `H`, `Z`, `C`, `/`, and command-palette flow.
- Packaged mode races the private profile SQLite cache against the cloud read
  model for a fast first paint, then refreshes and checkpoints state locally.
- Account-scoped hash deep links restore Home attention items and preserve
  unified-view thread identity even when provider thread IDs collide.
- Per-account settings control host-mediated alerts. Existing mail is
  baselined on launch; newly observed critical mail, due reminders, and failed
  sends can notify without exposing subjects, senders, or message bodies.
- OAuth callback, mailbox, sync, thread-detail, command, receipt, and coverage
  routes are covered by Worker integration tests. Account isolation and
  ciphertext-at-rest assertions are included.
- Public liveness and non-secret readiness probes distinguish a running Worker
  from one missing valid configuration, queue bindings, or D1 connectivity.

The remaining launch work is operational: register the production Google OAuth
client, complete any Google restricted-scope verification, configure the
GitHub production environment and its six deployment/runtime secrets, run the
deployment workflow to provision Cloudflare D1, R2, and Queues, and verify the
custom-domain health and readiness probes. A host-level keybinding conflict
registry and automatic host-governed activity-source contribution remain
follow-ups, not claims of this release.

## V0 release gates

- Explicit account ID on every mutation and tool write.
- Stable idempotency key persisted before Gmail mutation.
- Provider event states: received, processing with a lease, applied, retryable,
  and dead letter.
- Operational Zero fails closed when account coverage is incomplete.
- Account isolation tests for reads, mutations, queues, and logs.
- Keyboard tests for the J/K/E/H loop, text-entry boundaries, undo, and account
  switching.
- Reminder tests for `if no reply`, `regardless`, early replies, and due return.
- No raw email body in logs, TAP JSON storage, or Home attention projections.
- Useful cached thread paint within 50 ms and local action feedback within 50 ms
  on the reference desktop profile.
- Safe isolated HTML rendering before provider HTML is enabled.
