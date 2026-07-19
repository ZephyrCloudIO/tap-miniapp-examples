# Family Task Board implementation checklist

This checklist is the completion contract derived from `miniapps/01-family-task-board.md`. An item is only marked complete when it has implementation and verification evidence.

## Data and architecture

- [x] Starts empty with no hardcoded household records.
- [x] Runtime-generated record IDs and ISO timestamps.
- [x] Explicit preview storage separated from packaged TAP storage.
- [x] Storage failures are visible and never silently fall back.
- [ ] Application-owned HTTP API for all resources.
- [ ] Boundary validation for every stored/API resource.
- [ ] Schema migrations beyond rejecting unknown schema versions.
- [ ] Household scoping derived from authenticated identity.
- [ ] Concurrent-write conflict recovery.
- [ ] Resettable demo household generated through an API fixture command, isolated from production data.

## Households and roles

- [x] Create household and parent.
- [x] Add children.
- [x] Parent and child views.
- [ ] Authenticated guardians, memberships, and role assignments.
- [ ] Server-side authorization for parent-only and child-only mutations.
- [ ] Multiple guardians.

## Chores

- [x] Create and assign a one-time chore to one child.
- [x] Required and extra-credit designation.
- [x] Star value, due description, duration, submission, and approval.
- [x] Replay-safe chore award.
- [ ] Assignment to multiple children.
- [ ] Rotation assignments.
- [ ] Recurrence rules and generated occurrences.
- [ ] Due timestamps and reminders.
- [ ] Configurable approval requirement.
- [ ] Child submission note.
- [ ] Child photo attachment through VFS.
- [ ] Rejection/revision flow.

## Star ledger

- [x] Append-only chore earnings, bonuses, deductions, and purchases.
- [x] Parent adjustment requires a note.
- [x] Ledger actor, transaction type, and related entity IDs for implemented transactions.
- [ ] Confirmation dialog for deductions.
- [ ] Refund transaction flow.
- [ ] Complete transaction-history UI.
- [ ] Server-enforced prevention of direct balance edits.

## Child-to-child transfers

- [x] Sender proposal with amount and note.
- [x] Sender confirmation.
- [x] Receiver acceptance or decline.
- [x] Atomic ledger movement only after both confirmations.
- [x] Parent review history.
- [x] Configurable transfer limit.
- [x] Parent approval above a configurable threshold.

## Family shop

- [x] Parent-created reward with price, description, icon, and optional inventory.
- [x] Child purchase deducts stars and creates a request.
- [x] Parent can mark a reward consumed.
- [x] Enforced approval, ready, declined, cancelled, expired, and refunded transitions with compensating ledger refunds.
- [ ] Image/VFS attachment.
- [ ] Availability schedule.
- [ ] Per-child limit and eligibility rules.
- [ ] Configurable approval requirement.
- [ ] Inventory decrement and restoration rules.
- [ ] Shared/group rewards.

## Calendar and planning

- [x] Parent-created activities appear beside chores.
- [ ] Real external calendar HTTP integration.
- [ ] Deadline-aware daily planning.
- [ ] Available-time calculation around activities.
- [ ] Reminders and notifications.

## Chloe and TAP

- [ ] Structured read tools for daily plan, balances, progress, schedules, and pending rewards.
- [ ] Structured mutation tools for chores, adjustments, purchases, and consumption.
- [ ] Consequential-action confirmation through TAP consent.
- [ ] Installed Family specialist using the shared application API.
- [ ] Child and parent natural-language scenarios verified end to end.
- [ ] Published domain events and notification subscriptions.
- [x] Persistent surface and lifecycle checkpoint declaration.
- [ ] Mobile TAP surface target in addition to responsive desktop UI.
- [ ] External HTTP effect declaration for the application API.

## UI and verification

- [x] SDK 0.2.0 UI primitives and appearance synchronization.
- [x] Empty onboarding and management forms.
- [x] Responsive desktop and compact layouts.
- [x] Visible loading, empty, storage-error, and success states.
- [ ] URL/deep-link synchronization for tabs.
- [ ] Confirmation/undo for destructive actions.
- [ ] Full accessibility audit with all findings resolved.
- [ ] Screenshots for all required states from the final implementation.
- [ ] Live API, persistence, permissions, console, and reload verification.

## Current completion status

`INCOMPLETE — WORK REMAINS`

The present implementation is a data-driven local/TAP-storage client, not the complete multi-user API-backed product required by the approved brief.
