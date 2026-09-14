import {
  sdk,
  type MiniAppChannel,
  type MiniAppPlatformApi,
  type MiniAppStorageApi,
} from '@theaiplatform/miniapp-sdk/sdk';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from '@theaiplatform/miniapp-sdk/ui';
import { MessageSquareShare } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import type { EmailThread } from './domain';
import {
  ConversationHandoffPartialError,
  ConversationHandoffReceiptError,
  conversationHandoffErrorMessage,
  conversationHandoffValidationError,
  defaultRedactedConversationSummary,
  handoffEmailToConversation,
  listConversationHandoffChannels,
  type ConversationHandoffContentMode,
  type ConversationHandoffPhase,
  type ConversationHandoffPlan,
  type ConversationHandoffReferenceMode,
  type ConversationHandoffResult,
} from './conversation-handoff';
import { persistConversationHandoffReceipt } from './conversation-handoff-receipts';

type HandoffPlatform = Pick<
  MiniAppPlatformApi,
  'authorization' | 'channels' | 'chat'
>;

export interface ConversationHandoffDialogProps {
  readonly idFactory: () => string;
  readonly onClose: () => void;
  readonly onCompleted: (result: ConversationHandoffResult) => void;
  readonly onPhase: (phase: ConversationHandoffPhase) => void;
  readonly platform?: HandoffPlatform;
  readonly storage?: Pick<MiniAppStorageApi, 'get' | 'set'>;
  readonly thread: EmailThread;
  readonly workspaceId: string;
}

function channelLabel(channel: MiniAppChannel): string {
  return channel.title || channel.description || channel.roomId;
}

function destinationValue(plan: ConversationHandoffPlan['destination']): string {
  if (plan.kind === 'existing-channel') return `channel:${plan.channelId}`;
  return plan.kind;
}

function messageChoiceLabel(thread: EmailThread, messageId: string): string {
  const message = thread.messages.find(item => item.messageId === messageId);
  if (!message) return messageId;
  const sender = message.from.name || message.from.address || 'Unknown sender';
  const preview = message.bodyText.replace(/\s+/gu, ' ').trim().slice(0, 90) || 'No text body';
  return `${sender} · ${preview}`;
}

