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
  const frameDocument = frame.contentDocument;
  const body = frameDocument?.body;
  if (!frameDocument || !body) return () => undefined;

  let active = true;
  const hostWindow = frame.ownerDocument.defaultView;
  const frameWindow = frame.contentWindow as WindowWithLayoutObservers | null;
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
