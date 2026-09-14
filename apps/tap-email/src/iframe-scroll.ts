const wheelLineHeight = 16;
const keyboardLineHeight = 40;

type ReaderScrollDestination = number | 'end' | 'start';

function verticalWheelDelta(event: WheelEvent, pageHeight: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * wheelLineHeight;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * pageHeight;
  return event.deltaY;
}

function canScrollInDirection(element: Element, delta: number): boolean {
  const scrollingElement = element as HTMLElement;
  const maximumScrollTop = Math.max(0, scrollingElement.scrollHeight - scrollingElement.clientHeight);
  if (maximumScrollTop === 0) return false;
  return delta < 0
    ? scrollingElement.scrollTop > 0
    : scrollingElement.scrollTop < maximumScrollTop;
}

function eventTargetElement(target: EventTarget | null): Element | null {
  const node = target as Node | null;
  if (!node) return null;
  if (node.nodeType === 1) return node as Element;
  return node.parentElement;
}

function nestedScrollerCanMove(
  target: EventTarget | null,
  documentScroller: Element,
  delta: number,
  view: Window | null,
): boolean {
  let element = eventTargetElement(target);
  while (element && element !== documentScroller) {
    const overflowY = view?.getComputedStyle(element).overflowY ?? '';
    if (
      /^(?:auto|overlay|scroll)$/u.test(overflowY) &&
      canScrollInDirection(element, delta)
    ) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

function readerScrollTop(
  reader: HTMLElement,
  destination: ReaderScrollDestination,
): number {
  const maximumScrollTop = Math.max(0, reader.scrollHeight - reader.clientHeight);
  if (destination === 'start') return 0;
  if (destination === 'end') return maximumScrollTop;
  return Math.min(maximumScrollTop, Math.max(0, reader.scrollTop + destination));
}

function moveReader(
  reader: HTMLElement,
  destination: ReaderScrollDestination,
): boolean {
  const nextScrollTop = readerScrollTop(reader, destination);
  if (nextScrollTop === reader.scrollTop) return false;
  reader.scrollTop = nextScrollTop;
  return true;
}

function keyScrollDestination(
  event: KeyboardEvent,
  pageHeight: number,
): ReaderScrollDestination | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.shiftKey && event.key !== ' ') return null;
  if (event.key === 'ArrowDown') return keyboardLineHeight;
  if (event.key === 'ArrowUp') return -keyboardLineHeight;
  if (event.key === 'PageDown') return pageHeight;
  if (event.key === 'PageUp') return -pageHeight;
  if (event.key === ' ') return event.shiftKey ? -pageHeight : pageHeight;
  if (event.key === 'Home') return 'start';
  if (event.key === 'End') return 'end';
  return null;
}

function isInteractiveKeyboardTarget(target: EventTarget | null): boolean {
  const element = eventTargetElement(target);
  return Boolean(element?.closest(
    'a[href], button, input, select, summary, textarea, [contenteditable="true"], [role="button"]',
  ));
}

/**
 * A wheel event does not cross the browsing-context boundary of a srcdoc iframe.
 * Rich messages are normally sized to their full document height, so the frame
 * itself has nowhere to scroll and would otherwise swallow trackpad/mouse input.
 * Relay only that boundary case to the reader's scrollport; an exceptionally
 * tall frame that has its own remaining scroll range keeps the native behavior.
 */
export function bridgeRichMessageWheel(
  frame: HTMLIFrameElement,
  reader: HTMLElement | null,
): () => void {
  const frameDocument = frame.contentDocument;
  if (!frameDocument || !reader) return () => undefined;

  const onWheel = (event: WheelEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.deltaY === 0) return;
    const delta = verticalWheelDelta(event, reader.clientHeight);
    const frameScroller = frameDocument.scrollingElement ?? frameDocument.documentElement;
    if (
      nestedScrollerCanMove(
        event.target,
        frameScroller,
        delta,
        frameDocument.defaultView,
      ) || canScrollInDirection(frameScroller, delta)
    ) {
      return;
    }

    if (moveReader(reader, delta)) event.preventDefault();
  };

  frameDocument.addEventListener('wheel', onWheel, { passive: false });
  return () => frameDocument.removeEventListener('wheel', onWheel);
}

/** Preserve native document/nested scrolling, then continue accessible keys in the reader. */
export function bridgeRichMessageKeyboardScroll(
  frame: HTMLIFrameElement,
  reader: HTMLElement | null,
): () => void {
  const frameDocument = frame.contentDocument;
  if (!frameDocument || !reader) return () => undefined;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || isInteractiveKeyboardTarget(event.target)) return;
    const destination = keyScrollDestination(event, reader.clientHeight);
    if (destination === null) return;
    const direction = destination === 'start' || (typeof destination === 'number' && destination < 0)
      ? -1
      : 1;
    const frameScroller = frameDocument.scrollingElement ?? frameDocument.documentElement;
    if (
      nestedScrollerCanMove(
        event.target,
        frameScroller,
        direction,
        frameDocument.defaultView,
      ) || canScrollInDirection(frameScroller, direction)
    ) {
      return;
    }
    if (moveReader(reader, destination)) event.preventDefault();
  };

  frameDocument.addEventListener('keydown', onKeyDown);
  return () => frameDocument.removeEventListener('keydown', onKeyDown);
}