export function ConversationHandoffDialog({
  idFactory,
  onClose,
  onCompleted,
  onPhase,
  platform = sdk,
  storage = sdk.storage,
  thread,
  workspaceId,
}: ConversationHandoffDialogProps) {
  const latestMessageId = thread.messages.at(-1)?.messageId;
  const [idempotencyKey, setIdempotencyKey] = useState(
    () => `tap-email:handoff:${idFactory()}`,
  );
  const [contentMode, setContentMode] =
    useState<ConversationHandoffContentMode>('redacted-summary');
  const [referenceMode, setReferenceMode] =
    useState<ConversationHandoffReferenceMode>('live-link');
  const [selectedMessageIds, setSelectedMessageIds] = useState<readonly string[]>(
    () => latestMessageId ? [latestMessageId] : [],
  );
  const [redactedSummary, setRedactedSummary] = useState(
    () => defaultRedactedConversationSummary(thread),
  );
  const [destination, setDestination] =
    useState<ConversationHandoffPlan['destination']>({
      kind: 'new-private',
      name: 'Email discussion',
    });
  const [channels, setChannels] = useState<readonly MiniAppChannel[]>([]);
  const [channelsStatus, setChannelsStatus] =
    useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [reviewed, setReviewed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resumeChannelId, setResumeChannelId] = useState<string | null>(null);
  const [retryBlocked, setRetryBlocked] = useState(false);

  useEffect(() => {
    let active = true;
    void listConversationHandoffChannels(platform, workspaceId).then(
      result => {
        if (!active) return;
        setChannels(result);
        setChannelsStatus('ready');
      },
      () => {
        if (!active) return;
        setChannelsStatus('unavailable');
      },
    );
    return () => { active = false; };
  }, [platform, workspaceId]);

  const beginEdit = () => {
    setReviewed(false);
    setError('');
    if (attempted) {
      setAttempted(false);
      setResumeChannelId(null);
      setRetryBlocked(false);
      setIdempotencyKey(`tap-email:handoff:${idFactory()}`);
    }
  };

  const plan = useMemo<ConversationHandoffPlan>(() => ({
    idempotencyKey,
    workspaceId,
    source: thread,
    contentMode,
    referenceMode,
    selectedMessageIds,
    redactedSummary,
    destination,
  }), [
    contentMode,
    destination,
    idempotencyKey,
    redactedSummary,
    referenceMode,
    selectedMessageIds,
    thread,
    workspaceId,
  ]);
  const validationError = conversationHandoffValidationError(plan);
  const destinationParticipants = destination.kind === 'active-chat'
    ? 'Current Chat participants. TAP Email stages an editable draft; Chat owns the final send.'
    : destination.kind === 'new-private'
      ? 'Private to you initially. Invite people from TAP after the conversation is created.'
      : 'Existing channel participants. TAP Email cannot add or remove members.';
  const submitLabel = resumeChannelId
    ? 'Retry delivery'
    : destination.kind === 'active-chat'
      ? 'Stage in Chat'
      : destination.kind === 'new-private'
        ? 'Create & share'
        : 'Share to channel';

  const chooseDestination = (value: string) => {
    beginEdit();
    if (value === 'active-chat') {
      setDestination({ kind: 'active-chat' });
      return;
    }
    if (value === 'new-private') {
      setDestination({ kind: 'new-private', name: 'Email discussion' });
      return;
    }
    const channelId = value.startsWith('channel:') ? value.slice(8) : '';
    const channel = channels.find(item => item.roomId === channelId);
    if (channel) {
      setDestination({
        kind: 'existing-channel',
        channelId,
        label: channelLabel(channel),
      });
    }
  };

  const toggleMessage = (messageId: string, selected: boolean) => {
    beginEdit();
    setSelectedMessageIds(current => selected
      ? [...new Set([...current, messageId])]
      : current.filter(item => item !== messageId));
  };

  const submit = async () => {
    if (busy || !reviewed || validationError) return;
    setBusy(true);
    setAttempted(true);
    setError('');
    try {
      const result = await handoffEmailToConversation({
        platform,
        plan,
        resumeChannelId,
        onPhase,
        recordReceipt: receipt => persistConversationHandoffReceipt(receipt, storage),
      });
      onCompleted(result);
      onClose();
    } catch (cause) {
      if (cause instanceof ConversationHandoffPartialError) {
        setResumeChannelId(cause.channelId);
      }
      if (cause instanceof ConversationHandoffReceiptError) {
        if (cause.result.channelId) setResumeChannelId(cause.result.channelId);
        else setRetryBlocked(true);
      }
      setError(conversationHandoffErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const choicesLocked = busy || Boolean(resumeChannelId) || retryBlocked;

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
      <DialogContent className="handoff-dialog" hideCloseButton>
        <header>
          <div className="handoff-title-glyph"><MessageSquareShare aria-hidden="true" /></div>
          <div>
            <DialogTitle>Discuss in TAP</DialogTitle>
            <DialogDescription>
              Review exactly what leaves Email and who can see it.
            </DialogDescription>
          </div>
          <Button variant="ghost" size="icon-sm" type="button" onClick={onClose} disabled={busy} aria-label="Close Discuss in TAP">×</Button>
        </header>

        <div className="handoff-dialog-body">
          <fieldset disabled={choicesLocked}>
            <legend>Context</legend>
            <label className="handoff-choice">
              <input
                checked={contentMode === 'redacted-summary'}
                name="handoff-content"
                onChange={() => { beginEdit(); setContentMode('redacted-summary'); }}
                type="radio"
              />
              <span><strong>Redacted summary</strong><small>No subject, correspondent, recipient, or message text by default.</small></span>
            </label>
            <label className="handoff-choice">
              <input
                checked={contentMode === 'selected-messages'}
                name="handoff-content"
                onChange={() => { beginEdit(); setContentMode('selected-messages'); }}
                type="radio"
              />
              <span><strong>Selected messages</strong><small>Copies the messages you explicitly check only when Snapshot is selected.</small></span>
            </label>
          </fieldset>

          {contentMode === 'redacted-summary' ? (
            <label className="handoff-summary">
              <span>Review redacted summary</span>
              <Textarea
                disabled={choicesLocked}
                maxLength={4_000}
                name="handoff-redacted-summary"
                onChange={event => { beginEdit(); setRedactedSummary(event.target.value); }}
                value={redactedSummary}
              />
            </label>
          ) : (
            <fieldset className="handoff-messages" disabled={choicesLocked}>
              <legend>Messages to include</legend>
              {thread.messages.map(message => (
                <label key={message.messageId}>
                  <Checkbox
                    checked={selectedMessageIds.includes(message.messageId)}
                    onCheckedChange={checked => toggleMessage(message.messageId, checked === true)}
                  />
                  <span>{messageChoiceLabel(thread, message.messageId)}</span>
                </label>
              ))}
            </fieldset>
          )}

          <fieldset disabled={choicesLocked}>
            <legend>Reference</legend>
            <label className="handoff-choice">
              <input
                checked={referenceMode === 'live-link'}
                name="handoff-reference"
                onChange={() => { beginEdit(); setReferenceMode('live-link'); }}
                type="radio"
              />
              <span><strong>Live link</strong><small>Keeps selected message text in Email; authorized viewers open current state.</small></span>
            </label>
            <label className="handoff-choice">
              <input
                checked={referenceMode === 'snapshot'}
                name="handoff-reference"
                onChange={() => { beginEdit(); setReferenceMode('snapshot'); }}
                type="radio"
              />
              <span><strong>Snapshot</strong><small>Copies the reviewed context into the destination.</small></span>
            </label>
          </fieldset>

          <label className="handoff-destination">
            <span>Destination</span>
            <NativeSelect
              disabled={choicesLocked}
              name="handoff-destination"
              onChange={event => chooseDestination(event.target.value)}
              value={destinationValue(destination)}
            >
              <NativeSelectOption value="new-private">New private conversation</NativeSelectOption>
              <NativeSelectOption value="active-chat">Current TAP Chat (editable)</NativeSelectOption>
              {channels.map(channel => (
                <NativeSelectOption key={channel.roomId} value={`channel:${channel.roomId}`}>
                  {channelLabel(channel)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <small>{channelsStatus === 'loading'
              ? 'Loading existing TAP channels…'
              : channelsStatus === 'unavailable'
                ? 'Existing channels are unavailable; Chat and a new private conversation still work.'
                : destinationParticipants}</small>
          </label>

          {destination.kind === 'new-private' ? (
            <label className="handoff-destination">
              <span>Conversation name</span>
              <input
                disabled={choicesLocked}
                maxLength={256}
                name="handoff-channel-name"
                onChange={event => {
                  beginEdit();
                  setDestination({ kind: 'new-private', name: event.target.value });
                }}
                value={destination.name}
              />
              <small>{destinationParticipants}</small>
            </label>
          ) : null}

          <div className="handoff-disclosure" role="note">
            <strong>Disclosure preview</strong>
            <span>{contentMode === 'redacted-summary'
              ? 'The reviewed redacted summary'
              : `${selectedMessageIds.length} selected message${selectedMessageIds.length === 1 ? '' : 's'}`}</span>
            <span>{referenceMode === 'live-link'
              ? 'Live Email locator; selected message text is not copied'
              : 'Frozen snapshot copied to the destination'}</span>
            <span>{destinationParticipants}</span>
          </div>

          <label className="handoff-review-check">
            <Checkbox
              checked={reviewed}
              disabled={busy}
              onCheckedChange={checked => setReviewed(checked === true)}
            />
            <span>I reviewed this disclosure and destination.</span>
          </label>

          {validationError || error ? (
            <p className="handoff-error" role="alert">{error || validationError}</p>
          ) : null}
        </div>

        <footer>
          <span>{retryBlocked
            ? 'The Chat draft may already be staged. Close this dialog and inspect Chat.'
            : resumeChannelId
              ? 'Retry uses the same conversation and client key.'
              : 'Changing any choice requires another review.'}</span>
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            className="primary-button"
            disabled={busy || retryBlocked || !reviewed || Boolean(validationError)}
            onClick={() => { void submit(); }}
            type="button"
          >
            {busy ? 'Working…' : submitLabel}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
