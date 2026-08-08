# Remote Browser gateway

Trusted Cloudflare Worker control plane for the sibling Remote Browser miniapp. It uses Cloudflare's in-process Browser Run binding, keeps session capabilities behind the TAP host, applies Browser Run egress guardrails, and coordinates each interactive session in a SQLite-backed Durable Object.

## HTTP contract

| Route | Authorization | Purpose |
| --- | --- | --- |
| `GET /health` | none | Configuration-free liveness |
| `POST /v1/snapshot` | installation-bound package OAuth access token or interactive assertion with exact `browser.snapshot.capture`, or the snapshot-only workflow bearer | Bounded Quick Action evidence |
| `POST /v1/sessions` | assertion with `browser.session.create` | Allocate an owner-bound Kitesurf session |
| `GET /v1/sessions/:id` | assertion with `browser.session.read` plus session token | Read lease, Live View, state, and control epoch |
| `POST /v1/sessions/:id/renew` | fresh assertion with `browser.session.renew` plus session token | Extend the local lease and refresh the Live View URL |
| `POST /v1/sessions/:id/control/handoff` | fresh assertion with `browser.session.control` plus session token | Compare-and-swap the control holder by epoch |
| `POST /v1/sessions/:id/control/assert` | assertion with `browser.session.control` plus session token | Confirm a holder/epoch is still authoritative |
| `DELETE /v1/sessions/:id?waitMs=…` | fresh assertion with `browser.session.close` plus session token | Begin close and optionally await it for up to 10 seconds |

The session token uses `X-Agent-Browser-Session-Token`. It is returned once by session creation, stored only as a SHA-256 digest by the gateway, and must remain in the trusted host. Miniapp JavaScript should receive an opaque host lease handle, not this token, an upstream session ID, or a CDP URL. Browser Run authentication is supplied by the Worker binding; there is no Browser Run API token in this Worker.

## Shared MCP room contract

Every semantic MCP tool call requires host-overwritten request metadata at
`params._meta["io.zephyr-cloud/remote-browser-participant"]`:

```json
{
  "version": 1,
  "workspaceId": "workspace-id",
  "requestingUserId": "requesting-user-id",
  "participant": {
    "kind": "agent",
    "principalId": "chloe",
    "instanceId": "64-character-lowercase-sha256-hex"
  },
  "consumer": {
    "kind": "specialist",
    "specialistId": "chloe"
  }
}
```

The gateway validates the workspace and requesting user against OAuth props,
strictly parses the host-serialized `McpConsumerIdentity`, and derives an opaque
participant ID. Package consumers must match the OAuth installation, but their
surface contribution intentionally differs from the MCP server contribution.
Participant identity is never accepted as a tool argument.

One `BrowserSessionCoordinator` remains the sole owner of one real Kitesurf
session and CDP stream. Its SQLite room state admits at most one connected agent
and two connected human application sessions, including two app sessions signed
in as the same account, while retaining bounded disconnected participant history
for reload and replacement. The creator can mint a
five-minute, two-use invitation;
only its SHA-256 digest is persisted. Join additionally requires matching
workspace, package, and server contribution OAuth context, so an invitation
token alone is not authorization. Each participant still has to match its own
host-attested OAuth installation. This permits two linked-local application
profiles with distinct installation IDs to share one room without merging
their participant identities. A disconnected exact participant can rejoin
without consuming another invitation use.

`remote_browser_join_session` accepts the exact versioned `RB1…` room code
shown by the miniapp as its canonical input. The code contains the opaque room
handle and bounded invitation token, but does not replace host attestation or
OAuth authorization. The older structured `sessionHandle` plus optional
`invitationToken` form remains a strict, non-overlapping compatibility branch;
mixed canonical and legacy arguments are rejected. A tokenless legacy call can
only resume the caller's own previously attested participant identity.

Every authenticated room or browser-tool call renews a 90-second durable
presence lease (the miniapp normally polls every 1.5 seconds). Before returning
a room view or counting join capacity, the coordinator disconnects stale
participants, so a force-killed app or agent releases its one-agent/two-human
slot. Creator authority remains durable in `is_creator` when creator presence
expires; that exact participant can rejoin without another invitation when
capacity permits. If the stale participant held control, the coordinator
increments the control epoch and hands control to a connected agent when one
exists. The current controller is retained while a bounded browser mutation is
in flight, and successful or failed operation completion renews its presence
before the next poll.

