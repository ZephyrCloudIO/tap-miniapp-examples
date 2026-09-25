# Booking analytics review — 2026-09-24

Two review passes completed against `origin/main` at `d19f8aa` and read-only
production evidence collected around 2026-09-25 01:25 UTC.

## Findings

### P1: The screenshot's dashboard reports local activity as public analytics

Before `c28d123` (PR #52), the Booking Pages summary and Event Type cards read
`state.bookingProfiles[].eventTypes[].analytics`. Opening **Preview page**
incremented that local Event Type's `views` counter. The local booking flow
updated starts, requests, and confirmations in organizer state. Public guests
book through a separate application and gateway, which did not update those
local counters.

The screenshot's labels match that implementation, including
“Privacy-preserving, no fingerprinting” and the view-to-booking percentage.
Consequently, its 2 views and 0 confirmations are not authoritative public
traffic or booking totals. This is a data-source problem, not a rounding error.

Evidence: the parent of PR #52, `f1ca953`,
`apps/tap-calendar/src/app.tsx` lines 2931, 4447, 4572–4573;
`apps/tap-calendar/src/domain.ts`, `trackFunnel` and `schedulePublicBooking`.

### P1: The merged analytics fix has not been rolled out

PR #52 (`c28d123`) merged September 20 and adds the public visit ledger,
authenticated aggregation endpoint, public-page tracking calls, and organizer
refresh behavior. Production still predates it:

| Component | Read-only production evidence |
| --- | --- |
| Calendar gateway | Latest deployment: September 14, 22:47:56 UTC; version `1376635e-4750-4b6c-a3a0-5d53aed63d03` |
| Public booking app | Latest deployment: September 14, 22:48:54 UTC; version `ba0faede-94e4-4ba7-9b1f-03da40fb13e4` |
| Database | `public_booking_funnel_visits` does not exist; `d1_migrations` has no migration numbered 0017 or later |
| Served public application | `/static/js/index.b612719ba0.js` contains neither the analytics endpoint nor `visitId` tracking |

Merging the code did not update these production components. The screenshot
also shows the pre-fix organizer UI; the installed organizer package version
was not independently inspected.

### Historical visitor activity is missing, not zero

The application was not collecting public views, slot views, or starts. The
booking ledger cannot reconstruct visitors who never booked. Existing public
bookings are recoverable immediately through the new aggregation query, but
pre-deployment visitor counts cannot be accurately backfilled from those
records. Dividing lifetime bookings by newly collected views would produce a
misleading conversion rate. PR #52 already suppresses that live percentage and
explains the differing coverage periods.

## Pass 1: Trace collection through display

- Traced the screenshot's local counters and the replacement gateway projection.
- Reviewed visit-ID validation and upsert behavior: one view per anonymous page
  visit; later stages imply earlier stages; duplicate and reordered stage
  submissions do not increment the same visit twice.
- Checked that guests cannot submit requests or confirmations as analytics
  stages. Booking counts derive from committed server attempts.
- Checked identity scoping, stable profile/Event Type IDs, refresh behavior,
  unavailable counters on initial failure, and retained totals with an error
  message after subsequent failures.
- The newer production view does not use persisted preview counters as a
  fallback and does not calculate a historical conversion rate.

## Pass 2: Reconcile records, deployment, and lifecycle behavior

The production query joined public booking attempts to their immutable page
revisions, pages, and profiles, then joined scoped provider commits and booking
management records. It selected aggregate counts only for profile `zack`; no
guest details or credentials were retrieved.

For `zack/30-min`:

| Server evidence | Count |
| --- | ---: |
| Committed attempts originally confirmed | 12 |
| Still marked confirmed | 11 |
| Subsequently cancelled | 1 |

“Still marked confirmed” does not mean all 11 meetings are in the future.
The existing fix deliberately defines **Confirmed bookings** as lifetime
confirmations, including later cancellations; its expected value is **12**.
A metric excluding cancelled bookings would be **11** and should be defined
and labelled separately. Neither interpretation supports the screenshot's 0.

Reviewed aggregation across publication revisions, approval outcomes,
cancellation history, provider cleanup, and retry/reschedule handling. Existing
gateway regression tests exercise anonymous-stage deduplication, owner/workspace
isolation, historical revisions, pending/declined exclusion, approval history
after provider cleanup, and a successful booking's analytics result. No further
blocking defect was established in the reviewed individual-page counting path.

Validation on `d19f8aa`:

- Organizer: 260 tests passed; TypeScript passed.
- Public booking app: 40 tests passed; TypeScript passed.
- Gateway: 187 tests passed; TypeScript passed.

These are local regression results, not evidence that the new code is deployed.

## Required rollout

Use a tested release containing PR #52. Apply its database migration before
deploying the gateway, deploy the public booking app, and publish/install the
updated organizer miniapp package. All three applications participate in this
feature. If releasing current main, account for its additional migration 0018
and collective-booking changes; an analytics-only release should be scoped to
the analytics fix rather than implicitly shipping unrelated changes.

After rollout, verify the organizer returns the historical booking total and
records a controlled public visit/start exactly once. Existing visits from
before tracking must remain explicitly unavailable as historical traffic.

This review made no production writes, migrations, deployments, or bookings.
The existing source fix was already present; this change records the verified
cause and release gap rather than duplicating that implementation.

## Follow-up implementation

The user selected current confirmed bookings as the primary metric, with lifetime
confirmations and cancellations separate. Per-page-visit traffic was the stated
default; no persistent visitor identity is used.

The follow-up adds v2 status totals and coverage/freshness metadata, matched-visit
conversion, server-side recording during page loading, retried stage delivery,
first-claim booking attribution, and transactional confirmation history. Legacy
v1 consumers retain lifetime confirmation semantics. A production publishing
guard checks the migration, gateway, served tracker, and organizer artifact.

Two additional passes reviewed the changed data path and the lifecycle/release
path. Lifecycle regression tests caught D1 trigger writes increasing
`meta.changes`; first-claim and approval transition detection now correctly use
positive affected-row counts. Route tests cover the new visit-ID query allowlist
as well as idempotence and current/lifetime separation.

Validation: organizer 264 tests (including 3 release-guard tests), public app 44
tests, and gateway 189 tests passed; targeted gateway checks were repeated after the final
route changes. All three typechecks and production artifacts passed. The installed
organizer was independently inspected and is marketplace release 0.1.10. Release
0.2.1 was built and published for package upgrade. CI exposed that the new
release tests used Node's runner while the workspace discovers tests with Rstest;
they now use Rstest and pass in the complete organizer suite.

## Production rollout evidence

- Applied pending migrations 0016–0019 successfully on September 25 UTC.
- Gateway version: `e3298686-f015-4c21-9b98-62b5797dec66`.
- Public application version: `5dd858ac-fa28-4350-bc2d-70d2c0a0da5d`.
- Live readiness endpoint confirms analytics v2 and traffic/conversion coverage
  beginning `2026-09-25T01:51:00.033Z`.
- Read-only post-migration reconciliation still returns 11 current confirmations,
  12 lifetime confirmations, and 1 cancellation for Zack's page.
- A controlled browser visit to `zack/30-min` recorded exactly one view, slot
  view, and start. Returning to time selection and then guest details left all
  three at one. No booking was submitted and no guest details were entered.
  This validation visit remains included in the real traffic ledger.
- Production publishing guard passed against the deployed gateway, tracker,
  and organizer artifact. Organizer 0.2.1 is hosted at
  `https://zackary-chapple-16831-tap-calendar-tap-miniapp-ex-185e8392b-ze.zephyrcloud.app/`.
- Published and installed release `tap_rel_1_Ipu1RLo39WVK5VUdhwrpRg` of existing
  package `tap_pkg_1_hksgns5c1ySs2NZHQhzF1w`, preserving installation
  `9b181273-a37f-4582-a4fe-5283aa6ad877` and the existing booking profile.
- The installed dashboard and Insights both display 11 current confirmations,
  12 lifetime confirmations, 1 cancellation, 1 view, and 1 start. Insights shows
  all outcome counts, coverage time, and the explicit historical-traffic gap.
  Matched conversion correctly shows 0/1; historical bookings are excluded from
  this new visit cohort.
- Integrated concurrently merged main changes (#78 and #79), retaining both
  booking details and first-claim visit attribution. All three typechecks and
  the combined suites pass: organizer 273, public 44, gateway 194 tests.
  The verified production artifact is the analytics release built before those
  unrelated main changes; their deployment is not claimed by this review.
