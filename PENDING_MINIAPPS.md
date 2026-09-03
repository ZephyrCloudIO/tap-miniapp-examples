# Pending miniapps

This list tracks publication blockers in `tap-miniapp-examples`. These sources remain in the repository but have no publisher configuration until their blockers are resolved.

| Package | Pending component | Blocker |
| --- | --- | --- |
| Brainrot Tower Defense | State MCP runtime | Agency converts source-lock digests to runtime SRI values without recomputing QuickJS expose integrity. Runtime reconciliation rejects `./mcp/brainrot-td-state-server`. |
