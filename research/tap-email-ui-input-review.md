# TAP Email UI input review

Reviewed 2026-09-26 against commit `7fd0e9e`, using the app's pinned `@theaiplatform/miniapp-sdk@0.15.0`. Scope: Email only.

The initial checkout predates Email; this clean review worktree was moved to the current local main revision. The preview and existing tests ran from the primary checkout at the same revision, which already has dependencies installed. Application source was not changed.

## Assessment

SDK adoption is incomplete, and importing SDK controls has not produced a consistent UI. There are **37 form-control declarations: 23 SDK controls and 14 raw HTML controls**. Two of the SDK controls are `NativeSelect`, which deliberately opens an OS-native menu. There are also **42 raw button declarations and 20 SDK Button declarations**. Counts describe JSX source sites, not rendered instances; mapped account, message, and option controls can appear multiple times.

The screenshot's composer uses SDK `Input` and `Textarea`, but its From field uses `NativeSelect`. Its OS popup is therefore expected for that component. The app then overrides input dimensions, font, borders, backgrounds, and outlines with CSS while retaining SDK padding, radii, and shadows. This creates the rounded boxes inside otherwise flattened composer rows.

SDK 0.15.0 already exports `Select`/`SelectTrigger`/`SelectContent`/`SelectItem`, `Input`, `Textarea`, `InputGroup`, `RadioGroup`/`RadioGroupItem`/`RadioCard`, `Checkbox`, `ToggleGroup`, `Button`, and field/dialog layout components. `Input`, `SelectTrigger`, and `NativeSelect` support compact density. The installed SDK's own type declarations describe NativeSelect as the option for intentionally native pickers.

## Findings

### 1. P1 — “Save and close draft” drops writing when To is empty

[compose-dialog.tsx:112](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/compose-dialog.tsx:112)

Both close-time saving and the 800 ms autosave require a nonempty To field. Writing a subject/body first, then using the close button, Escape, or the dialog dismissal path skips `onAutosave` and calls `onClose`. The parent clears the compose identity and unmounts the component. The same risk applies to prefilled compose content before recipients are entered.

Save incomplete drafts independently of send validation. If provider drafts require recipients, preserve the incomplete content locally. The close action must not claim to save while discarding it. Source-confirmed; the existing preservation test covers only a draft with a recipient.

### 2. P2 — Input selection is inconsistent across the app

[compose-dialog.tsx:172](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/compose-dialog.tsx:172); [reply-composer.tsx:136](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/reply-composer.tsx:136); [workflow-center.tsx:358](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/workflow-center.tsx:358); [conversation-handoff-dialog.tsx:246](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/conversation-handoff-dialog.tsx:246); [app.tsx:418](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/app.tsx:418)

Reply's To/Cc/Bcc/body, mailbox search, four select controls, four handoff radios, and the conversation-name field bypass SDK controls. Compose From and handoff Destination use SDK NativeSelect, retaining native popup behavior. Thus the same action category has several different appearances and interaction implementations.

Use SDK Select for the desktop account/destination/resource pickers, Input/Textarea for text entry, and RadioGroup/RadioCard for handoff choices. Use a shared account-select wrapper and shared recipient fields across compose/reply. Preserve focus refs, selected values, disabled states, labels, and keyboard shortcuts during migration. NativeSelect is an SDK component, but does not provide the themed popup requested here.

### 3. P2 — Composer CSS partially replaces the SDK's input contract

[styles.css:573](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/styles.css:573); [workflow-center.css:78](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/workflow-center.css:78)

Composer styles force 45 px height, 12 px text, transparent background, and zero borders/outlines while keeping SDK shadows, rounded corners, and padding. In the browser, compose text fields computed to 45 px high, 8 px radius, 10 px vertical padding, and the SDK resting/focus shadows. From retained a different 6 px radius. Workflow forms independently impose 34 px minimum height and 10 px text.

Choose the intended SDK density and let it own control styling. Keep app CSS concerned with field layout and available space. If a flush recipient row is required, implement one consistent SDK-based field wrapper rather than partially resetting every control.

### 4. P2 — Reply recipient fields lose all keyboard focus indication

[styles.css:505](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/styles.css:505)

`.reply-addresses input` removes the outline after the global focus rule and supplies no border, shadow, or parent focus indicator. Browser verification: after Shift+Tab to Reply recipients, `:focus-visible` was true, but computed outline was none/0 px, border was 0 px, and both input and label shadows were none. To/Cc/Bcc share this rule.

