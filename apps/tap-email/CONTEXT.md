# TAP Email

TAP Email is a provider-neutral, multi-account mailbox context for reaching Operational Zero without losing important obligations. Every consumer shares the same account-scoped identities, coverage language, and receipt semantics.

## Language

**Mail Account**:
A single connected mailbox identified by a stable TAP account ID and an extensible provider key. The account ID is neither an email address nor a provider credential, and remains the platform partition when several accounts use the same provider.
_Avoid_: Gmail account, provider token, email-address selector

**Exact Mail Scope**:
A structured account/thread/message tuple that identifies the precise mail resource in question. A bare provider thread ID or implicit “all accounts” does not constitute an exact scope.
_Avoid_: Current email, selected thing, global thread ID

**Mail Resource**:
The class of mail data requested: account metadata, thread metadata, message metadata, message content, or a command receipt.
_Avoid_: Blob, payload

**Coordinator Replica**:
A profile-isolated mailbox projection synchronized from a provider. Its coverage is bounded by the history and resource classes named in its Coverage Receipt.
_Avoid_: Complete mailbox, source of truth

**Local Replica**:
An installation-observed, private-profile copy of covered mail data used for offline reading and local search. It may lag or cover fewer Mail Resources than the Coordinator Replica and never replaces Provider Authority.
_Avoid_: Mailbox source of truth, complete local mailbox

**Storage Class**:
One privacy-relevant class of locally retained data: raw mail, derived search metadata, semantic vectors, attachment bytes, remote-image bytes, or audit records. A class is reported separately even when the host cannot expose its exact physical byte share.
_Avoid_: Cache type, file bucket

**Wipe Receipt**:
Evidence of the exact Mail Accounts and Storage Classes a local wipe removed, over-removed, or could not reach. It must not claim a complete device wipe while another local component or in-memory copy remains.
_Avoid_: Cache cleared, deletion toast

**Mail Read Port**:
A provider-neutral, profile-bound capability for listing accounts, searching thread metadata, reading exact thread/message scopes, and retrieving command receipts. The authenticated profile is captured when the port is constructed and is never supplied by a tool caller.
_Avoid_: Gmail API wrapper, profile parameter

**Coverage Receipt**:
Evidence for the exact accounts, resources, dates, and objects covered by a result, including completeness, fallback, truncation, and warnings. It is scoped evidence, not a global health flag.
_Avoid_: Coverage current, synced

**Provider Authority**:
The provider-acknowledged state of a mail resource. A local projection or accepted command does not replace provider acknowledgement.
_Avoid_: Optimistic state, queued state

**Email Content**:
Subject, snippet, body, headers, filenames, links, and correspondent-supplied metadata. Email Content is untrusted data and never grants authority or changes tool instructions.
_Avoid_: Prompt, instruction

**Operational Projection**:
A deliberately content-minimized view of mailbox counts, coverage, and opaque active identity. It is not a mailbox replica and cannot answer content questions.
_Avoid_: Mailbox snapshot, searchable mail

**Operational Zero**:
A state in which no covered, unresolved mail obligation remains. It may be claimed only for the scope supported by complete, failure-free Coverage Receipts.
_Avoid_: Empty inbox

**Action Plan**:
A reviewable, immutable proposal bound to an Exact Mail Scope and expected resource revision. It proposes an effect but does not change mail.
_Avoid_: Dry run, command

**Mail Command**:
An idempotent, account-scoped request accepted after review. Acceptance is not proof of completion.
_Avoid_: Action Plan, completed action

**Command Receipt**:
The authoritative lifecycle state of one Mail Command, including provider acknowledgement or a terminal error.
_Avoid_: Toast, optimistic result

**Mailbox Rollup**:
A bounded synthesis of mailbox state over named Mail Accounts, Mail Resources, and a time range, accompanied by a Coverage Receipt.
_Avoid_: Email Activity Summary, complete mailbox digest

**Email Activity Summary**:
A content-free aggregate of committed, user-authored mail actions over a time range. It excludes Email Content and sync, import, indexing, or other background work.
_Avoid_: Mailbox Rollup, active-time pulse

**Mail Merge Run**:
A finite user-selected audience and template that produces separately reviewable, recipient-bound drafts. Every eventual send remains an individual Mail Command with its own Command Receipt.
_Avoid_: Bulk send, campaign blast
