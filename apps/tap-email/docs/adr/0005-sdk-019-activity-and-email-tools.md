# ADR 0005: SDK 0.19 activity and Chloe email tools

Status: implemented. Supersedes the activation gates in ADRs 0001 and 0002.

## Behavior

TAP Email uses Miniapp SDK 0.19.0 and requires TAP >=2.24.0. The signed `tap-email-committed-actions` contribution exports the SDK's `activitySource.get` ABI. Installation registers self-scoped counts for Chloe and the Email Specialist. Chloe still needs `activity_get` in her own host tool policy.

The source reads only `tap-email / users/{userId}/activity/v1`, using the host's user identity. It returns every declared action/status pair, including zero, with count units. It never returns mail content, identities, event timelines, or active time. Unavailable snapshots throw so the host reports unavailable; incomplete ranges report partial.

The existing private SQLite ledger records committed sends/replies, archives, Trash moves, labels, read-state changes, stars, scheduled sends, and reminders. Reader selection changes additionally record views, including already-read conversations. Successful MCP plaintext reads are reconciled from the coordinator audit as views; metadata searches and failures do not count as views. The first successful provider save of a draft counts once per account/draft key; further autosaves do not inflate counts. Failed saves do not count as created drafts. Receipt replay is idempotent; uncertain sends can be refined by authoritative reconciliation.

Coverage for the expanded set of activity types starts at the first launch of this version. Existing ledger events remain available with partial historical coverage. The ledger retains 90 days / 10,000 events and publishes at most 2,048. Coordinator receipts are reconciled in bounded pages while the surface is open, including sends initiated through Chloe and the scheduler. A closed/offline surface can yield partial or stale coverage. The last completed coordinator sync bounds complete coverage even when newer UI activity is recorded. Totals are installation-local and must not be added across devices without deduplication.

## Live tools

Package-runtime MCP remains a content-free read-only snapshot. A separate, registered Streamable HTTP MCP at `/mcp` exposes:

- `list_email_accounts`, `search_email_threads`, `get_email_thread`, `read_email_messages`;
- `save_email_draft`, `send_email`;
- `get_email_command_receipt`.

The existing account-scoped, coverage-aware mail read adapter serves reads. Draft/send calls use the existing encrypted, durable, idempotent command queue and provider adapter. Accepted means queued; only an applied receipt proves success. Inputs include stable command IDs and creation timestamps; retries with changed intent fail. Uncertain sends must be reconciled rather than submitted with a fresh ID. Writes currently support plaintext; attachments remain in the Email UI. Search is synchronized metadata search, not full provider/body search.

The package's MCP consumer ceiling includes selected specialists, chat, and platform consumers. The bundled `email-operations` skill teaches discovery, safe content handling, sending on user instruction, and receipt interpretation. Installation grants still determine which consumers can use it.

## Authentication

Live tool schemas are explicitly emitted into the desktop target and checked against its signed artifact inventory; SDK 0.19 does not copy these references automatically.

SDK 0.19 supports host-held Streamable HTTP header credentials. Email settings issues a cryptographically random, profile-bound token with metadata/content read scopes and optional write scope. Tokens last 30 days; only their SHA-256 digest is stored. One token exists per profile. Replacement revokes the old token, and explicit revoke removes it. The server accepts the token only for `/mcp`; it cannot mint another token or authenticate platform REST routes. Ordinary platform-session credentials cannot authenticate MCP.

`/v1/mcp/credential` status requires the existing platform view authorization. Creation, rotation, and revocation require the existing platform manage authorization. Write credentials additionally capture a user/workspace verified through the existing Session/Directory sender verifier at issuance. The credential delegates that fixed sender context; tool arguments cannot override it. Sends use the normal durable attribution and referral pipeline. Replace the credential to change sending workspace. Each MCP tool independently checks its required scope. The host also applies its signed tool permissions and consumer grants. This replaces the old assumption that a raw platform session could attest remote MCP permissions; no such attestation is fabricated.

## Release and connection

1. Apply coordinator migration `0016_mcp_credentials.sql` and deploy the coordinator through its normal production release procedure.
2. Build and publish/install the Email package with the SDK 0.19 manifest.
3. In Email settings, create a connection token, selecting send/draft permission if wanted. Store it in TAP's Email MCP credential slot `tap-email-access-token` (`X-TAP-Email-MCP-Token`). Do not put the token in chat or source files.
4. Grant Chloe the live Email MCP tools and `email-operations` skill in host settings. Keep her `activity_get` tool enabled for combined summaries.
5. Open Email and sync to publish this installation's activity projection. Reconnect after token expiry or revocation.

These repository changes do not deploy production infrastructure or modify Chloe's installed host policy.
