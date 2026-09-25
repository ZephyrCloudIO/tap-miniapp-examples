# TAP Email send-time attribution

Implemented against tap-miniapp-examples main `06537e2` and the merged upstream
[PR #11059](https://github.com/ZephyrCloudIO/ze-agency-tauri/pull/11059), commit
`cd5f220cbb6650d8a72bbd676f5ef87b3ed1fbe6`. SDK `0.19.0` is published to npm and
pinned in TAP Email; the declared native host minimum is `2.24.0`.
[Issue #11055](https://github.com/ZephyrCloudIO/ze-agency-tauri/issues/11055)
tracks the remaining live integration and rollout work.

## Delivered behavior

Saved TAP drafts use `multipart/alternative`, with escaped HTML as the preferred
last alternative and plain text as a compatibility fallback. Composer state and
saved provider drafts contain no generated footer. At final send the coordinator
adds:

> Sent with TAP Email on The AI Platform

Only **The AI Platform** is linked in HTML. Plain text includes a readable URL.
The footer follows the current body and typed signature. Arbitrary provider HTML
is preserved, with the footer inserted before the closing body tag when present.
There is no heuristic to relocate a footer around pasted or provider-created
quoted history; historical footers are not deleted.

A reused Gmail draft is fetched in raw form so Gmail-side edits, recipients,
reply headers, inline resources, and attachments survive. The footer is applied
in the final `drafts.send` replacement MIME; the saved draft stays clean even
when sending fails. Signed/encrypted, malformed, and unsupported body structures
fail without sending. A MIME header makes decoration idempotent. Message-ID
reconciliation and command/draft leases retain their existing behavior.
[Gmail draft lifecycle](https://developers.google.com/workspace/gmail/api/guides/drafts),
[MIME alternatives](https://www.rfc-editor.org/rfc/rfc2046#section-5.1.4).

## Identity and durable attribution

The miniapp captures `userId` and `workspaceId` when creating a send or schedule
command, stores that intent in the durable payload, and forwards it as the SDK's
`expectedContext` on `platform-session` HTTP requests. Local dispatch waits when
the mounted context differs. The native host enforces the equality precondition;
returning to the original context permits resumption. Browser and mobile hosts
reject this precondition with `http_context_unsupported`.

The coordinator retains session audience and `tap-email.manage` checks. It uses
the same authenticated bearer for Directory `GetCurrentUser` and
`GetPrincipalContext`, verifies membership and exact user/workspace equality,
and binds the authenticated profile to that canonical user. Profile IDs are not
assumed to equal user IDs. A conflicting profile/user crosswalk is rejected.
Credentials are neither stored with commands nor forwarded to the public link.

Migration `0013_sender_attribution.sql` adds an audited profile/user crosswalk
and server-owned command attribution. Each accepted command gets a globally
unique publisher idempotency key. Duplicate requests cannot change attribution;
command acceptance and attribution are committed in the same D1 transaction,
so a failed attribution write cannot leave dispatchable work behind.
scheduled dispatch copies the original key and context atomically with its
outbox record. Reconciliation uses the original context and cached referral URL.
The stored canonical IDs are backend metadata, never URL parameters.

New production sends require context. Previously accepted commands without it
retain their legacy send/reconciliation behavior; no attribution is invented
for them. Explicit local development fixtures can omit context.

## Referral and PostHog ownership

The coordinator calls the private named Worker RPC:

```ts
WEBSITE_REFERRALS.publishTapEmailLink({
  acceptedCommandId,
  referrerUserId,
  referrerWorkspaceId,
}); // { referralId, url }
```

The configured production target is
`tap-website-referrals-production#WebsiteReferralsPublisher`; the development
target is `tap-website-referrals-dev#WebsiteReferralsPublisher`. A narrow local
TypeScript port mirrors upstream `WebsiteReferralsPublisherRpc` at the pinned
merge commit and validates returned URLs. This avoids requiring private GitHub
Packages credentials just to build this repository.

The website owns the random token, canonical URL, public redirect, and PostHog
capture. Links have this shape:

```text
https://theaiplatform.app/refer/<32-hex-token>?utm_source=tap_email&utm_medium=email&utm_campaign=sent_with&utm_content=signature
```

The coordinator persists the returned link before contacting Gmail. Publisher
failures keep delivery retryable; the next attempt uses the same publisher key.
There is no fallback to unverified identity or a generic attributed URL.

Upstream's public route resolves sender/workspace server-side, stores a click
before redirecting, and emits personless `tap_email_referral_clicked` events
with explicit referrer properties. It owns PostHog retries/deduplication, scanner
classification, opt-outs, rate limiting, `HEAD`, and unknown/disabled tokens.
TAP Email does not emit a click event when a link is created or an email is sent.
It does not identify the clicking visitor as the sender. Signup conversion
tracking is separate and remains disabled upstream pending its policy review.
[Upstream implementation and validation](https://github.com/ZephyrCloudIO/ze-agency-tauri/pull/11059).

## Validation and rollout

Local tests exercise preferred HTML, footer-free saved drafts, both body formats,
repeat decoration, authoritative Gmail edits, reply threading, binary attachments,
inline images, attached email, invalid MIME, Directory identity failures,
profile crosswalk conflicts, changed command intent, delayed dispatch, restart,
publisher outage retries, and explicit uncertain-send reconciliation. The
named Worker RPC binding is also exercised against a local publisher fixture;
URL validation rejects identity overrides and noncanonical campaign parameters.
Introspection outages remain distinct from denied actions and cannot redirect
the authenticated request to a different endpoint. The
published SDK transport test checks the captured context is forwarded. Builds
cover preview, desktop, QuickJS, package integrity, and the production Worker.

Before production activation:

1. Apply coordinator migration 0013. Deploy the website referral service and its
   D1 migrations/PostHog configuration through its existing Website workflow,
   then deploy the coordinator with the named Service Binding.
2. Verify the configured introspection endpoint and Directory APIs using the
   real host-injected session. Configuration and fixture tests do not establish
   that deployed authentication works. Test account/workspace switch and resume
   using a native host at least 2.24.0.
3. Resolve the remaining **background send-permission recheck** in #11055.
   Current coordinator behavior authorizes the accepted command and rechecks
   that the connected Gmail account remains active at execution. It does not
   yet re-evaluate a subsequently revoked TAP workspace/action grant during
   delayed delivery. Upstream's recipient example injects `EmailAuthority.canSend`;
   it does not expose a deployed backend implementation of that check. Directory
   identity or `workspace:read` alone must not be substituted for send authority.
   This change does not store session bearers or invent an authorization endpoint.
4. Validate a controlled delivered message and Sent copy, then open its link
   without login and verify the stored referrer properties in PostHog. Confirm
   redirects and recoverable analytics delivery during an outage. No live email,
   production migration, deployment, or PostHog capture was performed here.

SDK 0.19 also changes Tasks to phases and `dueAt`. The email-to-task adapter uses
`initialPhase: inbox` and the current due-date field. Obsolete task channel,
assignee, project, and status options are no longer sent to the host.
