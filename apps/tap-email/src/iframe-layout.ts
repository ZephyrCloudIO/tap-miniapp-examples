import { readableFrameDocument } from './iframe-document';

type DocumentWithFonts = Document & { readonly fonts?: FontFaceSet };
type WindowWithLayoutObservers = Window & {
  readonly MutationObserver?: typeof MutationObserver;
  readonly ResizeObserver?: typeof ResizeObserver;
};

/**
 * Rich-message documents cannot execute script or fetch network resources, so
 * their late layout inputs are bounded: lazy/data image loads, embedded fonts,
 * details disclosure, DOM attributes, and host viewport changes. Watching those
 * avoids the iframe-height feedback loop caused by observing the iframe document
 * root with ResizeObserver.
 */
export function watchRichMessageLayout(
  frame: HTMLIFrameElement,
  onLayout: () => void,
): () => void {
  const frameDocument = readableFrameDocument(frame);
  const body = frameDocument?.body;
  const hostWindow = frame.ownerDocument.defaultView;
  if (!frameDocument || !body) {
    // Opaque mail scrolls inside its native frame. Its height follows the host
    // reader, including split-panel changes which do not resize the window.
    const reader = frame.closest<HTMLElement>('.message-body');
    const Observer = (hostWindow as WindowWithLayoutObservers | null)?.ResizeObserver;
    let width = reader?.clientWidth ?? 0;
    let height = reader?.clientHeight ?? 0;
    const observer = reader && Observer ? new Observer(() => {
      if (reader.clientWidth === width && reader.clientHeight === height) return;
      width = reader.clientWidth;
      height = reader.clientHeight;
      onLayout();
    }) : null;
    if (reader) observer?.observe(reader);
    hostWindow?.addEventListener('resize', onLayout);
    return () => { observer?.disconnect(); hostWindow?.removeEventListener('resize', onLayout); };
  }

  let active = true;
  const frameWindow = frameDocument.defaultView as WindowWithLayoutObservers | null;
  const Observer = frameWindow?.MutationObserver ?? globalThis.MutationObserver;
  const mutationObserver = typeof Observer === 'undefined'
    ? null
    : new Observer(() => onLayout());
  mutationObserver?.observe(body, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });

  const frameShell = frame.closest<HTMLElement>('.rich-message-shell');
  const ResizeObserverConstructor = (hostWindow as WindowWithLayoutObservers | null)
    ?.ResizeObserver ?? globalThis.ResizeObserver;
  let observedWidth = frameShell?.getBoundingClientRect().width ?? 0;
  const resizeObserver = frameShell && typeof ResizeObserverConstructor !== 'undefined'
    ? new ResizeObserverConstructor(entries => {
        const entry = entries.find(candidate => candidate.target === frameShell);
        const nextWidth = entry?.contentRect.width ?? 0;
        if (nextWidth <= 0 || nextWidth === observedWidth) return;
        observedWidth = nextWidth;
        onLayout();
      })
    : null;
  if (frameShell && resizeObserver) resizeObserver.observe(frameShell);

  const handleLayoutEvent = () => onLayout();
  frameDocument.addEventListener('load', handleLayoutEvent, true);
  frameDocument.addEventListener('toggle', handleLayoutEvent, true);
  hostWindow?.addEventListener('resize', handleLayoutEvent);
  const fonts = (frameDocument as DocumentWithFonts).fonts;
  if (fonts) {
    void fonts.ready.then(() => {
      if (active) onLayout();
    });
  }

  return () => {
    active = false;
    mutationObserver?.disconnect();
    resizeObserver?.disconnect();
    frameDocument.removeEventListener('load', handleLayoutEvent, true);
    frameDocument.removeEventListener('toggle', handleLayoutEvent, true);
    hostWindow?.removeEventListener('resize', handleLayoutEvent);
  };
}
