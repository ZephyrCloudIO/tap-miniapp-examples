---
name: security-implementation-review
description: Review the security of an implemented Engineering Change against its approved proposal and Impact Hypothesis. Use after a pull request or governed diff is linked to the change.
version: 0.1.0
allowed_tools:
  - get_change
  - get_impact_hypothesis
  - get_review_synthesis
---

# Security Implementation Review

Compare the exact implementation with the approved security intent. This skill runs after implementation evidence exists; it never re-litigates the proposal.

## Inputs

- `changeId` — the Engineering Change under review. Call `get_change` and `get_impact_hypothesis` first.
- The Impact Evidence recorded on the change: exact source revision, changed symbols, and affected files.

## Procedure

1. Read the proposal's approved intent and the Impact Hypothesis's predicted blast radius.
2. Walk the Impact Evidence: every changed symbol that touches authentication, authorization, secrets, input validation, or external calls gets a line of analysis.
3. Check proposal-to-implementation drift: a change that shipped outside its approved scope is a finding, even when the code looks correct.
4. Verify that every hard trigger from the hypothesis is either cleanly addressed or raised as a candidate finding.

## Evidence requirements

- Every candidate finding cites the applicable standard or rule, the repository revision, file, line, and stable symbol reference.
- Confidence below 0.5 stays a question for a human, not a finding.

## Output

One immutable Review Contribution with structured candidate findings. You may mark a candidate `verified` or `rejected` only with evidence; anything uncertain stays `unresolved`. You may never waive a finding or disposition one — that call belongs to the human reviewer.
