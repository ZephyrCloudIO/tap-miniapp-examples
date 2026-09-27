# Workspace authorization and host discovery integration

Research date: 2026-09-20. Read-only source inspection of `/Users/zackarychapple/code/ze-agency-tauri` at local HEAD `d9a478ec41`. This confirms the available source contract, not which revision is deployed. No other repository was edited and no live authorization calls were made.

## Existing actions and authoritative decisions

Use **`workspace:manage`** for claiming/managing workspace-owned booking profiles. It already exists in the canonical action vocabulary. The default workspace policy grants it to `owner` and `admin`; `workspace:settings:update` is another existing administrative action, but `workspace:manage` is the direct general-management capability. Do not invent `workspace:write` or `workspace:admin`. Check the action result rather than reconstructing authorization from a role string, so workspace policy remains authoritative. ([action vocabulary](/Users/zackarychapple/code/ze-agency-tauri/platform-rails/identity-authz/contracts/src/workspace-actions.ts:184), [default workspace policy](/Users/zackarychapple/code/ze-agency-tauri/platform-rails/identity-authz/cerbos/policies/resource/workspace.yaml:18))

The existing public `AuthzRpc` exposes both subject-based and canonical-user-based checks. Calendar already binds this entrypoint; no new authorization service method is required. ([entrypoint](/Users/zackarychapple/code/ze-agency-tauri/platform-rails/identity-authz/worker/src/index.ts:75))

### Authenticated organizer, identified by JWT subject

```ts
checkWorkspaceAccessBySubject(input: {
  organizationId: string;
  externalSubject: string;
  email: string | null;
  emailVerified: boolean;
  actions?: string[];
  correlationId?: string;
}): Promise<{
  allowed: boolean;
  member: boolean;
  canonicalUserId: string;
  role: "owner" | "admin" | "member" | "view_only" | null;
  actions: Record<string, boolean>;
}>;
```

This resolves the subject into Directory's canonical `users.id`, reads active membership, then evaluates Cerbos. `allowed` requires membership **and every requested action**; it is not merely a membership flag. For a management mutation, request `['workspace:read', 'workspace:manage']` and require both actions. If returning optional management capability on an ordinary reader endpoint, inspect the individual decisions instead of denying the reader because the combined `allowed` is false. The Calendar gateway's current `readonly ["workspace:read"]` argument is narrower than the real contract. ([canonical contract](/Users/zackarychapple/code/ze-agency-tauri/platform-rails/identity-authz/contracts/src/index.ts:240), [runtime semantics](/Users/zackarychapple/code/ze-agency-tauri/platform-rails/identity-authz/worker/src/runtime.ts:1274))

### Enrolled host, identified by canonical user ID

The minimal invocation is:

```ts
const decision = await authz.checkWorkspacePrincipalActions({
  organizationId: workspaceId,
  userId: enrolledHost.canonicalUserId,
  actions: ["workspace:read"],
});
const isCurrentMember =
  decision.role !== null && decision.actions["workspace:read"] === true;
```

The exact canonical input type is `Omit<CheckWorkspaceActionsInput, 'role'>`; its required fields are `organizationId: string`, `userId: string`, and `actions: string[]`. Optional context fields include `correlationId`, `targetUserId`, `workspaceResourceContext`, `cuContext`, and `trrContentContext`; none are needed for the read check above. The result is **`{ actions, role }`**, with no `allowed`, `member`, or canonical ID field. The runtime reads Directory membership itself; do not call the trusted, role-asserting `checkWorkspaceActions` with a stored/client-provided role. ([input/result types](/Users/zackarychapple/code/ze-agency-tauri/platform-rails/identity-authz/contracts/src/index.ts:179), [public method contract](/Users/zackarychapple/code/ze-agency-tauri/platform-rails/identity-authz/contracts/src/index.ts:322), [runtime](/Users/zackarychapple/code/ze-agency-tauri/platform-rails/identity-authz/worker/src/runtime.ts:1240))

Directory's principal-context query requires `status = joined`, a non-deleted workspace, a canonical user ID, and a bound user-email ID. A removed member, unclaimed invite, or deleted workspace therefore loses this proof. Treat a missing/false grant as denied and transport/authority failure as unavailable; do not use an old local enrollment row as current membership authority. ([Directory principal-context query](/Users/zackarychapple/code/ze-agency-tauri/workers/directory-api/src/infrastructure/sqlite/directory-read-repo.ts:297))

TAP's published client is `createAuthzClient({ binding: env.AUTHZ_API })` from `@zephyrcloudio/authz-rpc-client`; it validates the public binding shape. Host-repository architecture requires consumers to use that client and contract rather than importing rail internals or introducing a second role policy. ([client](/Users/zackarychapple/code/ze-agency-tauri/platform-rails/identity-authz/client/src/index.ts:39), [architecture rules](/Users/zackarychapple/code/ze-agency-tauri/docs/agents/architecture-rails.md:97))

## Canonical roster and workspace metadata

Directory owns the canonical workspace, membership, and public-profile data. Its proto defines these existing operations; generated JSON field names are camelCase:

