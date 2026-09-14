# ADR 0003: Review-first Email handoffs

Status: accepted and implemented for the first vertical slice

## Decision

The `B` shortcut and **Discuss in TAP** reader action open a review surface. They do not immediately create a channel or copy email text.

The user reviews four independent decisions:

1. **Context:** a locally generated redacted summary, or explicitly selected messages.
2. **Reference:** a live package-owned Email locator, or a frozen snapshot.
3. **Destination:** the current editable TAP Chat composer, a new private conversation, or an existing active channel returned by the host.
4. **Audience:** the UI states the audience the installed SDK can guarantee. Chat inherits the current Chat participants; a new private conversation starts private to the user; an existing channel inherits its membership. SDK 0.15 does not expose channel membership mutation, so Email never implies that it added or removed participants.

The privacy-safe defaults are a redacted summary and live link. The existing new-private-conversation route remains the default destination, but it runs only after the user checks the disclosure confirmation. Copying message text requires choosing both **Selected messages** and **Snapshot**.

## Idempotency and receipts

One open review owns a stable `tap-email:handoff:<uuid>` key. Direct channel posts pass that key as `clientMessageId`. Retrying a partial new-channel handoff reuses both the client key and the channel ID. Editing a previously attempted plan rotates the key and requires another review.

Before any host write, Email persists a content-free `planned` receipt at `tap-email / conversation-handoff-receipts/v1`. Later receipt states are `channel-created`, `staged`, `sent`, `partial`, or `failed`. The bounded receipt ledger contains opaque account/thread/message IDs, disclosure choices, destination/result IDs, time, and a safe warning. It never contains subjects, correspondents, recipients, summaries, or message bodies.

## Host boundaries

- Current TAP Chat uses `sendTextToChat`; the user still reviews and sends the resulting host-owned draft. Live links use the package deep-link staging contract and roll back when supported if text staging fails.
- Existing destinations require the declared read-only `channels.list` action.
- Direct channel live-link handoffs persist the opaque package locator in structured `messageContent`; no message body is copied. Host rendering decides how authorized channel viewers open that locator.
- Creating a new private channel and posting to a channel retain separate authorization checks. Both checks complete before a new channel is created.
