/** A scriptless message can remain opaque under the host's child-frame guard. */
export function readableFrameDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument;
  } catch (error) {
    if ((error as DOMException)?.name === 'SecurityError') return null;
    throw error;
  }
}
