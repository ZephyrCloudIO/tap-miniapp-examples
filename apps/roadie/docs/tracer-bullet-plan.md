# Roadie workspace isolation tracer-bullet plan

## Goal

Prove, end to end, that the same Roadie release can be installed in every TAP
workspace a user belongs to, while each workspace sees and modifies only its own
Roadie data.

The tracer bullet is complete when one test user can install Roadie in two dev
workspaces, create different trips in each, switch repeatedly between them, and
cannot read, update, or delete the other workspace's records by changing request
identifiers.

## Confirmed platform behavior

- Roadie declares `scope: workspace` and `instancePolicy: per-workspace`.
- TAP's package-manager database enforces one installation for each
  `(package_id, scope_key)`. The current product therefore supports one Roadie
  installation per workspace, not multiple Roadie installations in one workspace.
- A surface mount receives host-selected `workspaceId`, `installationId`, and
  canonical `userId` values.
- TAP's built-in miniapp storage is physically keyed by
  `(workspace_id, package_id, namespace, storage_key)`, so Roadie's remaining
  local settings are already workspace-isolated.
- Roadie's signed descriptor declares its exact backend origin and the
  `platform-session` effect. TAP exchanges its account bearer for a five-minute
  token bound to Roadie's package, installation, workspace, and backend origin;
  no compiled backend allowlist or bearer exposure to miniapp JavaScript.
- The scoped token proves account and host-attested miniapp context. Roadie's API
  still resolves the canonical user and authorizes current workspace membership
  server-side.
- Roadie's remote D1 database is shared by all workspaces. This is acceptable,
  but every primary key, foreign key, query, and authorization decision must be
  workspace-scoped.
- Roadie currently asks Directory for joined membership. The failing dev
  workspace is absent from Directory even though TAP's legacy workspace system
  presents it in the UI.
- The platform repository already contains a substantial Directory import,
  verification, rehearsal, activation, recovery, and cutover toolchain. The dev
  Directory is intentionally read-only and app authority is disabled, so this
  is an incomplete platform cutover rather than a Roadie installation defect.

## Target behavior

1. A newly installed workspace opens to an empty Roadie state.
2. Joined members see that workspace's shared trips.
3. Owners and admins can manage all workspace trips; members can manage trips
   according to the agreed ownership policy; view-only members cannot mutate.
4. Switching workspaces switches datasets, even for a user who belongs to both.
5. Unknown, invited, declined, removed, or wrong-workspace users fail closed.
6. Uninstall/reinstall follows TAP's declared `persistence: retained` behavior.
7. No request can cross the tenant boundary by supplying another workspace's
   trip, item, owner, request, or installation identifier.

## Tracer-bullet implementation

### 1. Establish an authoritative dev membership path

Owner: TAP platform/Directory.

- Inventory all workspaces and memberships exposed by the dev client and compare
  them with `tap-directory-dev`.
- Run the existing Directory capture/import/verify tooling against dev data.
- Produce a reconciliation report with counts and explicit missing/extra IDs.
- Do not enable Directory authority until import verification reports zero
  unexplained workspace and joined-membership differences.
- Exercise the existing cutover rehearsal and recovery path in dev.
- Enable the planned Directory write authority and event delivery only through
  the repository's cutover mechanism; do not manually insert individual Roadie
  test memberships as the permanent fix.
- Verify workspace create, invite, accept, role change, remove, and delete flows
  update Directory and its consumers.

Temporary option if the Directory cutover cannot happen on the Roadie schedule:
introduce a platform-owned membership RPC backed by the current authoritative
source, then move that RPC's implementation to Directory after cutover. Roadie
must not implement a fallback that trusts a client-supplied workspace ID.

### 2. Make the Roadie D1 tenant boundary structural

Owner: Roadie.

- Replace global trip identity with a composite key `(workspace_id, trip_id)`.
- Replace global itinerary identity with a composite key such as
  `(workspace_id, trip_id, item_id)`.
- Add a composite itinerary foreign key to the corresponding workspace trip and
  enable/verify foreign-key enforcement for migrations and runtime operations.
- Scope every select, insert, conflict target, update, and delete by
  `workspace_id`.
- In particular, replace the current `ON CONFLICT (trip_id)` and itinerary
  deletion by bare `trip_id`; both must include the workspace boundary.
