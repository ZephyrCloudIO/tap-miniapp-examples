# ADR 0002: Register TAP Email activity through the host activity registry

## Status

Accepted; activation waits for the SDK and host `activity.source` and
`activity_get` contracts tracked in
[ze-agency-tauri#10771](https://github.com/ZephyrCloudIO/ze-agency-tauri/issues/10771)

## Date

2026-09-14

## Context

TAP Email records authoritative command receipts in an idempotent,
private-profile SQLite ledger. It publishes a bounded `activity/v1` projection
and exposes `get_email_activity_summary` through its package MCP server. That
tool gives an explicitly authorized specialist a source-specific view, but it
does not let TAP discover Email activity as part of a general activity query.

The platform already registers specialists, MCP servers, and tools from an
installed miniapp's manifest. Activity needs the same extension model. A fixed
Email hook or Chloe-only status path would force the host to add package-specific
code for each new source.

The activity path must keep Email's content boundary. It must not expose
subjects, bodies, people, account or message identities, item timelines, or
idempotency keys. It must not treat Email actions as device-presence evidence or
write them to the active-time ledger.

## Decision

TAP Email will register its committed-action aggregate as a repeatable,
manifest-declared `activity.source` contribution after the SDK and host support
the platform contract in
[ze-agency-tauri#10771](https://github.com/ZephyrCloudIO/ze-agency-tauri/issues/10771).

The initial source has the stable contribution ID
`tap-email-committed-actions`. Its manifest metadata declares:

- a static source name and description;
- the activity types and optional statuses that Email reports, with static
  names and descriptions;
- `self` scope;
- the standing canonical specialist-slug access pattern `chloe`;
- the exact read-only storage row `tap-email / activity/v1`; and
- the existing `tap-email.view` authorization requirement.

Installation registers the source and its access automatically. A user may
narrow or disable access. Source access does not add `activity_get` to Chloe's
toolset; Chloe's own tool policy controls that capability.

Each aggregate returned by the source has a declared activity ID, an optional
declared status ID, a nonnegative integer value, and the explicit unit `count`.
Runtime output contains no names, descriptions, free-form text, identities, or
item-level records. Email owns the meaning and tracking of its activity types
and statuses; the static manifest descriptions explain those values to an
authorized consumer.

The host supplies the authenticated user, current workspace, exact
installation and source identity, requested scope, and exact half-open time
range of at least 15 minutes. Package code cannot select another user or
workspace, widen the range, or change the consumer identity.

The host executes the package source locally in a read-only runtime; the final
specialist is only the consumer. The source can read only its declared storage
row. It cannot write storage, use the network, invoke host actions, or call
tools. The host validates the result, isolates source failures, and attaches
package, publisher, installation, source, and coverage provenance with an
`Official` or `Untrusted` trust label.

`activity_get` is the canonical activity tool. It queries every registered
source available to the final specialist and keeps results grouped by source.
The host does not combine Email with another source or another Email
installation. A complete zero remains distinct from partial or unavailable
coverage.

The current `activity/v1` projection is self-scoped and remains bound to the
current workspace installation. TAP Email will not claim workspace coverage or
account-wide, cross-device coverage. A future authoritative workspace aggregate
or cross-installation deduplication path requires a separate source and
decision.

Disabling or uninstalling TAP Email unregisters the source. TAP does not retain
a second copy of Email's activity history.

## Consequences

- TAP Email participates in the same activity registry as built-in and other
  miniapp sources.
- Chloe receives Email aggregates through `activity_get` without discovering or
  invoking a package-specific MCP tool.
- The package can add another activity source when it needs a different scope,
  access policy, or privacy boundary.
- The existing MCP summary remains available as a separately authorized,
  source-specific capability while the platform registry is unavailable.
- Workspace Email totals, other-user queries, item-level detail, and
  cross-installation deduplication remain outside this source.

## Activation gate

TAP Email may add the source to its active manifest only after the platform:

- recognizes repeatable `activity.source` contributions;
- registers their static metadata, specialist access patterns, scopes, and
  storage reads;
- exposes canonical `activity_get` queries;
- derives user, workspace, final specialist, source identity, scope, and range
  from host authority;
- rejects query windows shorter than 15 minutes;
- enforces read-only execution and aggregate-only output;
- preserves explicit zero, coverage, provenance, and isolated failures; and
- keeps results separate across sources, installations, and devices.

## Alternatives considered

- **Add TAP Email directly to `self_status_get`:** rejected because every
  miniapp would require host-specific wiring and a fixed source list.
- **Have Chloe call the Email MCP tool automatically:** rejected because MCP is
  a separate source-specific capability and access boundary.
- **Write Email actions into active-time storage:** rejected because an Email
  command receipt does not prove device presence or active minutes.
- **Publish receipt identities for host deduplication:** rejected because it
  would weaken the content-free aggregate and expose private linkage keys.
