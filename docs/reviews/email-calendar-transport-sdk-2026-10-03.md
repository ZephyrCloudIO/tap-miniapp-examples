# Calendar attachment transport and SDK upgrade — two review passes

## Confirmed failure

The native 1.0.4 validation showed a calendar-load error for Andrea and Nestor's acceptance messages; Save failed on the same attachment. The reader shared `downloadAttachment()` for both operations. It requested `application/octet-stream` with `credentialRef: platform-session` and required an untruncated binary response.

The TAP host's `redact_response_patterns()` in `silos/miniapps/crates/tap-miniapps/src/api_workbench_plugin.rs` removes `body_base64` and marks the response truncated for credential-backed requests. The HTTP transport classifies octet-stream as binary. The previous octet-stream fix therefore failed before ICS parsing. Host protection remains intact.

## Pass 1 — transport, authorization and bounds

- The existing authenticated attachment route now negotiates JSON with base64 bytes, exact account/thread/message/resource identity, original MIME, total length, chunk offset/length, protocol version and whole-file SHA-256. Profile ownership and provider-locator protection remain in the existing attachment resolver.
- The client rejects truncated, redirected, malformed, incorrectly scoped, noncanonical, size-mismatched or checksum-mismatched responses. Bytes are returned to the cache/parser/exporter only after complete verification. Changing provider content between chunks fails closed.
- Calendar files fit in one request. The 8 MiB attachment limit is retained: a 6 MiB first chunk and at most one remaining chunk keep JSON below the 9 MiB requested response limit and TAP's 10 MiB ceiling. Large files require two provider reads; there is no shared server cache or download fan-out.
- Removed the raw-file Content-Length from JSON responses. Kept private/no-store, nosniff, sandbox policy and the previous binary representation for older clients.
- Replaced byte-by-byte base64 string construction with bounded blocks to reduce peak allocation for large files. Rejected invalid offsets before provider reads. A large-file fixture receives an explicit 15-second test timeout because it decodes the maximum-size Gmail response twice in the local Worker runtime.

## Pass 2 — React, cache ownership and packaging

- Calendar and Save still use the existing shared attachment loader and miniapp-owned session/private-files cache. No new hooks, QueryClient, subscription, retained-reader component or host cache were introduced.
- Regression tests connect the new downloader to CalendarMessage and file export. REQUEST renders Yes/No/Maybe; REPLY renders the attendee's acceptance without RSVP controls. Strict Mode and cached reopens make one download. A failed checksum never writes a selected file.
- Upgraded the exact email SDK dependency, descriptor, lockfile and TAP test-policy pin from 0.19.0 to 0.20.0. The npm registry's latest published SDK is 0.20.0; host-displayed 0.21.0 was not published at verification time. Other apps retain their SDK pins.
- Synchronized package, descriptor, specialist and operations skill at release 1.0.5. Package verification now asserts the built descriptor's SDK against the dependency instead of printing a stale hardcoded version.
- No outstanding blocking findings after the two passes.

## Validation

- Email UI: 700 tests in 112 files passed.
- Coordinator: 282 tests in 21 files passed.
- Protocol: 19 tests in 2 files passed.
- App, coordinator and protocol typechecks; descriptor validation; repository TAP static checks and 11 app TAP typechecks passed.
- Preview and SDK production-package builds passed. Verified two TAP targets, six federation exposes, one package-runtime MCP ABI, one private React runtime and six archived source maps matching package bytes. Production-origin guard passed. Built SDK compatibility is 0.20.0.
- Coordinator production dry build and local startup profiling passed. This is local validation, not a Cloudflare production timing measurement.

## Release order and remaining live validation

Deploy the coordinator JSON route before installing 1.0.5; an older coordinator returns the incompatible raw representation. No database migration is required. After merge/release, validate the real Andrea and Nestor cards and Save in TAP again. The previously recorded 1.0.4 screenshots demonstrate the bug, not validation of this fix. Native installation and real-account RSVP delivery have not been performed for this branch.