- Keep one shared D1 database. A database per workspace is unnecessary for the
  present scale and would add provisioning and migration complexity without
  changing the security model.
- Build this as a copy migration: create new tables, copy and validate rows,
  swap tables, recreate indexes, and retain a rollback/export artifact.

### 3. Tighten the Roadie API contract

Owner: Roadie with TAP platform review.

- Continue deriving the actor from the verified bearer; never accept an actor or
  owner as authoritative client input.
- Authorize joined membership before every read and mutation.
- Confirm the returned principal's `workspaceId` equals the requested workspace.
- Remove `owner_user_id` from create input if it is not needed; the server already
  owns that decision.
- Validate bounded workspace, trip, item, and request identifiers at the API
  boundary.
- Make write idempotency durable and workspace-scoped. Decide whether request IDs
  are retained indefinitely or for a documented window.
- Return stable error codes for unauthenticated, non-member, view-only,
  not-found, conflict, and unavailable states so the UI can distinguish setup
  failures from authorization failures.

### 4. Preserve the intended workspace UX

Owner: Roadie.

- Use the host-provided `context.workspaceId` for cache keys and all API calls.
- Keep workspace trips in the remote Roadie service and workspace settings in
  TAP storage.
- Preserve the existing one-time migration of legacy TAP-storage trips into the
  active workspace, but add a durable migration marker so remounts and partial
  failures cannot duplicate or ambiguously reassign data.
- Show an empty state for a valid new workspace.
- Show a specific platform-sync diagnostic for a workspace that TAP mounted but
  the authoritative membership service cannot resolve. Do not show another
  workspace's cached data while an authorization request is failing.
- Clear workspace-specific React Query state when the host owner changes or the
  surface moves between retained realms.

### 5. Prove isolation before deploying

Owner: Roadie and TAP test infrastructure.

Add backend integration tests with two workspaces, two users, and overlapping
client-selected IDs:

- The same `trip_id` and `item_id` can safely exist in both workspaces.
- Listing workspace A never returns workspace B rows.
- A member of A but not B cannot list, create, update, or delete B data.
- Supplying B's trip ID in an A request cannot inspect or mutate B.
- A shared member switching A -> B -> A receives the correct dataset each time.
- Owner/admin/member/view-only behavior matches the product policy.
- Removed membership revokes access immediately enough for the documented
  consistency model.
- Retried writes are idempotent within a workspace and do not collide across
  workspaces.

Add a TAP-host end-to-end test:

1. Create two dev workspaces through the normal product flow.
2. Install the same Roadie package in both.
3. Confirm each installation mounts with its own workspace context.
4. Create `Trip A` in workspace A and `Trip B` in workspace B.
5. Switch workspaces and remount/restart the app.
6. Confirm only the correct trip is visible in each workspace.
7. Uninstall/reinstall one copy and verify retained-persistence behavior.

### 6. Deploy and observe safely

Owner: Roadie and TAP platform operations.

- Back up/export the Roadie D1 database before its schema migration.
- Apply and verify the Roadie D1 migration in dev before deploying API code that
  depends on the new keys.
- Deploy the membership-authority fix and Roadie API to dev.
- Run the two-workspace tracer bullet against real dev workspaces.
- Add structured logs containing environment, operation, workspace ID,
  installation ID when available, authorization outcome, and a correlation ID;
  never log session credentials or private trip content.
- Monitor membership-resolution failures, cross-workspace invariant failures,
  D1 conflicts, and API 401/403/409/5xx rates.
- Promote environment-specific backend origins, TAP session issuers, and package IDs
  together; no TAP credential-origin allowlist exists.
- Roll back application code if required; restore D1 only from the pre-migration
  export after accounting for writes made after cutover.

## Sequence of implementation pull requests

1. **Characterization tests:** backend two-workspace tests that expose the
   current global-ID weakness, without changing production behavior.
2. **Tenant-key migration:** composite Roadie D1 keys and fully scoped queries.
3. **API contract hardening:** server-owned identity/ownership, validation,
   error codes, and idempotency.
4. **Client behavior:** durable local migration marker, cache isolation, and
   actionable membership-sync UI.
5. **Directory dev reconciliation:** use the existing platform migration and
   cutover tooling to make all dev workspaces authoritative.
6. **Real tracer bullet:** automate installation and isolation across two real
   dev workspaces.
