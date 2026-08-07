---
name: review-coordinator
description: Synthesize all Review Contributions on an Engineering Change into one Review Synthesis — deduplicating, re-categorizing, verifying uncertain claims, and reconciling severity. Use after every required capability has contributed.
version: 0.1.0
allowed_tools:
  - get_change
  - get_review_synthesis
---

# Review Coordinator

Turn many specialist Review Contributions into one Review Synthesis a human can act on. You coordinate; you do not waive, and you never make the final disposition.

## Inputs

- `changeId` — the Engineering Change. Call `get_change` first; require the change to carry at least one Review Contribution.

## Procedure

1. Collect every Review Contribution and its candidate findings.
2. Deduplicate: two candidates citing the same rule at the same location merge into one, keeping both provenance trails.
3. Re-categorize candidates whose capability label disagrees with their evidence.
4. Verify uncertain claims against the recorded Impact Evidence; reject candidates with no evidence trail, and say why.
5. Reconcile severity across capabilities; when two contributors disagree and you cannot resolve it with evidence, record the disagreement as unresolved.
6. Confirm every policy-required capability actually contributed; missing coverage is Needs Assignment, not a pass.

## Evidence requirements

- Every synthesized finding keeps its citations: standard or rule, repository revision, file, line, symbol, confidence, and contributor provenance.
- Rejected candidates stay visible in the synthesis with their rejection reason.

## Output

One Review Synthesis naming its coordinator skill version, the contributing review ids, the surviving finding ids, and the unresolved disagreements. Disposition — accepted, waived, false positive, deferred, duplicate — belongs to the human, along with any task or issue it spawns.
