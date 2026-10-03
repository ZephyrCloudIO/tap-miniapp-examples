import React, { useEffect, useRef } from 'react';

/** Observe inside the mailbox scroller, never the host window. */
export function MailHistorySentinel({ scope, pending, hasMore, failed, onLoad }: {
  readonly scope: string;
  readonly pending: boolean;
  readonly hasMore: boolean;
  readonly failed: boolean;
  readonly onLoad: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = element.current;
    const root = target?.closest<HTMLElement>('.thread-list');
    if (!target || !root || pending || !hasMore || failed) return;
    // Scroll fallback also makes the native host work without IntersectionObserver.
    const nearEnd = () => {
      if (root.clientHeight > 0 && root.scrollHeight - root.scrollTop - root.clientHeight < 480) onLoad();
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) onLoad();
    }, { root, rootMargin: '480px' });
    observer?.observe(target);
    root.addEventListener('scroll', nearEnd, { passive: true });
    nearEnd();
    return () => { observer?.disconnect(); root.removeEventListener('scroll', nearEnd); };
  }, [scope, pending, hasMore, failed, onLoad]);
  return <div className="mail-history-status" ref={element}>
    {failed ? <button type="button" onClick={onLoad}>Retry loading mail</button>
      : pending ? <span role="status">Loading more mail…</span>
      : hasMore ? null : <span role="status">End of available mail</span>}
  </div>;
}