Use SDK Input focus styling or an explicit visible `:focus-within` treatment on the field wrapper. Preserve the existing body indicator, which does have a replacement.

### 5. P2 — Clearing the custom send time schedules the previous value

[send-later-dialog.tsx:100](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/send-later-dialog.tsx:100)

The change handler clears `customValue` but updates `scheduledFor` only for a valid Date. Button validity and submission both use the old `scheduledFor`. Clearing the field leaves Schedule send enabled and retains the previous preset/custom timestamp.

Confirmed in the local preview: the field was empty while Schedule send remained enabled. Derive submission validity from the displayed value, clear the parsed value for incomplete input, and revalidate immediately before confirmation. Display an associated field error.

### 6. P2 — Send-later choices have no component styling or layout

[send-later-dialog.tsx:76](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/send-later-dialog.tsx:76)

The preset choices are raw buttons containing adjacent `strong` and `time` elements. No stylesheet defines `send-later-dialog`, `send-later-choices`, `send-later-custom`, or `send-later-cancel-reply`. The rendered presets run together as “TonightSun 6:00 PMTomorrow morningSun 8:00 AM,” and selection has no authored visual treatment.

Use SDK single-choice controls with separate label/time layout and a visible selected state, plus the SDK dialog header/footer layout. Native datetime-local itself is a supported Input use; the missing preset layout is a separate problem.

### 7. P2 — Recipient validation changes depending on the send path

[compose-dialog.tsx:86](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/compose-dialog.tsx:86); [compose-dialog.tsx:104](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/compose-dialog.tsx:104); [reply-composer.tsx:233](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/reply-composer.tsx:233)

Compose checks only nonempty From/To/body. Its email inputs are outside a form, and Send is a button calling `requestSend`; browser email validation never runs. The preview accepted an invalid address with `validity.typeMismatch === true`, no owning form, and enabled Send/Send later. The queue path also has no address validation.

Reply's ordinary submit receives browser validation, but its Send later button bypasses that form submission. This produces different behavior for the same recipients depending on mode and delivery timing. Apply one address-list validator to To/Cc/Bcc before sending or scheduling, preserve the draft on errors, and associate each error with its field. Define supported pasted address formats explicitly.

### 8. P2 — Command palette Enter can execute a different item from keyboard focus

[app.tsx:554](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/app.tsx:554); [app.tsx:574](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/app.tsx:574)

Every option remains tabbable, while the dialog-level Enter handler always executes `matches[activeIndex]`. Tab does not update activeIndex. Reproduced: open the palette, Tab three times from the query to Remind me, then press Enter. The app executes Next thread and selects the next conversation instead of opening the reminder.

Keep focus on the combobox and remove options from the tab order, or synchronize activeIndex with actual focus and scope the Enter handler accordingly. Also guard IME composition. The query input at line 571 has no explicit accessible label; the browser accessibility tree reported an unnamed combobox. Give it a stable label.

### 9. P3 — Sender labels duplicate the address in connected mailboxes

[compose-dialog.tsx:185](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/compose-dialog.tsx:185); [workflow-center.tsx:449](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/workflow-center.tsx:449)

Both selectors unconditionally render displayName followed by address. The coordinator currently prefers email_address for displayName at [mailbox.ts:1580](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email-coordinator/src/mailbox.ts:1580), so ordinary connected accounts repeat the same address, matching the screenshot.

Use a shared label formatter: show address once when it matches the name; otherwise show a meaningful name with the address as secondary text. Handle absent names and long addresses.

### 10. P3 — Account switching exposes selection only through CSS

[account-switcher.tsx:22](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/account-switcher.tsx:22)

The selected account gets only `is-active`; neither All accounts nor the account buttons expose `aria-pressed`, `aria-current`, or single-choice selection semantics. The preview accessibility tree showed ordinary buttons without a selected state.

Use SDK ToggleGroup with single selection, or explicit pressed state and an appropriately labelled group.

## Complete form-control inventory

