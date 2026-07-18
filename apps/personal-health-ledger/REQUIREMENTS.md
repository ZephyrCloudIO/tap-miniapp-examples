# Product-brief implementation checklist

This checklist is intentionally strict: checked items have executable code and test or live-browser evidence; unchecked items are not represented as working controls.

## Ledger, regimen, and administration

- [x] Empty private-ledger onboarding with no seeded domain records.
- [x] Canonical and display names, category, jurisdictional regulatory metadata, form, route, concentration, purpose, clinician, factual source record, notes, and clinician questions.
- [x] Active, paused, planned, and discontinued states with immutable dated status periods.
- [x] Immutable schedule periods with dose, unit, cadence, effective dates, and authoritative instruction source.
- [x] Observed administration statuses, planned-versus-actual timestamps, route/site, variation reason, reaction, and instruction source.
- [x] Confirmation-based manual entry; plans never become administrations automatically.
- [x] Duplicate/replay rejection, unit mismatch rejection, required actual timestamp, and negative-inventory protection.
- [x] Deleting an administration requires confirmation and restores its linked inventory arithmetic.
- [ ] Conversational or voice administration logging with structured read-back — blocked because SDK 0.0.1 exposes specialist turns but no package-local function-tool registration contract that can return a draft to this surface and commit only after its confirmation.
- [ ] Host reminders and allowed reminder windows — blocked by the absence of reminder/notification scheduling APIs in SDK 0.0.1.

## Inventory, orders, and reconstitution

- [x] Discrete lots/containers with received/current quantity, unit, container size, lot number, expiration, provenance, order reference, storage text, opened date, and condition.
- [x] Order lifecycle through ordered, confirmed, shipped, delivered, partially received, cancelled, returned, and disputed.
- [x] Run-out dose count plus a projected date only after repeated confirmed administrations establish an observed interval.
- [x] Reconstitution record with lot, labeled amount/unit, diluent identity/lot/volume, performer, authoritative source, storage, discard date, inspection notes, and displayed original-value formula.
- [x] Reconstitution arithmetic uses confirmed entered values only; no recipe, storage, discard date, or dose is inferred.
- [x] Lots, orders, reconstitution records, administrations, and other private records have confirmation-gated deletion with linked-history protection.
- [ ] Label, prescription, certificate, receipt, or photo attachment — blocked because SDK VFS only writes into an active conversation and exposes no package-scoped protected attachment read/list contract.
- [ ] Automatic reorder — intentionally omitted by the product safety boundary.

## Outcomes and safety

- [x] Symptoms, side effects, mood, energy, sleep, appetite, pain, recovery, weight, blood pressure, heart rate, labs, and custom outcomes.
- [x] Unit/reference range/source/collection time, notes, and concurrent training/diet/illness/travel/sleep confounders.
- [x] Timeline and per-measurement visualization use association-only language and never calculate across unlike units.
- [x] Mild, moderate, and serious adverse-event records with item, optional lot, timing, description, and action taken.
- [x] Prominent official emergency, Poison Control, and FDA MedWatch links for the configured U.S. jurisdiction; the app never attempts to manage an emergency conversationally.
- [ ] Protected photo/document outcomes — blocked by the same VFS attachment-read limitation.

## Research and Grok specialist

