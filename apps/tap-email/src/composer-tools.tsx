import { useCompactLayout } from '@tap-examples/tap-mobile-ui';
import type { MailFollowUp } from '@tap-examples/tap-email-protocol';
import type { MiniAppChannel } from '@theaiplatform/miniapp-sdk/sdk';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@theaiplatform/miniapp-sdk/ui';
import { Paperclip, WandSparkles, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { listConversationHandoffChannels } from './conversation-handoff';
import { draftSnapshotText, shareDraftSnapshot, type ComposerServices, type DraftSnapshot } from './composer-services';

export function followUpLabel(value: MailFollowUp): string {
  const days = value.delayMinutes / 1_440;
  const time = Number.isInteger(days) ? `${days} ${days === 1 ? 'day' : 'days'}` : `${value.delayMinutes} minutes`;
  return `${time} after sending · ${value.condition === 'if_no_reply' ? 'If no reply' : 'Regardless'}`;
}

export function ComposerToolbar({ canSend, attachmentBusy, sendAnyway, onAttach, onSend, onSchedule, onRemind, onShare, onWriteAi, children }: {
  readonly children?: React.ReactNode;
  readonly canSend: boolean;
  readonly attachmentBusy: boolean;
  readonly sendAnyway: boolean;
  readonly onAttach: () => void;
  readonly onSend: () => void;
  readonly onSchedule: () => void;
  readonly onRemind: () => void;
  readonly onShare: () => void;
  readonly onWriteAi: () => void;
}) {
  const compact = useCompactLayout();
  const [toolsOpen, setToolsOpen] = useState(false);
  if (compact && document.documentElement.dataset.tapMobile) return <>
    <div className="mobile-compose-toolbar">
      <Button type="button" disabled={!canSend} onClick={onSend} title="Send · ⌘Enter" aria-keyshortcuts="Meta+Enter Control+Enter">{sendAnyway ? 'Send anyway' : 'Send'}</Button>
      <Button type="button" variant="ghost" disabled={attachmentBusy} onClick={onAttach} aria-label={attachmentBusy ? 'Attaching files' : 'Attach files'}><Paperclip aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" onClick={() => setToolsOpen(true)}>More options</Button>
    </div>
    <Dialog open={toolsOpen} onOpenChange={setToolsOpen}>
      <DialogContent className="composer-tool-dialog mobile-compose-options">
        <DialogTitle>Message options</DialogTitle>
        <DialogDescription>Schedule, add a reminder, or share this draft.</DialogDescription>
        <Button type="button" variant="ghost" disabled={!canSend} onClick={() => { setToolsOpen(false); onSchedule(); }}>Send later</Button>
        <Button type="button" variant="ghost" onClick={() => { setToolsOpen(false); onRemind(); }}>Remind me</Button>
        <Button type="button" variant="ghost" onClick={() => { setToolsOpen(false); onShare(); }}>Share draft</Button>
        <Button type="button" variant="ghost" onClick={() => { setToolsOpen(false); onWriteAi(); }}>Write with AI</Button>
        {children}
      </DialogContent>
    </Dialog>
  </>;
  return <div className="composer-toolbar">
    <div className="composer-primary-actions">
      <Button type="button" disabled={!canSend} onClick={onSend} title="Send · ⌘Enter" aria-keyshortcuts="Meta+Enter Control+Enter">{sendAnyway ? 'Send anyway' : 'Send'}</Button>
      <Button type="button" variant="ghost" disabled={!canSend} onClick={onSchedule}>Send later</Button>
      <Button type="button" variant="ghost" onClick={onRemind}>Remind me</Button>
      <Button type="button" variant="ghost" onClick={onShare}>Share draft</Button>
      {children}
    </div>
    <div className="composer-secondary-actions">
      <Button type="button" variant="ghost" size="icon-sm" onClick={onWriteAi} aria-label="Write with AI" title="Write with AI · ⌘J" aria-keyshortcuts="Meta+J Control+J"><WandSparkles aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon-sm" disabled={attachmentBusy} onClick={onAttach} aria-label={attachmentBusy ? 'Attaching files' : 'Attach files'} title="Attach files"><Paperclip aria-hidden="true" /></Button>
    </div>
  </div>;
}

export function FollowUpSummary({ value, onEdit, onRemove }: {
  readonly value?: MailFollowUp;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}) {
  return value ? <div className="composer-follow-up">
    <Button type="button" variant="ghost" onClick={onEdit}>{followUpLabel(value)}</Button>
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove follow-up reminder" onClick={onRemove}><X aria-hidden="true" /></Button>
  </div> : null;
}

export function FollowUpDialog({ value, onChange, onClose }: {
  readonly value?: MailFollowUp;
  readonly onChange: (value: MailFollowUp) => void;
  readonly onClose: () => void;
}) {
  const daysRef = useRef<HTMLInputElement>(null);
  const [days, setDays] = useState(String((value?.delayMinutes ?? 2_880) / 1_440));
  const [returnFocus] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [condition, setCondition] = useState<MailFollowUp['condition']>(value?.condition ?? 'if_no_reply');
  const delayMinutes = Number(days) * 1_440;
  const valid = days.trim() !== '' && Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 365;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="composer-tool-dialog" data-composer-tool onOpenAutoFocus={event => { event.preventDefault(); daysRef.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); requestAnimationFrame(() => { if (returnFocus?.isConnected) returnFocus.focus(); }); }}>
      <DialogTitle>Remind me</DialogTitle>
      <DialogDescription>Follow up after this email is sent.</DialogDescription>
      <div className="composer-time-presets">{[1, 2, 3, 7].map(day => <Button key={day} type="button" variant="outline" aria-pressed={Number(days) === day} onClick={() => setDays(String(day))}>{day === 1 ? '1 day' : `${day} days`}</Button>)}</div>
      <label>Days after sending<Input ref={daysRef} type="number" name="follow-up-days" min={1} max={365} step={1} value={days} onChange={event => setDays(event.target.value)} /></label>
      <Select value={condition} onValueChange={next => setCondition(next as MailFollowUp['condition'])}>
        <SelectTrigger aria-label="Reminder condition"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="if_no_reply">If no reply</SelectItem><SelectItem value="regardless">Regardless</SelectItem></SelectContent>
      </Select>
      {!valid ? <p role="alert">Choose between 1 and 365 days.</p> : null}
      <DialogFooter className="composer-dialog-actions"><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button type="button" disabled={!valid} onClick={() => { if (valid) { onChange({ delayMinutes, condition }); onClose(); } }}>Set reminder</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function ShareDraftDialog({ services, draft, onClose }: {
  readonly services?: ComposerServices;
  readonly draft: DraftSnapshot;
  readonly onClose: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [snapshot] = useState(draft);
  const [returnFocus] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [channels, setChannels] = useState<readonly MiniAppChannel[]>([]);
  const [query, setQuery] = useState('');
  const [channelId, setChannelId] = useState('');
  const [loading, setLoading] = useState(Boolean(services?.workspaceId));
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sending = useRef(false);
  useEffect(() => {
    let active = true;
    if (services?.workspaceId) void listConversationHandoffChannels(services.platform, services.workspaceId)
      .then(items => { if (active) setChannels(items); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load channels.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [services]);
  const share = async () => {
    if (!services || !channelId || sending.current || shared) return;
    sending.current = true; setBusy(true); setError('');
    try {
      const result = await shareDraftSnapshot(services, channelId, snapshot);
      setShared(true); setNotice(result.warning ?? 'Draft shared to the channel.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not share the draft. Retry to check the same post.');
    } finally { sending.current = false; setBusy(false); }
  };
  const matches = channels.filter(channel => (channel.title || channel.description || channel.roomId).toLowerCase().includes(query.toLowerCase()));
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="composer-tool-dialog share-draft-dialog" data-composer-tool onOpenAutoFocus={event => { event.preventDefault(); (searchRef.current ?? cancelRef.current)?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); requestAnimationFrame(() => { if (returnFocus?.isConnected) returnFocus.focus(); }); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogTitle>Share draft</DialogTitle>
      <DialogDescription>Post this snapshot for discussion. Bcc and attachments are not included.</DialogDescription>
      {!services?.workspaceId ? <p role="status">Open Email in a TAP workspace to share a draft.</p> : <>
        <Input ref={searchRef} aria-label="Find a channel" placeholder="Find a channel…" value={query} onChange={event => { setQuery(event.target.value); setChannelId(''); }} disabled={busy || shared} />
        <Select value={channelId} onValueChange={setChannelId} disabled={loading || busy || shared}>
          <SelectTrigger aria-label="Share to channel"><SelectValue placeholder={loading ? 'Loading channels…' : 'Choose a channel'} /></SelectTrigger>
          <SelectContent>{matches.map(channel => <SelectItem key={channel.roomId} value={channel.roomId}>{channel.title || channel.description || channel.roomId}</SelectItem>)}</SelectContent>
        </Select>
        {!loading && !matches.length ? <p role="status">No channels found.</p> : null}
      </>}
      <pre className="draft-share-preview" aria-label="Draft snapshot">{draftSnapshotText(snapshot)}</pre>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <DialogFooter className="composer-dialog-actions"><Button ref={cancelRef} type="button" variant="ghost" disabled={busy} onClick={onClose}>{shared ? 'Done' : 'Cancel'}</Button>
        {!shared ? <Button type="button" disabled={!channelId || busy} onClick={() => { void share(); }}>{busy ? 'Sharing…' : 'Share to channel'}</Button> : null}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
