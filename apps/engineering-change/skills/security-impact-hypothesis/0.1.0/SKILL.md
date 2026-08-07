---
name: security-impact-hypothesis
description: Produce a security Impact Hypothesis while an Engineering Change is still shaping — before any implementation exists. Use when a change is in draft or shaping and its proposal names a target scope.
version: 0.1.0
allowed_tools:
  - get_change
  - list_changes
  - get_impact_hypothesis
---

# Security Impact Hypothesis

Predict the security surface of a change from its proposal intent and target scope. This skill runs before implementation; it never inspects a diff.

## Inputs

- `changeId` — the Engineering Change to analyze. Call `get_change` first and require a non-empty proposal.
- The change's effective policy snapshot, when frozen, tells you which hard triggers already fired.

## Procedure

1. Read the proposal's intent, target scope, and rollback story. Do not invent scope the author did not write.
2. Map the target scope onto the workspace's security hard triggers: authentication, authorization, persistent-data migration, public contracts, destructive behavior, privacy.
3. For each trigger that plausibly applies, record the concrete symbol, boundary, or data class at risk — never a generic warning.
4. Rate your own confidence. Below 0.5, say so and list the unresolved questions a human must answer.

## Evidence requirements

- Every claim cites the proposal section it came from.
- Every hard-trigger match names the trigger exactly as the policy spells it.

## Output

Record the hypothesis through the change's Impact Hypothesis: related symbols at risk, likely security owners, applicable policies, predicted blast radius, confidence, and unresolved questions. If a hard trigger fires, the assurance level must escalate — recommend the escalation; never apply it silently.
