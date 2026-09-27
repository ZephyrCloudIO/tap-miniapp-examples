# Email 0.3.4: account navigation during history sync

## Production finding

Email 0.3.3 was published and installed after PR #102 merged. The coordinator deployment passed, its health and readiness checks passed, and the production monitor passed on recheck. The saved send that previously failed validation completed with a provider acknowledgement and left the command journal. The inbox opened without the malformed-cache warning.

Switching to an individual account then remained on “Loading mail” while older mail continued syncing. The local replica contained both accounts and more than 49,000 threads. The displayed inbox was waiting on `MailPersistenceQueue.flush()`, which drains every pending snapshot. Background history updates continually added snapshots, extending that wait before the window query could start. The same wait affected mailbox summary reads.

Sent also scanned unrelated threads and fetched each message record through the native bridge before checking its folder. An account with fewer than 100 sent threads scanned its entire cached history to finish the first page. A synthetic 240-thread cache required 484 database calls to find one sent thread.

## Change

`flushCurrent()` captures the latest requested write version. A read can continue after that version, or a newer coalesced snapshot, finishes. Later history updates continue through the existing write queue. Account, folder, page, and summary reads use this bounded wait; shutdown retains the full drain.

The queue also schedules snapshots requested between a read completing and the drain finalizer. Write failures reject waiting reads, and a later successful snapshot permits recovery.

Sent, Drafts, and Spam now filter candidates through the existing SQLite resource index before reading message records. Pending resource changes remain eligible for projection; unrelated candidates are skipped before message hydration. Cross-folder search behavior and account-scoped pagination are preserved.

## Validation

- The regression reproduced the stall before the fix: the navigation snapshot had finished writing, but the read still waited for a later history write.
- Four queue regressions cover navigation during continued writes, a pending snapshot behind an active write, write failure and retry, and a new request during drain completion.
- Five folder regressions cover sparse Sent/Drafts/Spam views, account-scoped Sent pagination, pending resource changes, and cross-folder searches. Sparse views now use fewer than 12 database calls in the 240-thread fixture.
- The actual Sent query against the saved production cache returned two 100-thread pages for one account and 86 threads for the other. All results belonged to the selected account and matched Sent, with no repeated threads. This diagnostic used a read-only SQLite handle and did not exercise native bridge latency.
- All 425 Email tests passed.
- Email and TAP TypeScript checks passed.
- The 0.3.4 package build passed SDK, runtime, and source-map verification.

Production UI verification of 0.3.4 remains pending its merge and publication. No production mail database was edited during diagnosis.

## Email 0.3.3 release evidence

- Merge: `b187a32e37e8322602366627562c85ce69b7896d`
- [Repository CI](https://github.com/ZephyrCloudIO/tap-miniapp-examples/actions/runs/36287129780): successful
- [Production package build](https://github.com/ZephyrCloudIO/tap-miniapp-examples/actions/runs/36287129770): successful; all 28 hosted artifacts matched their hashes and lengths
- [Coordinator deployment](https://github.com/ZephyrCloudIO/tap-miniapp-examples/actions/runs/36287537376): successful
- [Production monitor, attempt 2](https://github.com/ZephyrCloudIO/tap-miniapp-examples/actions/runs/36287323186/attempts/2): successful
- Marketplace release: `tap_rel_1_6LoG-4AKu8AOSEjeK0Czcw`
- Release root: `sha256:f76cb74db85148de8c51bcf358736ff4eb17caca2b30b43cf9fcb92ce861882d`
