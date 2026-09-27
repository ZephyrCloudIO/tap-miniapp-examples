import React, { useEffect, useRef, useState, type AriaRole, type ReactNode } from 'react';
import { ArrowDown, RefreshCw } from 'lucide-react';

const releaseDistance = 64;

/** Own the list's touch gesture, leaving the mailbox and native header mounted. */
export function PullToSync({ enabled, syncing, onSync, role, label, children }: {
  readonly enabled: boolean;
  readonly syncing: boolean;
  readonly onSync: () => Promise<void>;
  readonly role?: AriaRole;
  readonly label: string;
  readonly children: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const syncingRef = useRef(syncing);
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => { syncingRef.current = syncing; }, [syncing]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !enabled) return;
    let start: { x: number; y: number; id: number } | null = null;
    let pulled = 0;
    let claimed = false;
    let suppressClickUntil = 0;
    let active = true;
    const cancel = () => { start = null; pulled = 0; claimed = false; setDistance(0); };
    const touchStart = (event: TouchEvent) => {
      cancel();
      if (inFlight.current || syncingRef.current || event.touches.length !== 1 || list.scrollTop > 0) return;
      const touch = event.touches[0]!;
      start = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
    };
    const touchMove = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch || touch.identifier !== start.id) { cancel(); return; }
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!claimed) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
        if (dy <= 0 || Math.abs(dx) >= dy || list.scrollTop > 0 || !event.cancelable) { cancel(); return; }
        claimed = true;
      }
      // React's delegated touch listeners may be passive. This listener must
      // cancel native overscroll only once a downward pull has been claimed.
      if (event.cancelable) event.preventDefault();
      suppressClickUntil = Date.now() + 750;
      pulled = Math.min(88, Math.max(0, dy * 0.5));
      setDistance(pulled);
    };
    const touchEnd = (event: TouchEvent) => {
      const release = claimed && pulled >= releaseDistance;
      if (claimed && event.cancelable) event.preventDefault();
      cancel();
      if (!release || inFlight.current || syncingRef.current) return;
      inFlight.current = true;
      setRefreshing(true);
      setAnnouncement('Syncing email');
      void Promise.resolve().then(onSync).then(
        () => { if (active) setAnnouncement('Email synced'); },
        () => { if (active) setAnnouncement('Could not sync email. Try again.'); },
      ).finally(() => {
        inFlight.current = false;
        setRefreshing(false);
      });
    };
    const click = (event: MouseEvent) => {
      if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); }
    };
    list.addEventListener('touchstart', touchStart, { passive: true });
    list.addEventListener('touchmove', touchMove, { passive: false });
    list.addEventListener('touchend', touchEnd);
    list.addEventListener('touchcancel', cancel);
    list.addEventListener('click', click, true);
    return () => {
      active = false;
      list.removeEventListener('touchstart', touchStart);
      list.removeEventListener('touchmove', touchMove);
      list.removeEventListener('touchend', touchEnd);
      list.removeEventListener('touchcancel', cancel);
      list.removeEventListener('click', click, true);
      setDistance(0);
    };
  }, [enabled, onSync]);

  // Background and toolbar sync already have a header indicator; only a pull
  // should move the list so automatic sync never shifts mail under the reader.
  const offset = enabled ? refreshing ? 52 : distance : 0;
  const ready = distance >= releaseDistance;
  return <div className={`mail-pull-sync${distance > 0 ? ' is-pulling' : ''}${refreshing ? ' is-syncing' : ''}`}>
    <div className="mail-pull-sync-indicator" aria-hidden="true" style={{ height: offset, opacity: offset > 0 ? 1 : 0 }}>
      {refreshing ? <RefreshCw /> : <ArrowDown className={ready ? 'is-ready' : ''} />}
      <span>{refreshing ? 'Syncing email…' : ready ? 'Release to sync' : 'Pull to sync'}</span>
    </div>
    <span className="sr-only" role="status">{announcement}</span>
    <div ref={listRef} className="thread-list" role={role} aria-label={label} style={enabled ? { transform: `translateY(${offset}px)` } : undefined}>
      {children}
    </div>
  </div>;
}