The room tools are `remote_browser_share_session`,
`remote_browser_join_session`, `remote_browser_room`,
`remote_browser_claim_control`, `remote_browser_release_control`, and
`remote_browser_leave_session`. All joined participants can inspect the same
snapshot, screenshot, selected element, network telemetry, and diagnostics.
Navigation, click, fill, and scroll additionally require the caller's exact durable
participant ID to own the current control epoch. Human control is a bounded
lease; another human receives `control_contended`, and every stale compare-and-
swap receives `stale_control_epoch`. Leave disconnects only that participant;
only the durable creator may close the upstream browser.

The signed package consumer policy promotes the complete governed browser tool
catalog to the channel chat, explicitly selected specialists, and workflows.
Both channel chat and specialists are represented as agent participants, so
they can join the same room and negotiate the same fenced control lease without
receiving the underlying CDP connection or browser credentials.

The provenance of the reserved metadata is a host boundary, not something the
MCP protocol signs. The TAP host must construct `params._meta`, overwrite or
remove any caller-supplied value for this key, and use a host-custodied OAuth
channel. A gateway exposed directly to arbitrary MCP clients cannot distinguish
forged metadata from host-stamped metadata and is not a supported deployment.

Local MCP OAuth independently binds every grant to the exact package installation that started
the flow. After TAP revalidates the active package, signed descriptor, mounted contribution,
member, workspace, and consumer audience, it places those owner claims in a ten-minute
HMAC-SHA256 installation attestation carried by OAuth dynamic registration's persisted
`client_name`. The authorization handler verifies the MAC, issuer, audience, lifetime, workspace,
package, and server contribution before it renders consent or creates a grant. The actor and
installation come from those verified claims rather than static Wrangler variables, so two TAP
profiles receive distinct valid grants. The opaque attestation is never displayed on the consent
page. `params._meta` must still match that token owner exactly on every tool call.

The same installation-bound OAuth grant can authorize MCP tools and workflow
snapshots by requesting both `remote-browser` and `browser.snapshot.capture`.
The `/mcp` handler requires the former and `POST /v1/snapshot` requires the
latter. Authorization-code and refresh exchanges copy the provider's effective,
possibly downscoped token scopes into that access token's encrypted props, so a
token narrowed to `remote-browser` cannot inherit snapshot authority from its
broader grant.

Interactive authorization is a compact Ed25519 JWS in `Authorization: Bearer …`:

```json
{
  "alg": "EdDSA",
  "typ": "JWT",
  "kid": "tap-browser-v1"
}
```

```json
{
  "iss": "tap-desktop-host",
  "aud": "tap-agent-browser-gateway",
  "sub": "actor-id",
  "workspace_id": "workspace-id",
  "package_id": "package-id",
  "installation_id": "installation-id",
  "contribution_id": "contribution-id",
  "jti": "unique-assertion-id",
  "iat": 1786032000,
  "nbf": 1786032000,
  "exp": 1786032060,
  "scope": ["browser.session.create"]
}
```

Issuer and audience must match exactly, assertion lifetime is at most 60 seconds, and state-changing assertions are single-use by `jti`. The complete owner comes from signed claims; request owner headers are ignored. A different owner receives `404` for an existing session, while a bad session capability for the correct owner receives `401`.

`ze-workflows` cannot mint an interactive host assertion today. It can pass the
package OAuth access token to `POST /v1/snapshot` when that token has the exact
`browser.snapshot.capture` scope; ownership then remains the package
installation attested during OAuth authorization. The production-owned
`WORKFLOW_SERVICE_TOKEN` path remains available for service execution, with its
actor, workspace, package, installation, and contribution fixed by
`WORKFLOW_SERVICE_*` deployment variables. Host assertions and the service
bearer are resolved only for exact snapshot requests and are rejected by
`/mcp` and every session route.

## State, quotas, and egress

