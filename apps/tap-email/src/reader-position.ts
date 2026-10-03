import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Align the header, not the bottom of a potentially very tall message. */
export function scrollMessageVerticallyIntoView(message: HTMLElement): void {
  const reader = message.closest<HTMLElement>('.message-body');
  if (!reader) return;
  const padding = Number.parseFloat(getComputedStyle(reader).paddingTop) || 0;
  const delta = message.getBoundingClientRect().top - reader.getBoundingClientRect().top - reader.clientTop - padding;
  if (Math.abs(delta) > 1) reader.scrollTop = Math.max(0, reader.scrollTop + delta);
}

/** Correct delayed frame sizing only until the user starts reading/scrolling. */
export function useReaderEntryPosition(
  rootRef: RefObject<HTMLElement | null>,
  messageRef: RefObject<HTMLElement | null>,
  active: boolean,
  messageId: string | null,
  singleMessage: boolean,
  ready: boolean,
): void {
  const userMoved = useRef(false);
  useLayoutEffect(() => { if (active) userMoved.current = false; }, [active]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const reader = root?.closest<HTMLElement>('.message-body');
    if (!active || !reader || !root) return;
    let following = !userMoved.current;
    let positionedTop = reader.scrollTop;
    const position = () => {
      if (!following) return;
      if (singleMessage || !messageRef.current) reader.scrollTop = 0;
      else scrollMessageVerticallyIntoView(messageRef.current);
      positionedTop = reader.scrollTop;
    };
    const stop = () => { userMoved.current = true; following = false; observer?.disconnect(); };
    const onScroll = () => { if (Math.abs(reader.scrollTop - positionedTop) > 1) stop(); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) stop();
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    // Layout effects reset a warm reader before paint without remounting frames.
    position();
    observer?.observe(root);
    // Paging controls precede the list in the retained reader. Their height can
    // change without changing the list itself, so include that enclosing layout.
    if (root.parentElement && root.parentElement !== reader) observer?.observe(root.parentElement);
    reader.addEventListener('scroll', onScroll, { passive: true });
    reader.addEventListener('wheel', stop, { passive: true });
    reader.addEventListener('touchstart', stop, { passive: true });
    reader.addEventListener('pointerdown', stop, { passive: true });
    reader.addEventListener('keydown', onKeyDown);
    return () => {
      following = false;
      observer?.disconnect();
      reader.removeEventListener('scroll', onScroll);
      reader.removeEventListener('wheel', stop);
      reader.removeEventListener('touchstart', stop);
      reader.removeEventListener('pointerdown', stop);
      reader.removeEventListener('keydown', onKeyDown);
    };
  }, [active, messageId, singleMessage, ready, rootRef, messageRef]);
}
