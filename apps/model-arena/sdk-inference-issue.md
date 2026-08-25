# SDK 0.12 managed inference migration — resolved

Status: resolved in Model Arena on 2026-08-24.

The original Model Arena prototype used generic host HTTP plus an OpenRouter
credential reference because SDK 0.8 had no direct inference surface. SDK 0.12
now provides the host-managed capabilities the app needs:

- `sdk.inference.listModels()` returns models with eligible managed routes.
- `sdk.inference.send(...)` runs an isolated turn with explicit message history.
- `inference.list` and cost-bearing `inference.invoke` are separately authorized.
- Provider credentials, routing, cost attribution, and content-free turn telemetry
  stay in TAP; no provider secret enters the miniapp.

Model Arena now uses those APIs exclusively for direct model comparisons. The
legacy OpenRouter client, credential picker, arbitrary model ID entry, and
external-network permissions have been removed.

## Intentional boundaries

- SDK 0.12 inference is unary, so time-to-first-token is unavailable and shown
  as unknown rather than equated with total latency.
- The SDK does not expose arbitrary TRR event emission. TAP records canonical
  managed-inference telemetry; Model Arena writes separately labeled,
  content-free TRR-shaped audit records to its own VFS artifact set.
- Channel-less specialist calls reuse a private persistent TAP room. Benchmark
  specialist arms are therefore labeled contextual/stateful, not statistically
  isolated A/B arms.
- `sdk.trr.getEcrt()` requires `trr.read-cost` in addition to the general
  `trr.read` grant used by the other workspace aggregates.

The package has also moved to the SDK 0.12 Generation-2 authoring, build, check,
Test Lab, and publisher lifecycle.