`BrowserSessionCoordinator` is named by the gateway session UUID and persists ownership, the hashed capability, upstream identifiers, lease/hard expiry, Live View URL, durable participant presence/invitations, and the exact participant control holder/epoch. Its alarm expires abandoned sessions, returns expired human control to a connected agent, and retries an incomplete upstream close. `BrowserOwnerQuota` is named by workspace and stores active reservations, actor counters within that workspace, one-minute creation/snapshot windows, and assertion nonces. Reservations are released on confirmed close; their conservative fallback lasts through the gateway hard TTL plus Browser Run's inactivity window so a delayed alarm cannot undercount a browser that may still consume upstream concurrency.

The Wrangler migration tag is `v1-browser-control-plane`; both classes are introduced with `new_sqlite_classes`.

`ALLOWED_HOSTS` accepts one to fifty exact public hostnames or `*.domain` rules. It is enforced three ways:

- the initial URL is parsed locally and private/local targets are denied;
- Quick Actions receive `allowRequestPattern` regexes, covering redirects and subresources to the extent exposed by the API;
- sessions receive Browser Run `guardrails.allowedDomains`, which also applies to later navigation and Live View.

Browser Run's `keep_alive` is an inactivity timeout, not a maximum lifetime. `BROWSER_RUN_INACTIVITY_TIMEOUT_MS` configures that upstream timeout (the current API schema accepts at most 1,200,000 ms). Explicit renewals list the target, refresh its Live View URL, and count as session activity. Independently, `MAX_SESSION_LIFETIME_MS` is this gateway's absolute cost/safety policy; leases cannot cross its `hardExpiresAt` value. The example defaults that gateway policy to one hour.

## Local setup

Copy `.dev.vars.example` to `.dev.vars` and fill it without committing it. Generate one random
secret of at least 32 bytes and set the same value as
`MCP_LOCAL_INSTALLATION_ATTESTATION_SECRET` in the gateway and
`TAP_REMOTE_BROWSER_MCP_INSTALLATION_ATTESTATION_SECRET` in the local TAP launcher environment.
Generate an Ed25519 keypair in the host; put only its public JWK in
`TAP_BROWSER_ASSERTION_PUBLIC_JWK`. Set a distinct workflow service token and the real workflow
workspace ID. Set `ALLOWED_ORIGINS` only when exercising the direct development preview.

The packaged MCP declaration uses `http://127.0.0.1:8787/mcp` for local-directory development. TAP accepts cleartext MCP only on an exact loopback host, and this Worker's authorization handler independently rejects non-loopback consent requests. OAuth still uses PKCE, a short-lived HTTP-only SameSite CSRF cookie, and an explicit Accept action. Deployed and every non-loopback MCP endpoint remain HTTPS-only.

`wrangler.jsonc` declares `BROWSER` with `remote: true`, so local development uses the real remote Browser Run binding rather than a local simulation. The logged-in Wrangler identity must have Browser Run write permission and the account must have Browser Run enabled.

```bash
pnpm --filter @tap-examples/agent-browser-gateway dev
```

For deployment, provision the required secrets before deploying:

```bash
pnpm --filter @tap-examples/agent-browser-gateway exec wrangler secret put TAP_BROWSER_ASSERTION_PUBLIC_JWK
pnpm --filter @tap-examples/agent-browser-gateway exec wrangler secret put MCP_LOCAL_INSTALLATION_ATTESTATION_SECRET
pnpm --filter @tap-examples/agent-browser-gateway exec wrangler secret put WORKFLOW_SERVICE_TOKEN
```

The pinned Wrangler `secrets.required` declaration contains names only. It gives local missing-secret validation and generated `Env` types; secret values remain in `.dev.vars` or Cloudflare.

Run the edge-runtime checks with:

```bash
pnpm --filter @tap-examples/agent-browser-gateway typecheck
pnpm --filter @tap-examples/agent-browser-gateway test
pnpm --filter @tap-examples/agent-browser-gateway verify:real-only
pnpm --filter @tap-examples/agent-browser-gateway types:check
pnpm --filter @tap-examples/agent-browser-gateway build
pnpm --filter @tap-examples/agent-browser-gateway check:startup
```

The gateway build performs the same real-only scan against Wrangler's completed `dist` output. Failure scenarios are supplied only by the Miniflare `BROWSER` service in `vitest.config.ts`; the shipped gateway has no swappable browser transport and always calls `env.BROWSER`.