7. **Production readiness:** production Roadie resources/origin, runbook,
   dashboards, backup, rollout, and rollback rehearsal.

## Decisions and open questions

The following must be agreed before implementation reaches production:

1. **Member editing policy:** may ordinary members edit only their own trips, or
   any workspace trip? Current code implements owner-or-admin edits.
2. **Trip visibility:** are all trips workspace-visible, or is private/team
   visibility required? Current behavior is workspace-visible.
3. **Installation multiplicity:** TAP currently allows one Roadie package per
   workspace. If the product later needs several named Roadie instances in one
   workspace, TAP's unique installation model and Roadie's schema must both add
   an instance/realm dimension; `installation_id` should not be added speculatively.
4. **Uninstall retention:** confirm how long `persistence: retained` data should
   survive and who can permanently erase it.
5. **Directory schedule:** can the dev Directory cutover be completed before the
   Roadie tracer bullet, or is a temporary platform membership facade required?
6. **Environment topology:** confirm separate Roadie D1 databases, Workers,
   exact miniapp-session audiences, TAP session issuers, and package IDs for
   development, staging, and production.
7. **Local migration ownership:** confirm that existing local Roadie trips were
   always workspace-scoped by TAP storage before they are automatically uploaded.
8. **SDK test baseline:** Roadie exact-pins the published
   `0.0.0-fix-roadie-dev-origin.1` canary. Move to SDK 0.8.0 after its
   app-scoped auth helper/verifier release, then regenerate the TAP test matrix
   before using it as a release gate.

## Definition of done

- Directory reconciliation shows all supported workspaces and joined members.
- Roadie's schema and queries structurally enforce workspace isolation.
- Automated negative tests demonstrate that client-controlled IDs cannot cross
  the boundary.
- The real two-workspace tracer bullet passes after restart and reinstall.
- Dev observability can identify membership drift without exposing user data.
- Deployment and rollback have been rehearsed and documented.

## Verification loop ledger

Run the automated gates from the repository root:

```sh
pnpm verify:roadie:loop
```

The command runs gates in dependency order and stops at the first failure. Fix
that failure and rerun the same command; a later gate is not treated as evidence
until all earlier gates pass.

| Gate | Evidence | Initial state |
| --- | --- | --- |
| Repository hygiene | `git diff --check` | Automated |
| Contract | Roadie contract typecheck | Automated |
| Backend compile | API typecheck | Automated |
| Backend behavior | API authorization and tenant-isolation tests | Automated |
| Backend deployability | Wrangler development dry-run | Automated |
| Miniapp compile | Roadie typecheck | Automated |
| Miniapp behavior | Roadie unit tests | Automated |
| Package | Roadie production build | Automated |
| TAP package policy | Manifest and generated-test verification | Automated |
| Directory parity | UI-visible workspace/member reconciliation report | Manual and pending |
| Real isolation | Two-workspace installed tracer bullet | Manual and pending |
| Production readiness | Backup, monitoring, deployment, and rollback evidence | Manual and pending |

The loop is deliberately bounded. It does not retry indefinitely, mutate remote
Directory data, deploy, or declare manual gates passed without captured evidence.

### Tracer-bullet execution ledger

| Stage | Result | Evidence |
| --- | --- | --- |
| Storage characterization RED | Confirmed | Global `trip_id` rejected the same ID in workspace B; the old itinerary foreign key accepted a workspace-B item pointing at a workspace-A trip |
| Workspace tenant keys GREEN | Passed | Composite trip/item keys, composite foreign key, and workspace-scoped conflict/delete operations; both isolation tests pass |
| Authorization characterization RED | Confirmed | Roadie accepted Directory principals returned for the wrong workspace or wrong user |
| Authorization GREEN | Passed | Principal workspace/user equality is enforced; four authorization tests pass |
| Client workspace switching | Passed | Distinct workspace A/B request bodies, workspace-keyed React Query keys, per-mount query client, and TAP workspace/package storage partition |
| Directory parity | RED | TAP mounted `org_df93b96b-e1f9-43a0-a8c5-5c897e5ae15b`, but `tap-directory-dev` contained neither that workspace nor a membership row for the resolved user |
| Installed two-workspace proof | Blocked | Requires Directory parity or a temporary authoritative membership facade before the second real workspace can open Roadie |