```ts
getWorkspace({ workspaceId, includeDeleted: false })
// => { workspace?: { workspaceId, slug, displayName, iconUrl?,
//                   createdBy, createdAt, updatedAt, deletedAt?, lifecycleVersion } }

listMembers({
  workspaceId,
  statuses: ["WORKSPACE_MEMBERSHIP_STATUS_JOINED"],
})
// => { members: [{
//      membership: { workspaceId, membershipId, userId?, userEmailId?,
//                    invitedEmail, status, role, ... },
//      profile?: { userId, name?, picture?, handle?, title?, timezone? },
//      externalSubjects: string[]
//    }] }
```

Use `membership.userId` as the canonical identity. `externalSubjects` are aliases, not membership IDs. Explicitly request/filter `JOINED`; an empty status list defaults to invited plus joined members. The roster is not inherently a bookable-host list: intersect it with Calendar enrollment, consent, and healthy provider configuration. ([workspace and membership fields](/Users/zackarychapple/code/ze-agency-tauri/protos/proto/tap/directory/v1/directory_api.proto:577), [workspace request](/Users/zackarychapple/code/ze-agency-tauri/protos/proto/tap/directory/v1/directory_api.proto:674), [roster request](/Users/zackarychapple/code/ze-agency-tauri/protos/proto/tap/directory/v1/directory_api.proto:817))

Existing helpers `readDirectoryWorkspace(binding, request, options?)` and `readDirectoryMembers(binding, request, options?)` validate generated response schemas, enforce deadlines, and reject mismatched workspace/profile IDs. Do not copy another service's database schema or query its D1 directly. ([transport helpers](/Users/zackarychapple/code/ze-agency-tauri/silos/directory/packages/directory-client/src/index.ts:258))

Ordinary workspace members can enumerate the joined roster through the authenticated public Directory Connect API. Its `ListMembers` ingress requires **`workspace:members:list`**, granted by the default policy to owner/admin/member/view_only. Callers with invite permission may also see invited rows; others are forced to joined-only. `GetWorkspace` requires `workspace:read` and forces `includeDeleted: false`. Internal service-binding reads rely on the caller to authorize first. ([public ingress](/Users/zackarychapple/code/ze-agency-tauri/workers/directory-api/src/public-ingress.ts:380), [default roster permission](/Users/zackarychapple/code/ze-agency-tauri/platform-rails/identity-authz/cerbos/policies/resource/workspace.yaml:6), [proto authority comments](/Users/zackarychapple/code/ze-agency-tauri/protos/proto/tap/directory/v1/directory_api.proto:132))

**Binding boundary:** no Calendar-specific Directory service entrypoint exists in the inspected source. `MiniappsDirectoryRpc` exposes only `getWorkspace` and `resolveCanonicalUser`. Roster reads exist on the separate Chat/ChatV2 consumer entrypoints. The published RPC contract deliberately separates consumer authority; do not bind Calendar to the broad Chat service just to obtain `listMembers`. A direct server-side Directory integration should have a deliberate narrow contract/binding, or use the existing authenticated Connect operation in a user-authorized context. ([consumer method contracts](/Users/zackarychapple/code/ze-agency-tauri/silos/directory/packages/directory-rpc-contracts/src/rpc.ts:1), [Miniapps methods](/Users/zackarychapple/code/ze-agency-tauri/silos/directory/packages/directory-rpc-contracts/src/rpc.ts:115), [ChatV2 methods](/Users/zackarychapple/code/ze-agency-tauri/silos/directory/packages/directory-rpc-contracts/src/rpc.ts:197))

For a verified workspace name, resolve Directory metadata by the authorized stable workspace ID, reject a missing/deleted workspace or mismatched ID, and validate the display name. The existing Miniapps publisher implementation trims it, requires nonempty text, rejects control characters, and limits it to 256 UTF-8 bytes. A name supplied in browser context can be an editable display label, but must not establish workspace identity or ownership. Store ownership against workspace ID rather than a mutable slug or name. ([existing safe display-name implementation](/Users/zackarychapple/code/ze-agency-tauri/silos/miniapps/workers/miniapps-api/src/workspace-profile.ts:21))

## Minimal integration for the authorized Calendar implementation

1. Require the existing `workspace:manage` capability for workspace profile claims and collective-link management. Preserve canonical organizer identity from subject-based authorization.
2. Let a user enroll themselves as a workspace booking host only under their server-resolved canonical identity. Calendar owns this booking consent/configuration; it does not own membership.
3. Managers can select from Calendar's workspace-scoped opted-in host registry. Recheck each enrolled user's `workspace:read` with `checkWorkspacePrincipalActions` before listing them as eligible, serving public availability, and confirming a booking. This supports the required feature without first adding an entire Directory roster integration.
4. Reject missing membership or revoked consent; keep authorization outages distinct from denials. A booking must not proceed when any required host cannot be validated.
5. Add a narrow Directory metadata/roster integration only if canonical organization branding or browsing not-yet-enrolled members is required. The existing authz response intentionally contains no workspace display name and cannot authenticate a name supplied by the client.

The host opt-in plus per-host canonical membership check is supported by today's public AuthzRpc. Full canonical roster/branding lookup has existing Directory operations, but Calendar's current binding configuration does not expose them.
