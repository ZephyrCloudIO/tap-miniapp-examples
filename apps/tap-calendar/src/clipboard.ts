export interface ClipboardWriter {
  writeText(value: string): Promise<void>;
}

export interface ClipboardEnvironment {
  readonly clipboard?: ClipboardWriter | null;
  readonly document?: Document | null;
}

export type ClipboardCopyMethod = "clipboard-api" | "legacy-copy";

function browserClipboard(): ClipboardWriter | null {
  return typeof navigator === "undefined" ? null : navigator.clipboard ?? null;
}

function browserDocument(): Document | null {
  return typeof document === "undefined" ? null : document;
}

function legacyCopyText(value: string, targetDocument: Document): boolean {
  if (!targetDocument.body || typeof targetDocument.execCommand !== "function") return false;

  const previousActiveElement = targetDocument.activeElement;
  const textarea = targetDocument.createElement("textarea");
  textarea.value = value;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  targetDocument.body.append(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, value.length);

  try {
    return targetDocument.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    if (previousActiveElement instanceof HTMLElement) {
      previousActiveElement.focus({ preventScroll: true });
    }
  }
}

/**
 * Copy through the modern API when the host exposes it, with a synchronous
 * selection fallback for embedded surfaces that do not delegate clipboard-write.
 */
export async function copyTextToClipboard(
  value: string,
  environment: ClipboardEnvironment = {},
): Promise<ClipboardCopyMethod> {
  const clipboard = environment.clipboard === undefined
    ? browserClipboard()
    : environment.clipboard;
  const targetDocument = environment.document === undefined
    ? browserDocument()
    : environment.document;

  if (clipboard) {
    try {
      await clipboard.writeText(value);
      return "clipboard-api";
    } catch {
      // Embedded hosts can expose the API while denying clipboard-write.
    }
  }

  if (targetDocument && legacyCopyText(value, targetDocument)) {
    return "legacy-copy";
  }

  throw new Error("Clipboard access is unavailable.");
}