| Surface and locations | Controls / source sites | Current implementation | Disposition |
|---|---|---|---|
| Compose: [compose-dialog.tsx:172](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/compose-dialog.tsx:172) | From (1) | SDK NativeSelect | SDK Select; shared account label |
| Compose: [compose-dialog.tsx:193](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/compose-dialog.tsx:193), [compose-dialog.tsx:197](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/compose-dialog.tsx:197), [compose-dialog.tsx:201](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/compose-dialog.tsx:201) | To, Cc, Bcc (3) | SDK Input | Keep SDK; share validation and recipient presentation with reply |
| Compose: [compose-dialog.tsx:205](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/compose-dialog.tsx:205), [compose-dialog.tsx:207](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/compose-dialog.tsx:207) | Subject, body (2) | SDK Input / Textarea | Keep SDK; remove partial style resets; save incomplete drafts |
| Reply: [reply-composer.tsx:136](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/reply-composer.tsx:136), [reply-composer.tsx:157](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/reply-composer.tsx:157), [reply-composer.tsx:161](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/reply-composer.tsx:161), [reply-composer.tsx:181](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/reply-composer.tsx:181) | To, Cc, Bcc, body (4) | Raw input / textarea | SDK Input / Textarea; restore focus; add recipient name/spellCheck metadata |
| Main app: [app.tsx:2782](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/app.tsx:2782) | Mail search (1) | Raw search input | SDK InputGroup/Input; retain search label and semantic-search action |
| Main app: [app.tsx:418](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/app.tsx:418) | Compact mailbox picker (1) | Raw select | SDK Select; preserve mailbox/TAP view grouping |
| Main app: [app.tsx:571](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/app.tsx:571) | Command query (1) | SDK Input plus custom listbox | Add label; fix focus/activation contract |
| Settings: [app.tsx:646](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/app.tsx:646), [app.tsx:660](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/app.tsx:660), [app.tsx:674](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/app.tsx:674) | Remote images, tracking pixels, per-account notifications (3) | SDK Checkbox | Keep; existing labels and disabled dependency are present |
| Reminder: [reminder-dialog.tsx:113](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/reminder-dialog.tsx:113) | Natural-language date/time (1) | SDK Input plus custom suggestions | Keep; labels, arrow navigation, IME guard and live count are present; align custom styles |
| Send later: [send-later-dialog.tsx:100](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/send-later-dialog.tsx:100), [send-later-dialog.tsx:117](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/send-later-dialog.tsx:117) | Custom date/time, cancel-if-reply (2) | SDK Input / Checkbox | Fix date state; add consistent surrounding layout and input name |
| Discuss in TAP: [conversation-handoff-dialog.tsx:246](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/conversation-handoff-dialog.tsx:246), [conversation-handoff-dialog.tsx:255](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/conversation-handoff-dialog.tsx:255), [conversation-handoff-dialog.tsx:294](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/conversation-handoff-dialog.tsx:294), [conversation-handoff-dialog.tsx:303](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/conversation-handoff-dialog.tsx:303) | Context and reference choices (4) | Raw radio inputs | SDK RadioGroup / RadioCard; preserve group names and locked state |
| Discuss in TAP: [conversation-handoff-dialog.tsx:268](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/conversation-handoff-dialog.tsx:268), [conversation-handoff-dialog.tsx:281](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/conversation-handoff-dialog.tsx:281), [conversation-handoff-dialog.tsx:365](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/conversation-handoff-dialog.tsx:365) | Redacted summary, selected messages, disclosure review (3) | SDK Textarea / Checkbox | Keep; preserve disclosure reset and disabled-state behavior |
| Discuss in TAP: [conversation-handoff-dialog.tsx:315](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/conversation-handoff-dialog.tsx:315), [conversation-handoff-dialog.tsx:339](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/conversation-handoff-dialog.tsx:339) | Destination, conversation name (2) | SDK NativeSelect / raw input | SDK Select / Input |
| Workflows: [workflow-center.tsx:358](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/workflow-center.tsx:358), [workflow-center.tsx:367](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/workflow-center.tsx:367), [workflow-center.tsx:441](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/workflow-center.tsx:441) | Accounts, mailbox resource, merge sender (3) | Raw select | SDK Select; reuse account picker |
| Workflows: [workflow-center.tsx:387](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/workflow-center.tsx:387), [workflow-center.tsx:391](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/workflow-center.tsx:391) | From / Through date-time (2) | SDK Input | Keep; normalize sizing, names and error association |
| Workflows: [workflow-center.tsx:458](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/workflow-center.tsx:458), [workflow-center.tsx:471](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/workflow-center.tsx:471), [workflow-center.tsx:483](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/workflow-center.tsx:483), [workflow-center.tsx:512](/Users/zackarychapple/.codex/worktrees/d388/tap-miniapp-example_email/apps/tap-email/src/workflow-center.tsx:512) | Recipients, subject template, body template, review acknowledgement (4) | SDK Textarea / Input / Checkbox | Keep; remove duplicate visual styles and add names/autocomplete metadata |

