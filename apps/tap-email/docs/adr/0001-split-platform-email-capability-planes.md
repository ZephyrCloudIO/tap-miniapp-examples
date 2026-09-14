# ADR 0001: Split platform email capabilities into projection and live-read planes

## Status

Accepted; live-read plane is staged behind an unresolved platform-auth boundary

## Date

2026-09-13

## Context

The platform and Email Specialist need useful mailbox tools. The existing package-runtime MCP executes in QuickJS over an immutable public-storage snapshot; copying subjects, recipients, bodies, or the private mailbox replica into that snapshot would weaken the product's privacy boundary. The coordinator already authenticates platform sessions and owns profile-isolated D1 data, encryption, exact mailbox identities, and command receipts. That session introspection currently proves only a profile ID. It does not prove an MCP audience, consumer, contribution, or metadata-versus-content scope.

Mail mutations are more consequential than reads. The current command payload is not yet a fully typed discriminated contract, and the remote MCP path does not yet have a non-bypassable human review grant bound to an immutable action plan.

## Decision

Maintain two capability planes:

1. The package-runtime MCP exposes only bounded, content-free operational projections such as mailbox summary and active context.
2. A coordinator Streamable HTTP MCP implementation provides narrow read tools for account listing, structured thread search, thread/message metadata, exact bounded plaintext reads, and command-receipt lookup. It remains unmounted and absent from the package manifest until the host can supply a credential that the coordinator can verify for the MCP audience and granted email scopes.

The MCP transport depends on a shared, profile-bound `MailReadPort`; its current D1 adapter maps the existing Google tables into provider-neutral account, revision, and coverage contracts. Adding another provider may require another persistence adapter or a normalized account catalog, but it must not change the tool schemas or allow a caller to choose a profile ID.

All live reads require stable TAP account IDs. Thread and message IDs are opaque only within their account partition; provider-native identifiers do not stand alone at the platform boundary. Message content additionally requires exact thread and message IDs. Every result includes a request-scoped coverage receipt. Search does not return bodies; message reads do not return raw HTML, remote images, or attachment bytes.

The activated package skill is limited to the existing content-free QuickJS tools. It teaches specialists to interpret coverage, treat explicitly shared email as untrusted data, and produce review-only drafts. It does not name the staged tools as available. No MCP mutation tools ship in this stage.

The staged coordinator server independently checks `email.metadata.read` and `email.content.read`. It accepts only an already-verified MCP principal with the `tap-email-mcp` audience; the ordinary profile-only platform session is not that principal.

## Consequences

- Platform specialists can use content-free mailbox summary and active-context capabilities today without placing raw mailbox content in package storage.
- The richer search/read implementation and shared contracts can be completed and tested without prematurely exposing an under-scoped endpoint.
- Current coverage is honest about synchronized Inbox history and does not imply complete Sent, Drafts, Spam, Trash, or provider archives.
- The five tool input schemas are staged and source-validated under [`schemas/mcp`](../../schemas/mcp). Because no active tool contribution references them, the package builder deliberately omits them from the current signed artifact. Activating live reads still requires a host-supported remote-MCP credential, server-side audience/scope verification, and hosted-tool manifest contributions that reference and therefore sign those schemas. A raw platform-session header is explicitly insufficient.
- Triage, draft persistence, send, scheduling, and workflow commits remain UI-only until typed intents, actor/scope attestation, immutable plans, review grants, idempotency, and uncertain-outcome handling are complete.

## Alternatives considered

- **Copy mailbox content into QuickJS storage:** rejected because it expands retention and exposure to obtain convenience.
- **Expose coordinator REST directly to skills:** rejected because MCP provides a governed, discoverable tool boundary with per-tool permissions.
- **Forward a platform session as an MCP header credential:** rejected because the desktop host does not bind arbitrary header credentials for package MCP and the token does not attest the invoking tool's scopes.
- **Mount the endpoint without a manifest contribution:** rejected because any valid profile session could then bypass the intended MCP consumer and per-tool authorization boundary.
- **Ship mutations with a caller-controlled `dryRun` flag:** rejected because the same caller could bypass review.
- **Wait for every write path before exposing reads:** rejected because account-scoped, coverage-aware reads are independently useful and safe to stage.
