# Kart Royale Server

Cloudflare Worker + Durable Object session server for the
[`@tap-examples/kart-royale`](../kart-royale) miniapp's channel multiplayer.
One `RaceRoom` Durable Object per race; the object is authoritative for the
*race rules* (roster, slots, countdown clock, checkpoint order, placement,
finish) while kart motion stays client-simulated and relayed — the hybrid
model fixed in the [product brief](../../miniapps/07-kart-royale.md).

## Layout

| path | what it is |
|---|---|
| `src/index.ts` | Worker entry: room creation, join tickets, ticket-verified WebSocket upgrade |
| `src/RaceRoom.ts` | the Durable Object: roster, countdown, state relay, checkpoint/finish arbitration, disconnect leases, host migration |
| `src/protocol.ts` | versioned (`v: 1`) client/server wire envelopes + validators |
| `src/ticket.ts` | HMAC-SHA256 join tickets (user/channel/race/role/expiry), WebCrypto |
| `src/auth.ts` | identity seam: TAP platform-session JWT verification through Auth0 JWKS, or dev identity (local/test only) |
| `src/trackAuthority.ts` | the game's own `TrackMath` (via `@tap-examples/kart-royale/track-math`) validating checkpoint claims against the actual circuit |

## Endpoints

```
GET  /health
GET  /channels/:channelId/rooms   open-room listing (ChannelRegistry)
POST /rooms                       { channelId, userId?, displayName }          → { raceId, ticket, wsUrl }
POST /rooms/:raceId/tickets       { channelId, userId?, displayName, role }    → { raceId, ticket, wsUrl }
GET  /ws?raceId&ticket            WebSocket upgrade (identity stamped by ticket)
```

Room discovery lives in a second Durable Object, `ChannelRegistry` (one per
channel): the Worker registers rooms at creation and each `RaceRoom` keeps
its own entry current as it changes phase or empties out.

`userId` in REST bodies is the **dev identity** (accepted only when
`ALLOW_DEV_IDENTITY=true`, i.e. local dev and tests). Production identity
comes from a TAP platform session attached by the host-mediated
`tap.http.request` `credentialRef: 'platform-session'` flow. The Worker
verifies its signature and claims against `TAP_JWT_ISSUER` and
`TAP_JWT_AUDIENCE`; an invalid session is rejected and never downgraded to
dev identity.

### Production context blocker

The current `platform-session` contract authenticates the account subject,
but it does not carry a host-verifiable channel ID or display name. The host
attaches only the access-token bearer, and those two fields are still declared
by the request body. Therefore this Worker must not be treated as ready for a
public multiplayer deployment. The platform contract still needs a short-lived,
platform-signed context assertion that binds the verified session subject to
the active workspace, channel, and display name; the Worker must verify both
tokens and require their subjects to match.

The checked-in root configuration deliberately fails closed in the meantime:
`ALLOW_DEV_IDENTITY=false`, the Auth0 issuer/audience are unset, and
`TICKET_SECRET` is a required deployment secret.

## Wire protocol (v1)

Client → server: `hello`, `ready`, `start` (host only), `state` (kart state
sample — `kartKey: self` default, or `ai:<slot>` for host-simulated AI
backfill), `checkpoint` (validated against TrackMath), `finish`,
`item_draw` (box pickup → seeded roll), `item_use` (inventory-validated
spend), `item_carry_consumed` (destroyed/dropped trailing shield),
`hit_claim` (projectile contact vs a network-owned kart), `ping`.
Server → client: `welcome`, `roster`, `countdown`, `race_start`,
`peer_state`, `peer_leave`, `checkpoint_ok` / `checkpoint_reject`,
`finish_ok`, `race_results`, `item_granted` / `item_denied`, `item_used`,
`item_carry_consumed`, `item_sync`, `hit` (to the victim only), `box_down` /
`box_up` / `box_sync`, `error`, `pong`.

## Developing

```bash
pnpm dev         # generates ignored .dev.vars secret, then wrangler dev with an explicit local identity bypass
pnpm test        # vitest-pool-workers (miniflare Durable Objects + real WebSockets)
pnpm typecheck
pnpm build       # wrangler deploy --dry-run (bundle proof)
```

`pnpm dev` never changes the deploy configuration: its pre-step creates a
random ticket secret in ignored `.dev.vars`, while the command-line
`ALLOW_DEV_IDENTITY:true` binding exists only for that local Wrangler process.
Tests supply their own explicit test-only bindings.

Do not deploy the public multiplayer service until the context-assertion
blocker above is resolved. Any future deployment must provision
`TICKET_SECRET` with `wrangler secret put` and keep
`ALLOW_DEV_IDENTITY=false`.
