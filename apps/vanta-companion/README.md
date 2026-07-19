# Vanta Companion

Vanta Companion is a governed SOC 2 operating surface for TAP. It installs a managed specialist connected to Vanta's official regional remote MCP server and keeps Vanta as the system of record.

## Vanta integration

- Official remote MCP endpoints for US, EU, and Australia with host-managed OAuth.
- Exact 45-tool read allowlist verified against `@vantasdk/vanta-mcp-server@1.2.0`.
- Specialist routes for readiness, failing tests, documents/evidence, controls, people/devices, vendor risk, vulnerabilities, Trust Center, integrations, remediation planning, and custom questions.
- A visible coverage workspace mapping all 43 current Vanta API reference families.
- A complete 52-method inventory of `vanta-auditor-api-sdk@0.9.10`, surfaced honestly as API-only until a host-managed Vanta credential and per-method execution adapter are configured on the TAP SDK HTTP bridge.
- A companion Cloudflare Worker that verifies raw-body Svix signatures, durably deduplicates deliveries in D1, and exposes an event-metadata feed through Cloudflare Access.

The installed specialist cannot mutate Vanta. API-only and write operations have no executable controls and are never simulated.

## Persistence

Packaged state uses revisioned `sdk.storage`. Browser preview uses a separate namespaced `localStorage` key and never becomes a packaged fallback. Credentials and tokens are never accepted or stored by the miniapp.

The optional webhook API origin is configured by a compliance lead and persisted in the same workspace-scoped store. The UI sends credentialed requests only to that explicitly configured HTTPS origin. See [`../vanta-companion-api/README.md`](../vanta-companion-api/README.md) for deployment and Access policy requirements.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm validate:manifest
pnpm build
```

See [REQUIREMENTS.md](./REQUIREMENTS.md) for verified coverage and blocked product-brief requirements.