- [x] Saved approved-only/include-unapproved views with selectable human, registered-trial, animal, mechanistic, preprint, regulatory, expert-commentary, and web/X/forum evidence scopes.
- [x] Real package-owned managed specialist contribution with a private TAP channel.
- [x] Grok preference expressed as `xai/grok-latest`; runtime turns use `modelOverride: "auto"` so host policy resolves the allowed current model.
- [x] Real `web_search` and `web_fetch` tool-backed turns for research updates and anecdotal discovery.
- [x] Record audit, results review, and appointment-summary specialist tasks use user-approved minimum-necessary ledger excerpts.
- [x] Each turn requires explicit private-context approval; item research excludes ledger identity, clinician, notes, purpose, full regimen, and outcomes.
- [x] Research prompts apply the selected saved regulatory/evidence scope and require citations, primary-source retrieval, evidence labels, uncertainty, and no dose extrapolation.
- [x] Host-reported active model and success/failure tool receipts persist with every completed briefing; cited HTTP(S) URLs are rendered as safe links.
- [x] Specialist turn responses have runtime IDs, replay protection, channel provenance validation, owner-only mutation, reload persistence, and confirmation-gated deletion.
- [ ] Native Grok X Search — blocked because the current TAP host tool registry does not expose `x_search`. Anecdotal pulse may use indexed `site:x.com` web discovery and explicitly states that it is not native or exhaustive X Search.
- [ ] Durable PubMed/PMC, ClinicalTrials.gov, FDA/openFDA feeds, deduplicated research records, watchlists, last-reviewed cursors, and scheduled monitoring — blocked by absent SDK 0.0.1 source-connector, inbound-event, and scheduling contracts. Specialist web discovery is not misrepresented as a durable source feed.
- [ ] Followed-account refresh cadence and maximum X-search spend — omitted because native X Search is unavailable.
- [ ] Personal Knowledge Garden publication — omitted because no reviewed private knowledge-write contract is exposed to this miniapp.

## Storage, permissions, and data lifecycle

- [x] Packaged execution uses only optimistic-revision TAP storage; it never silently falls back to browser storage.
- [x] Browser preview uses a visibly separate origin-local key.
- [x] Schema v3 validates every entity shape, finite numeric boundary, relationship, stable ID uniqueness, replay uniqueness, inventory bound, and specialist channel provenance.
- [x] Schema-v1/v2 migration preserves records, adds deterministic status-history migration IDs, normalizes specialist receipts, and writes the migrated schema back to the authoritative store.
- [x] Owner/viewer domain guards, read-only UI, manifest permission levels, and specialist research permission/effects.
- [x] Runtime-generated stable entity IDs, immutable audit receipts, visible loading/saving/success/conflict/failure states, and refresh persistence.
- [x] Destructive operations use SDK confirmation dialogs; linked history fails visibly instead of being silently removed.
- [ ] Revocable cross-user sharing — not exposed because SDK 0.0.1 provides no package-scoped sharing grant/revocation API for this user-private ledger.

## Import, export, and reporting

- [x] Administration CSV export and validated confirmation-gated CSV import with quoted-field parsing, item/lot resolution, replay protection, unit checks, and inventory updates.
- [x] Printable HTML and plain-text clinician summaries.
- [x] Complete schema-versioned JSON archive export and validated confirmation-gated replacement that never imports an embedded viewer/owner elevation.
- [x] Conditional protected VFS summary export only when the host supplies VFS and an active conversation.
- [x] Viewer role cannot export, import, replace, or write ledger data.

## UI and verification

- [x] SDK UI theme/tokens, toolbar/status patterns, cards, forms, buttons, tabs, badges, progress, dialogs, empty/loading/error states, and dark-mode compatibility.
- [x] Task-centered information architecture: Today, Journey, Plan, Supply, Research, and Share; no repeated dashboard copy of the full plan, supply list, or export promotion.
- [x] Quick Add routes to real check-in, measurement, administration, context, and safety records; self-reported check-ins enforce a persisted 0–10 boundary.
- [x] Unified Journey timeline combines feelings, measurements, administrations, context, safety events, and immutable plan changes with user-controlled filters.
- [x] Desktop and compact layouts, keyboard focus, semantic headings/landmarks, accessible labels, long-content wrapping, no horizontal overflow, and reduced-motion handling.
- [x] Runtime-constructed tests cover empty state, creation, validation, migration, persistence serialization, role boundaries, state transitions, replay protection, conflicts, inventory arithmetic, CSV round trip, deletion reversal, prompt minimization, and specialist manifests.
- [x] Browser preview discloses unavailable host authority and never substitutes simulated specialist output.
