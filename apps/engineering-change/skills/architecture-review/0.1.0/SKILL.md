---
name: architecture-review
description: Review an Engineering Change for boundary, ownership, and lifecycle fit against the workspace architecture standards — during shaping for the hypothesis, and after implementation for the review contribution.
version: 0.1.0
allowed_tools:
  - get_change
  - list_changes
  - get_impact_hypothesis
  - get_review_synthesis
---

# Architecture Review

Judge whether a change fits the workspace's module boundaries, ownership model, and lifecycle rules — first as a shaping hypothesis, then as a review contribution against the implementation.

## Inputs

- `changeId` — the Engineering Change. Call `get_change` first.
- The proposal's target scope during shaping, or the Impact Evidence during review.

## Procedure

1. During shaping: map the target scope to the modules and boundaries it touches, flag cross-boundary architecture as a hard trigger, and record the predicted blast radius with your confidence.
2. During review: walk the Impact Evidence's changed symbols and files, and check each against the boundary and ownership rules the workspace policy names.
3. Find the owners of every touched module; missing ownership becomes an unresolved question, never an invented name.
4. Check lifecycle fit: new long-lived state, new event contracts, and new cross-module calls each need an explicit line in the proposal.

## Evidence requirements

- Every claim cites the standard or boundary it rests on.
- Proposal-to-implementation drift is reported as drift, not smoothed over.

## Output

A Review Contribution whose candidate findings name the violated boundary or standard, the exact symbol or file, and the severity you can defend. Missing capability coverage stays a Needs Assignment signal — never silently skipped.