The startup profiler uses `2026-08-01` as a local analysis override because Wrangler 4.119's pinned workerd build does not profile the deploy compatibility date, `2026-08-06`.

## Remaining platform seam

The gateway can prove who owns a session and which control epoch is current, but a Browser Run Live View connection does not traverse this Worker. Therefore the TAP host must mediate frames and input, check the gateway epoch before each mutating action, and stop forwarding input when control changes. The gateway cannot cryptographically revoke input sent directly over an already-disclosed Live View/CDP capability.

Session creation is at-most-once per signed assertion, not idempotent from the caller's perspective. If the host loses the creation response, it cannot currently recover the generated gateway session ID from that assertion; a future host contract should carry a signed idempotency key and provide lookup/reconciliation. Other mutations can be reconciled through session status and control epoch.

Domain allowlists and Browser Run guardrails cannot independently prove the IP address to which an allowed hostname resolved. Allowlisted wildcard domains therefore require the same DNS-control trust as any other SSRF boundary; stronger policy needs resolved-IP enforcement from Browser Run or a controlled egress layer.

Kitesurf currently rejects the aggregate `/snapshot` Quick Action, so the gateway invokes only the requested individual `/screenshot`, `/markdown`, `/accessibilityTree`, and `/content` actions with at most two requests in flight. It validates each real response, composes the returned fields and completed format list into the gateway snapshot contract, preserves only consistent reported page metadata, and sums the reported browser time. Screenshot responses are limited to 6 MiB, content to 4 MiB, Markdown and accessibility data to 2 MiB each, and the final serialized response to 10 MiB. Rejected response streams are cancelled. Any missing, malformed, oversized, or failed requested action fails the capture; the gateway does not manufacture a partial success.

Each format is therefore an independent Kitesurf page load, not an atomic multi-format browser snapshot. Dynamic pages can change between those actions; conflicting reported title or status metadata fails closed. A native Kitesurf multi-format action should replace this fan-out when Cloudflare exposes one.

The Browser Run binding's typed `quickAction()` contract still omits both the Kitesurf engine selector and the accessibility-tree action. The gateway therefore uses the same binding's raw `fetch()` transport with individual `/v1` Browser Run routes and `browser=kitesurf`; it still makes no public REST request and needs no API token. This contract is isolated in `src/cloudflare-browser.ts` so it can move to `quickAction()` once the generated binding exposes the selector and complete action set.

Wrangler 4.119's local remote binding supports the session/CDP path used by the eleven semantic browser tools; six additional tools coordinate the shared room without allocating another browser. Session start validates a bounded viewport and applies CDP device metrics before the initial navigation; wheel scrolling is dispatched through the same fenced CDP connection. A real local verification of the original nine started Kitesurf, navigated, read the accessibility tree, captured a viewport PNG, listed network traffic and diagnostics, filled a textbox, clicked a button, and closed the session. The selected-element and scroll tools have edge-runtime contracts and CDP command sequences covered by the gateway test service; they still need to be included in the next real local specialist verification. The separate Quick Action transport used by `POST /v1/snapshot` still reaches Browser Run but is rejected upstream with HTTP 401 / code 10000. Current Wrangler supports Browser Run with local Durable Objects and also supports both bindings under full remote development, so `wrangler dev --remote` is a useful native-environment diagnostic; it does not turn the undocumented raw Kitesurf route into a supported binding contract. The same account successfully returned real Kitesurf screenshot, Markdown, accessibility-tree, and content data through the official REST endpoints, which isolates the remaining failure to Quick Actions through the binding. Passing `snapshot?browser=kitesurf` to `quickAction()` is also rejected as an invalid action. The gateway deliberately does not retry with Chromium, use an ambient OAuth token, or manufacture evidence. Local Browser Run responses larger than 1 MiB are unsupported, so a populated final evidence proof belongs on a deployed Worker even after Cloudflare exposes Kitesurf selection on `quickAction()`; specialist MCP sessions work locally today.

This checkout can be typechecked, tested through its non-shipping test service, and built with Wrangler dry-run. A deployed end-to-end run additionally requires Browser Run write authority, real gateway secrets/configuration, a deployed Worker, the host `browserSessions.v1` transport, and a saved workflow wired to `universal.browser.snapshot`.
