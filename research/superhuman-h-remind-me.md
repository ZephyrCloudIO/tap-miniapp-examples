# Superhuman Mail `H` / Remind Me behavior

_Research date: 2026-08-16_

## Correction to the earlier TAP Email discussion

`H` should **not** be described as “archive the thread and schedule a workflow.” In Superhuman's product model, `H` is **Remind Me (Snooze)**, while `E` is **Mark Done (Archive)**. Those are separate triage actions in Superhuman's official shortcut vocabulary. A reminder moves the conversation into Superhuman's pending **Reminders** view; it does not move it into **Done**. [Remind Me](https://help.superhuman.com/hc/en-us/articles/46005666142733-Remind-Me), [official keyboard shortcuts](https://download.superhuman.com/Superhuman_Keyboard_Shortcuts.pdf), [Mark Done](https://help.superhuman.com/hc/en-us/articles/47439134613773-Mark-Done)

The most accurate TAP requirement is therefore: **`H` schedules a thread-level reminder and snoozes the thread from TAP Email's active inbox until its condition is satisfied. It is not a semantic alias for provider archive.**

## Exact current interaction

On an existing message in the inbox, `H` opens **Remind Me**. The user enters or selects a date and time. Once committed, the conversation leaves the active inbox and appears in the **Reminders folder**, which contains reminders that have not fired. `G`, then `H` opens that folder. At the due time, the conversation returns at the top of the inbox with a purple dot. Removing a reminder early uses **Remove Reminder & Move to Inbox**. A reminder set to **someday** never fires; it stays in the Reminders folder until removed. [Remind Me](https://help.superhuman.com/hc/en-us/articles/46005666142733-Remind-Me)

Superhuman auto-advances after triage actions such as Remind Me by default, although the user can instead choose to advance up, advance down, or return to the conversation list. [Customize Auto-Advance](https://new.superhuman.com/customize-auto-advance-105068)

### Condition: `if no reply` versus `regardless`

The default is **if no reply**. In the reminder picker, `Tab` exposes the alternative **regardless** mode. [Remind Me](https://help.superhuman.com/hc/en-us/articles/46005666142733-Remind-Me), [Remind Me: Regardless](https://new.superhuman.com/remind-me-regardless-30768)

- **If no reply:** if no recipient responds, the thread returns at the scheduled time. If someone replies before then, the new response lands in the inbox and the reminder is canceled.
- **Regardless:** the thread returns at the scheduled time even if someone replies first. An early reply still lands in the inbox, but it does not cancel the scheduled return.

The condition is part of the reminder itself; it is not determined merely by whether the currently selected message is incoming or outgoing. [Remind Me](https://help.superhuman.com/hc/en-us/articles/46005666142733-Remind-Me)

## Received, sent, and draft contexts

For a received thread already in the inbox, `H` applies the thread-level behavior above: choose a time, remove the thread from Superhuman's active inbox into pending Reminders, then return it when the condition and time say it should return. The documentation calls this “snooze” and does not call it archive. [Remind Me](https://help.superhuman.com/hc/en-us/articles/46005666142733-Remind-Me), [official keyboard shortcuts](https://download.superhuman.com/Superhuman_Keyboard_Shortcuts.pdf)

For outgoing follow-up, Superhuman's product page describes choosing a reminder time when sending an email so that, if no reply arrives, the sender is reminded to follow up. While the cursor is in a draft, plain `H` remains a typing character; the command is `Cmd+Shift+H` on macOS or `Ctrl+Shift+H` on Windows. Draft reminders work only in an **existing conversation**, not in a brand-new conversation. [Superhuman Mail product page](https://superhuman.com/mail), [Remind Me](https://help.superhuman.com/hc/en-us/articles/46005666142733-Remind-Me)

The current Help Center does **not** explicitly say that selecting an arbitrary conversation in the Sent folder and pressing plain `H` is supported. It documents plain `H` on an existing inbox message and the modified shortcut while writing a draft in an existing conversation. TAP should not invent a narrower distinction: the useful domain operation is “remind me about this existing thread,” with keyboard dispatch changing only when a text editor has focus.

## Pending and returned locations

Superhuman now distinguishes two similarly named surfaces: [Remind Me](https://help.superhuman.com/hc/en-us/articles/46005666142733-Remind-Me)

| Surface | Contents |
|---|---|
| **Reminders folder** | Pending reminders that have not fired |
| **Reminders Split Inbox** | Reminders that have fired and returned |

The returned-reminder Split Inbox is optional. When enabled, a returned reminder with no new message since it was set appears only in that split and any matching custom splits—not Important or Other. If the thread has new messages, it appears in the Reminders split and also in Important, Other, or other matching splits. With the Reminders split disabled, returned reminders appear in Important, Other, or matching custom splits as they previously did. [Remind Me](https://help.superhuman.com/hc/en-us/articles/46005666142733-Remind-Me)

## Gmail effects: what is known and what is not

Superhuman's current Gmail-delegation documentation explicitly lists **Reminders and Auto Reminders** among the Mail-only features that do not sync to or appear in Gmail. The same document separately lists **Mark Done** as the operation that syncs as Gmail archive. This supports a firm product distinction: the reminder object, condition, pending Reminders folder, and returned-reminder split are Superhuman-owned state, not Gmail labels or folders. [Executive Assistants Working in Gmail via Delegation](https://help.superhuman.com/hc/en-us/articles/47464280644621-Executive-Assistants-Working-in-Gmail-via-Delegation)

The official material does not publish the low-level Gmail API mutations performed when a manual `H` reminder is created. It therefore does not prove whether Superhuman incidentally changes Gmail's `INBOX` label while hiding the thread in its own inbox. The safe conclusions are:

- do not describe `H` as **Mark Done/archive**;
- do not create a Gmail label or calendar event to represent a TAP reminder;
- do not claim an incidental Gmail `INBOX`-label mutation unless direct provider-level behavior is separately verified;
- store the reminder condition and schedule as TAP-owned state while Gmail remains authoritative for provider-native message and label state.

The current Remind Me article says returned reminders can be found in Superhuman search with `from:reminder@superhuman.com in:inbox`. That does not override its explicit statement that reminders do not appear in Gmail, so it should be treated as Superhuman's reminder representation/search affordance rather than evidence of a Gmail-visible message. [Remind Me](https://help.superhuman.com/hc/en-us/articles/46005666142733-Remind-Me), [Gmail-delegation behavior](https://help.superhuman.com/hc/en-us/articles/47464280644621-Executive-Assistants-Working-in-Gmail-via-Delegation)

There is a separate **Superhuman Mail for Gmail / Email Assistant** product mode whose Auto Reminders operate directly through Gmail and surface as mail from `reminders@superhuman.com`. That is not documentation of the full Superhuman Mail client's manual `H` implementation and should not be conflated with it. [Superhuman Mail for Gmail](https://help.superhuman.com/hc/en-us/articles/46183279736461-Superhuman-Mail-for-Gmail)

## Manual reminders versus Auto Reminders

Manual reminders are deliberate thread-level actions set with `H` or the compose-context shortcut. **Auto Reminders** are a separate account setting evaluated against outgoing mail. The user can choose:

- messages Superhuman AI judges need a follow-up, based on the latest outgoing message and lack of reply;
- every message sent to an external recipient; or
- no messages.

Auto Reminders can count weekdays only. Both manual and automatic reminders can participate in Auto Drafts: when follow-up drafts are enabled, Superhuman AI adds a follow-up draft about one hour before either kind of reminder returns. Auto Drafts and reminders remain distinct features; a draft is not sent automatically. [Auto Reminders & Auto Drafts](https://help.superhuman.com/hc/en-us/articles/46005658551053-Auto-Reminders-Auto-Drafts)

## Offline behavior

Superhuman says inbox triage and replies continue to work offline and that offline work synchronizes when connectivity returns. It caches messages opened, searched, or received in the last 30 days, plus up to 1,250 messages per split and downloaded attachments. The offline documentation does not name Remind Me specifically and does not say what happens if an offline-created reminder becomes due before the action reaches Superhuman's servers. TAP can copy the optimistic offline interaction, but it must define and expose that edge case itself rather than attributing undocumented semantics to Superhuman. [Offline Access](https://help.superhuman.com/hc/en-us/articles/46005499629325-Offline-Access)

## Architecture implication for TAP Email

`H` should create a durable TAP reminder record for the immutable account and provider thread, immediately remove that thread from TAP's active queue, preserve it in a pending Reminders view, and optimistically advance. That is a TAP implementation of the documented user-visible contract—not evidence that Superhuman internally calls the feature a workflow.

The reminder record should include at least: account ID, thread ID, scheduled instant and timezone, mode (`if_no_reply` or `regardless`), reply baseline/version, creation provenance, sync state, and undo/edit history. Provider archive should remain a separate `E` command. If TAP later chooses to change Gmail's `INBOX` label as part of snoozing, that must be an explicit TAP product decision with clear cross-client consequences, not an assumed requirement copied from Superhuman.

## Inspection note

The installed desktop package was inspected only for non-sensitive metadata and static bundle structure. It is Superhuman `1041.0.29` and its Electron package is principally a desktop shell; no static reminder implementation was present that added reliable behavioral evidence. No mailbox, account, token, credential, cache, or user email data was accessed.