Wrapping labels are already present for most controls. Replacing those with SDK Field/FieldLabel is a consistency improvement, not a claim that every current label is inaccessible.

## Buttons, pickers and adjacent interactions

These sit outside the 37 field declarations. Raw buttons are semantic HTML and are not automatically accessibility bugs; the issue is duplicated component styling/behavior and the concrete exceptions above.

| File | Raw button sites | SDK Button sites | Review note |
|---|---:|---:|---|
| account-switcher.tsx | 2 | 0 | Single-choice selection should use SDK ToggleGroup or expose pressed state |
| app.tsx | 11 | 3 | Navigation, thread selection, search action and app actions; retain listbox/current-page semantics while standardizing actionable controls |
| compose-dialog.tsx | 1 | 4 | Attachment removal is raw; primary actions already use SDK |
| conversation-handoff-dialog.tsx | 0 | 3 | Main action/close/cancel controls use SDK |
| google-connect-button.tsx | 1 | 0 | Use SDK Button without changing connection behavior |
| message-attachments.tsx | 2 | 2 | Preview/save actions mix implementations |
| outbox-list.tsx | 2 | 0 | Retry and reconciliation actions use raw buttons |
| reader-actions.tsx | 2 | 0 | Custom icon button and Chloe menu; preserve tooltips, labels and existing arrow/Home/End/Escape handling |
| reminder-dialog.tsx | 0 | 1 | Mapped SDK suggestion button; keyboard behavior already tested |
| reply-composer.tsx | 7 | 0 | Cc/Bcc, placement, close, removal, attach, schedule and send all raw |
| rich-message.tsx | 1 | 0 | Quoted-content action is raw |
| scheduled-send-list.tsx | 1 | 0 | Cancel-send action is raw |
| send-later-dialog.tsx | 1 | 3 | Preset choice needs SDK single-choice treatment and actual styling |
| storage-privacy-panel.tsx | 3 | 0 | Refresh/clear actions are raw; preserve existing confirmation behavior |
| sync-button.tsx | 1 | 0 | Raw action; retain busy/status presentation |
| thread-attention-panel.tsx | 5 | 0 | Urgency and response choices already expose aria-pressed; SDK ToggleGroup can standardize them |
| thread-messages.tsx | 2 | 0 | Message expansion and quoted-content actions; preserve aria-expanded |
| workflow-center.tsx | 0 | 4 | Action buttons already use SDK |

No app-authored file, range, number, password, or contenteditable input was found in Email's React source. Attachment selection goes through the SDK picker. Email-message HTML is external message content and was excluded from application-input counts.

## Verification and limits

- Parsed all non-test Email TSX source with the TypeScript AST, avoiding counts from types, tests, and text.
- Checked the actual installed SDK 0.15.0 implementation/type exports; no SDK upgrade is needed for the proposed controls.
- Used the isolated local fixture preview to inspect compose styles, invalid recipients, cleared send time, reply keyboard focus, and command-palette Tab/Enter behavior. No connected mailbox was used.
- Ran the seven existing targeted suites for compose, reply, send later, reminders, handoff, workflows, and account switching: **18 tests passed**. They do not cover the reproduced failures.
- Findings about draft-save gating and production duplicate labels follow the source paths. The authenticated host's dark-theme rendering and native macOS picker were not independently exercised; the supplied screenshot provides that visual evidence.
- Accessibility criteria were cross-checked against the [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). The findings above rely on local source and observed behavior.

## Recommended implementation order

1. Preserve incomplete drafts; unify send/schedule recipient validation; fix custom scheduling date state.
2. Migrate the 14 raw field sites and two native desktop pickers to shared SDK-based controls, using one account-label formatter.
3. Remove conflicting visual resets, restore reply focus, and lay out send-later choices.
4. Fix palette focus/activation and account selection semantics; standardize remaining buttons.
5. Add regression coverage for those behaviors and visual checks in the mounted host at desktop and compact widths.

