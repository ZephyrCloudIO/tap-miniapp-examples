import React, { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { CalendarDays } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@theaiplatform/miniapp-sdk/ui';
import { BookingLinksError, type BookingLinksClient, type PublishedBookingLink } from './booking-links';

interface ShareAvailabilityProps {
  readonly client?: BookingLinksClient;
  readonly bodyRef: RefObject<HTMLTextAreaElement | null>;
  readonly onBodyTextChange: (value: string) => void;
}

export function ShareAvailability(props: ShareAvailabilityProps) {
  // Switching TAP accounts/workspaces discards the list and all pending results.
  return <ScopedShareAvailability key={props.client?.scopeKey ?? 'unavailable'} {...props} />;
}

function ScopedShareAvailability({ client, bodyRef, onBodyTextChange }: ShareAvailabilityProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [links, setLinks] = useState<readonly PublishedBookingLink[]>([]);
  const [caret, setCaret] = useState<number | null>(null);
  const requestId = useRef(0);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const insertion = useRef({ body: '', start: 0, end: 0 });
  useEffect(() => () => { requestId.current += 1; }, []);
  useLayoutEffect(() => {
    if (caret === null) return;
    bodyRef.current?.focus({ preventScroll: true });
    bodyRef.current?.setSelectionRange(caret, caret);
    setCaret(null);
  }, [bodyRef, caret]);

  const close = () => {
    requestId.current += 1;
    setOpen(false);
    setBusy(false);
    bodyRef.current?.focus({ preventScroll: true });
  };
  const load = async () => {
    const id = ++requestId.current;
    setBusy(true);
    setError('');
    setLinks([]);
    try {
      if (!client) throw new BookingLinksError('unavailable');
      const result = await client.list();
      if (id === requestId.current) setLinks(result);
    } catch (error) {
      if (id === requestId.current) setError(error instanceof BookingLinksError ? error.message : new BookingLinksError('unavailable').message);
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  };
  const choose = async (selection: PublishedBookingLink) => {
    if (!client || busy) return;
    const id = ++requestId.current;
    setBusy(true);
    setError('');
    try {
      const link = await client.resolve(selection);
      if (id !== requestId.current) return;
      const saved = insertion.current;
      if (!bodyRef.current || bodyRef.current.value !== saved.body) {
        setError('Your message changed. Close this picker and choose the insertion point again.');
        return;
      }
      onBodyTextChange(saved.body.slice(0, saved.start) + link.url + saved.body.slice(saved.end));
      setOpen(false);
      setCaret(saved.start + link.url.length);
    } catch (error) {
      if (id === requestId.current) {
        setLinks([]);
        setError(error instanceof BookingLinksError ? error.message : new BookingLinksError('unavailable').message);
      }
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  };

  return (
    <div className="share-availability">
      <button type="button" aria-expanded={open} onClick={() => {
        if (open) { close(); return; }
        const body = bodyRef.current;
        insertion.current = { body: body?.value ?? '', start: body?.selectionStart ?? 0, end: body?.selectionEnd ?? 0 };
        setOpen(true);
        void load();
      }}><CalendarDays aria-hidden="true" />Share availability</button>
      <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
        <DialogContent className="booking-links-picker" hideCloseButton onOpenAutoFocus={event => {
          event.preventDefault();
          cancelRef.current?.focus();
        }} onCloseAutoFocus={event => {
          event.preventDefault();
          bodyRef.current?.focus({ preventScroll: true });
        }} onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Escape') { event.preventDefault(); close(); }
        }}>
          <DialogTitle>Share availability</DialogTitle>
          <DialogDescription>Choose one of your published Calendar booking pages.</DialogDescription>
          {busy ? <p role="status">Checking Calendar…</p> : null}
          {error ? <p role="alert">{error}</p> : null}
          {!busy && !error && links.length === 0 ? <p role="status">No published booking pages ready to share. Publish or republish an active Event Type in Calendar, then refresh.</p> : null}
          <ul>
            {links.map(link => <li key={`${link.profileId}/${link.eventTypeId}`}>
              <button type="button" disabled={busy} onClick={() => { void choose(link); }}>
                <span>{link.title} · {link.durationMinutes} min</span>
                <small>{link.url}</small>
              </button>
            </li>)}
          </ul>
          <button type="button" disabled={busy} onClick={() => { void load(); }}>Refresh</button>
          <button type="button" ref={cancelRef} onClick={close}>Cancel</button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
