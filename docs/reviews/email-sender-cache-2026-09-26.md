# Email 0.3.3: sender identity and cache recovery

## Diagnosis

Production Email 0.3.2 displayed `The local mail replica is malformed` at startup. A read-only inspection found a structurally sound SQLite database and one queued `send_draft` command. Only the command failed validation: its captured TAP sender ID contained the identity-provider separator `|`.

`isMailSenderContext` reused `isSafeMailIdentifier`, which is intended for mail record identifiers. As a result, a canonical TAP identity such as the synthetic `google-oauth2|123456789` made `isMailDraftPayload`, `isMailCommand`, and finally `isMailState` return false. The same validator caused coordinator command rejection and prevented the client from attaching the expected sender context to the host HTTP call.

The fix validates sender identities against the TAP host's expected-context contract: nonempty canonical strings, at most 1,024 UTF-8 bytes, no surrounding whitespace, and no control characters. Directory resolution, workspace membership, and exact identity equality remain required. Mail record identifiers keep their existing validation.

## Evidence

- SQLite `quick_check`: `ok`.
- The active saved replica contained two accounts and 20,497 thread records at inspection time.
- Before the fix, the saved UI, accounts, threads, preferences, and undo state validated; the queued command did not.
- After the fix, the actual startup state, including hydrated bodies, validated in a read-only diagnostic. The queued command was byte-for-byte equivalent after JSON serialization.
- Each account returned two inbox pages of 100 threads, with no overlap or cross-account rows.
- Diagnostic access used a read-only database handle. LRU timestamp updates were skipped. No mail content or credentials were included in diagnostic output or committed fixtures.
- Synthetic regression tests reproduced both the malformed-cache failure and missing host context before the fix and passed afterward.

## Validation

- 416 Email tests, 194 coordinator tests, and 10 protocol tests passed.
- Email, TAP test, coordinator, and protocol TypeScript checks passed.
- Email manifest validation and the 0.3.3 production package build passed, including SDK, runtime, and source-map verification.
- Coordinator production dry-run build, local startup check, and generated-type validation passed.

## Release considerations

The shared protocol change affects both the Email miniapp and its coordinator. The existing workflow deploys coordinator changes after successful main-branch CI, so merging this change can make previously rejected queued sends eligible for acceptance before the miniapp is updated.

Review the existing queued send before production deployment. The production journal was preserved during this work, and no outgoing mail was initiated. Production installation and UI checks for 0.3.3 remain pending.

This fixes the observed malformed-command cause in issue #96. Its broader handling of permanent command rejections and automatic retries remains separate work.
