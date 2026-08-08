import { ApiError } from "./policy";

export interface BrowserToolCdpClient {
  send<Result = unknown>(
    method: string,
    params?: Readonly<Record<string, unknown>>,
  ): Promise<Result>;
}

export interface BrowserElementCandidate {
  readonly backendNodeId: number;
  readonly role: string;
  readonly name: string;
  readonly description: string | null;
  readonly value: string | null;
  readonly disabled: boolean;
  readonly focused: boolean;
  readonly interactive: boolean;
}

export interface BrowserSnapshotElement {
  readonly ref: string | null;
  readonly role: string;
  readonly name: string;
  readonly description: string | null;
  readonly value: string | null;
  readonly disabled: boolean;
  readonly focused: boolean;
}

export interface BrowserPageSnapshot {
  readonly url: string;
  readonly title: string;
  readonly documentRevision: number;
  readonly elements: readonly BrowserSnapshotElement[];
  readonly truncated: boolean;
}

export interface BrowserScreenshot {
  readonly mediaType: "image/png";
  readonly base64: string;
  readonly byteLength: number;
}

export type BrowserElementRepresentation = "selector" | "html" | "png";

export interface BrowserElementSelection {
  readonly representation: BrowserElementRepresentation;
  readonly selector: string | null;
  readonly html: string | null;
  readonly mediaType: "image/png" | null;
  readonly base64: string | null;
  readonly byteLength: number | null;
}

export interface NetworkRequestUpdate {
  readonly requestId: string;
  readonly method: string | null;
  readonly url: string | null;
  readonly resourceType: string | null;
  readonly status: number | null;
  readonly failed: boolean | null;
  readonly errorText: string | null;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
}

export interface BrowserDiagnosticCandidate {
  readonly kind:
    | "console"
    | "exception"
    | "network"
    | "http"
    | "cdp"
    | "telemetry";
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly source: string | null;
  readonly occurredAt: number;
}

const MAX_AX_ELEMENTS = 500;
const MAX_TEXT_LENGTH = 1_000;
const MAX_SCREENSHOT_BYTES = 6 * 1024 * 1024;
const MAX_ELEMENT_HTML_BYTES = 128 * 1024;
const MAX_ELEMENT_SELECTOR_LENGTH = 4_096;
const MAX_FILL_LENGTH = 10_000;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);
const CREDENTIAL_FIELD = /(?:pass(?:word)?|secret|token|otp|one[-_ ]?time|credit[-_ ]?card|card[-_ ]?number|cvv|cvc)/iu;
const SENSITIVE_PATH_SEGMENT = /(?:auth|bearer|credential|key|jwt|pass|secret|session|signature|signed|token)/iu;
const HIGH_ENTROPY_PATH_SEGMENT = /^(?=.{32,}$)(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9._~-]+$/u;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundedText(value: unknown, limit = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, limit);
}

function axValue(value: unknown): unknown {
  return record(value)?.value;
}

function axText(value: unknown): string | null {
  return boundedText(axValue(value));
}

function axBoolean(value: unknown): boolean {
  return axValue(value) === true;
}

function axProperties(node: Readonly<Record<string, unknown>>): ReadonlyMap<string, unknown> {
  const properties = new Map<string, unknown>();
  const raw = node.properties;
  if (!Array.isArray(raw)) return properties;
  for (const propertyValue of raw) {
    const property = record(propertyValue);
    const name = property?.name;
    if (typeof name === "string") properties.set(name, property?.value);
  }
  return properties;
}

function browserNavigationEntry(value: unknown): { readonly url: string; readonly title: string } {
  const history = record(value);
  const entries = history?.entries;
  const currentIndex = finiteNumber(history?.currentIndex);
  if (!Array.isArray(entries) || currentIndex === null) {
    throw new ApiError(502, "invalid_cdp_result", "The browser omitted its navigation state.");
  }
  const current = record(entries[currentIndex]);
  const url = current?.url;
  if (typeof url !== "string" || !url) {
    throw new ApiError(502, "invalid_cdp_result", "The browser omitted the current page URL.");
  }
  return {
    url,
    title: boundedText(current?.title) ?? "",
  };
}

function elementCandidate(value: unknown): BrowserElementCandidate | null {
  const node = record(value);
  if (!node || node.ignored === true) return null;
  const backendNodeId = finiteNumber(node.backendDOMNodeId);
  const role = axText(node.role)?.toLowerCase() ?? "";
  const name = axText(node.name) ?? "";
  const description = axText(node.description);
  const valueText = axText(node.value);
  if (backendNodeId === null || !Number.isSafeInteger(backendNodeId) || backendNodeId <= 0) {
    return null;
  }
  const properties = axProperties(node);
  const interactive =
    INTERACTIVE_ROLES.has(role) ||
    axBoolean(properties.get("focusable")) ||
    axBoolean(properties.get("editable"));
  if (!role && !name && !description && valueText === null) return null;
  return {
    backendNodeId,
    role: role || "generic",
    name,
    description,
    value: valueText,
    disabled: axBoolean(properties.get("disabled")),
    focused: axBoolean(properties.get("focused")),
    interactive,
  };
}

export async function capturePageSnapshot(
  cdp: BrowserToolCdpClient,
  documentRevision: number,
  registerElement: (
    candidate: BrowserElementCandidate,
    documentRevision: number,
  ) => Promise<string>,
): Promise<BrowserPageSnapshot> {
  const [historyResult, treeResult] = await Promise.all([
    cdp.send("Page.getNavigationHistory"),
    cdp.send("Accessibility.getFullAXTree", { depth: -1 }),
  ]);
  const navigation = browserNavigationEntry(historyResult);
  const tree = record(treeResult)?.nodes;
  if (!Array.isArray(tree)) {
    throw new ApiError(502, "invalid_cdp_result", "The browser omitted the accessibility tree.");
  }
  const candidates = tree
    .map(elementCandidate)
    .filter((candidate): candidate is BrowserElementCandidate => candidate !== null);
  const limited = candidates.slice(0, MAX_AX_ELEMENTS);
  const elements: BrowserSnapshotElement[] = [];
  for (const candidate of limited) {
    elements.push({
      ref: await registerElement(candidate, documentRevision),
      role: candidate.role,
      name: candidate.name,
      description: candidate.description,
      value: candidate.value,
      disabled: candidate.disabled,
      focused: candidate.focused,
    });
  }
  return {
    ...navigation,
    documentRevision,
    elements,
    truncated: candidates.length > limited.length,
  };
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 !== 0) {
    throw new ApiError(502, "invalid_cdp_result", "The browser returned an invalid screenshot.");
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new ApiError(502, "invalid_cdp_result", "The browser returned an invalid screenshot.");
  }
  if (binary.length > MAX_SCREENSHOT_BYTES) {
    throw new ApiError(502, "upstream_too_large", "The browser screenshot exceeded the gateway limit.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function capturePageScreenshot(
  cdp: BrowserToolCdpClient,
): Promise<BrowserScreenshot> {
  const result = record(
    await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    }),
  );
  const data = result?.data;
  if (typeof data !== "string") {
    throw new ApiError(502, "invalid_cdp_result", "The browser omitted the screenshot.");
  }
  const bytes = decodeBase64(data);
  if (
    bytes.length < PNG_SIGNATURE.length ||
    !PNG_SIGNATURE.every((expected, index) => bytes[index] === expected)
  ) {
    throw new ApiError(502, "invalid_cdp_result", "The browser returned a non-PNG screenshot.");
  }
  return { mediaType: "image/png", base64: data, byteLength: bytes.length };
}

const BUILD_DURABLE_SELECTOR = `function() {
  if (!this || this.nodeType !== 1 || typeof this.tagName !== "string") return null;
  const safeValue = (value) =>
    typeof value === "string" &&
    /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(value) &&
    !/(?:auth|bearer|credential|key|jwt|pass|secret|session|signature|signed|token)/i.test(value) &&
    !(value.length >= 32 && /[A-Za-z]/.test(value) && /[0-9]/.test(value));
  const stableAttributes = ["data-testid", "data-test-id", "data-test", "data-qa", "data-cy", "id"];
  const segments = [];
  let element = this;
  let depth = 0;
  while (element && depth < 64) {
    const tag = String(element.tagName || "").toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) return null;
    let stable = "";
    for (const name of stableAttributes) {
      const value = element.getAttribute(name);
      if (safeValue(value)) {
        stable = "[" + name + "=\\\"" + value + "\\\"]";
        break;
      }
    }
    let position = 1;
    let sibling = element.previousElementSibling;
    while (sibling) {
      if (String(sibling.tagName || "").toLowerCase() === tag) position += 1;
      sibling = sibling.previousElementSibling;
    }
    segments.unshift(tag + stable + ":nth-of-type(" + position + ")");
    const parent = element.parentElement;
    if (!parent) {
      if (element.ownerDocument && element.ownerDocument.documentElement !== element) return null;
      return segments.join(" > ");
    }
    element = parent;
    depth += 1;
  }
  return null;
}`;

const SERIALIZE_SANITIZED_OUTER_HTML = `function() {
  if (!this || this.nodeType !== 1 || typeof this.tagName !== "string") {
    return { html: null, tooLarge: false };
  }
  const blockedTags = new Set(["script", "style", "noscript", "template", "iframe", "object", "embed"]);
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const booleanAttributes = new Set(["checked", "disabled", "hidden", "multiple", "open", "readonly", "required", "selected"]);
  const textAttributes = new Set(["alt", "for", "placeholder", "role", "tabindex", "title", "type"]);
  const stableAttributes = new Set(["id", "name", "data-testid", "data-test-id", "data-test", "data-qa", "data-cy"]);
  const safeToken = (value) =>
    typeof value === "string" &&
    /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(value) &&
    !/(?:auth|bearer|credential|key|jwt|pass|secret|session|signature|signed|token)/i.test(value) &&
    !(value.length >= 32 && /[A-Za-z]/.test(value) && /[0-9]/.test(value));
  const escapeText = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escapeAttribute = (value) => escapeText(value).replace(/\"/g, "&quot;");
  const safeUrl = (value) => {
    try {
      const url = new URL(value, document.baseURI);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  };
  let output = "";
  let nodeCount = 0;
  let tooLarge = false;
  const append = (value) => {
    if (tooLarge) return;
    if (output.length + value.length > 131072) {
      tooLarge = true;
      return;
    }
    output += value;
  };
  const visit = (node, depth) => {
    if (tooLarge || nodeCount >= 500 || depth > 24) return;
    nodeCount += 1;
    if (node.nodeType === 3) {
      append(escapeText(String(node.nodeValue || "").slice(0, 4000)));
      return;
    }
    if (node.nodeType !== 1 || typeof node.tagName !== "string") return;
    const tag = String(node.tagName).toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(tag) || blockedTags.has(tag)) return;
    if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true") return;
    try {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.contentVisibility === "hidden") return;
    } catch {}
    append("<" + tag);
    const attributes = Array.from(node.attributes || []).slice(0, 64);
    for (const attribute of attributes) {
      const name = String(attribute.name || "").toLowerCase();
      const value = String(attribute.value || "");
      if (booleanAttributes.has(name)) {
        append(" " + name);
      } else if (name === "class") {
        const classes = value.split(/\\s+/).filter(safeToken).slice(0, 12);
        if (classes.length > 0) append(" class=\\\"" + escapeAttribute(classes.join(" ")) + "\\\"");
      } else if (stableAttributes.has(name) && safeToken(value)) {
        append(" " + name + "=\\\"" + escapeAttribute(value) + "\\\"");
      } else if ((name === "href" || name === "src" || name === "action" || name === "formaction" || name === "poster")) {
        const url = safeUrl(value);
        if (url) append(" " + name + "=\\\"" + escapeAttribute(url) + "\\\"");
      } else if (textAttributes.has(name) || /^aria-[a-z0-9-]+$/.test(name)) {
        const text = value.replace(/\\s+/g, " ").trim().slice(0, 1000);
        if (text) append(" " + name + "=\\\"" + escapeAttribute(text) + "\\\"");
      }
    }
    append(">");
    if (!voidTags.has(tag)) {
      const children = Array.from(node.childNodes || []);
      if (tag !== "textarea") {
        for (const child of children) visit(child, depth + 1);
      }
      append("</" + tag + ">");
    }
  };
  visit(this, 0);
  return { html: tooLarge ? null : output, tooLarge };
}`;

function runtimeResultValue(value: unknown): unknown {
  const result = record(value);
  if (result?.exceptionDetails !== undefined) {
    throw new ApiError(
      502,
      "element_resolution_failed",
      "The browser could not resolve the selected element.",
    );
  }
  return record(result?.result)?.value;
}

async function resolvedElementObjectId(
  cdp: BrowserToolCdpClient,
  backendNodeId: number,
): Promise<string> {
  const objectId = record(record(
    await cdp.send("DOM.resolveNode", { backendNodeId }),
  )?.object)?.objectId;
  if (typeof objectId !== "string" || !objectId) {
    throw new ApiError(502, "invalid_cdp_result", "The browser could not resolve the selected element.");
  }
  return objectId;
}

async function selectedElementSelector(
  cdp: BrowserToolCdpClient,
  backendNodeId: number,
): Promise<string> {
  const objectId = await resolvedElementObjectId(cdp, backendNodeId);
  try {
    const value = runtimeResultValue(await cdp.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: BUILD_DURABLE_SELECTOR,
      awaitPromise: false,
      returnByValue: true,
    }));
    if (
      typeof value !== "string" ||
      value.length < 1 ||
      value.length > MAX_ELEMENT_SELECTOR_LENGTH ||
      /[\r\n\0]/u.test(value) ||
      !/^[a-z][a-z0-9-]*(?:\[(?:data-testid|data-test-id|data-test|data-qa|data-cy|id)="[A-Za-z][A-Za-z0-9_.:-]{0,63}"\])?:nth-of-type\([1-9][0-9]*\)(?: > [a-z][a-z0-9-]*(?:\[(?:data-testid|data-test-id|data-test|data-qa|data-cy|id)="[A-Za-z][A-Za-z0-9_.:-]{0,63}"\])?:nth-of-type\([1-9][0-9]*\))*$/u.test(value)
    ) {
      throw new ApiError(
        409,
        "element_selector_unavailable",
        "A safe document-level selector is unavailable for the selected element.",
      );
    }
    return value;
  } finally {
    await cdp.send("Runtime.releaseObject", { objectId }).catch(() => undefined);
  }
}

const SANITIZED_HTML_BLOCKED_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
]);
const SANITIZED_HTML_VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const SANITIZED_HTML_BOOLEAN_ATTRIBUTES = new Set([
  "checked",
  "disabled",
  "hidden",
  "multiple",
  "open",
  "readonly",
  "required",
  "selected",
]);
const SANITIZED_HTML_TEXT_ATTRIBUTES = new Set([
  "alt",
  "for",
  "placeholder",
  "role",
  "tabindex",
  "title",
  "type",
]);
const SANITIZED_HTML_STABLE_ATTRIBUTES = new Set([
  "id",
  "name",
  "data-testid",
  "data-test-id",
  "data-test",
  "data-qa",
  "data-cy",
]);
const SANITIZED_HTML_URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "poster",
]);

function safeElementToken(value: string, limit = 128): boolean {
  return (
    value.length <= limit &&
    /^[A-Za-z][A-Za-z0-9_.:-]*$/u.test(value) &&
    !SENSITIVE_PATH_SEGMENT.test(value) &&
    !HIGH_ENTROPY_PATH_SEGMENT.test(value)
  );
}

function validSanitizedHtmlAttribute(name: string, value: string | null): boolean {
  if (SANITIZED_HTML_BOOLEAN_ATTRIBUTES.has(name)) return value === null;
  if (value === null || /[<>"\0]/u.test(value)) return false;
  if (name === "class") {
    const tokens = value.split(/\s+/u).filter(Boolean);
    return tokens.length >= 1 &&
      tokens.length <= 12 &&
      tokens.every((token) => safeElementToken(token));
  }
  if (SANITIZED_HTML_STABLE_ATTRIBUTES.has(name)) {
    return safeElementToken(value);
  }
  if (SANITIZED_HTML_URL_ATTRIBUTES.has(name)) {
    try {
      const url = new URL(value.replaceAll("&amp;", "&"));
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }
  return (
    SANITIZED_HTML_TEXT_ATTRIBUTES.has(name) ||
    /^aria-[a-z0-9-]+$/u.test(name)
  ) && value.length <= MAX_TEXT_LENGTH;
}

function assertSanitizedHtmlGrammar(value: string): void {
  const stack: string[] = [];
  let index = 0;
  let nodeCount = 0;
  while (index < value.length) {
    const tagStart = value.indexOf("<", index);
    const textEnd = tagStart === -1 ? value.length : tagStart;
    const text = value.slice(index, textEnd);
    if (text.includes(">") || /&(?!amp;|lt;|gt;|quot;)/u.test(text)) {
      throw new ApiError(502, "invalid_cdp_result", "The browser returned unsafe element HTML.");
    }
    if (stack.at(-1) === "textarea" && text.length > 0) {
      throw new ApiError(502, "invalid_cdp_result", "The browser returned unsafe element HTML.");
    }
    if (tagStart === -1) break;
    const tagEnd = value.indexOf(">", tagStart + 1);
    if (tagEnd === -1) {
      throw new ApiError(502, "invalid_cdp_result", "The browser returned invalid element HTML.");
    }
    const tagText = value.slice(tagStart, tagEnd + 1);
    const closing = /^<\/([a-z][a-z0-9-]*)>$/u.exec(tagText);
    if (closing) {
      if (stack.pop() !== closing[1]) {
        throw new ApiError(502, "invalid_cdp_result", "The browser returned invalid element HTML.");
      }
      index = tagEnd + 1;
      continue;
    }
    if (stack.at(-1) === "textarea") {
      throw new ApiError(502, "invalid_cdp_result", "The browser returned unsafe element HTML.");
    }
    const opening = /^<([a-z][a-z0-9-]*)/u.exec(tagText);
    const tag = opening?.[1];
    if (!tag || SANITIZED_HTML_BLOCKED_TAGS.has(tag)) {
      throw new ApiError(502, "invalid_cdp_result", "The browser returned unsafe element HTML.");
    }
    let attributeIndex = opening[0].length;
    const attributesEnd = tagText.length - 1;
    while (attributeIndex < attributesEnd) {
      const attribute = /\s+([a-z][a-z0-9-]*)(?:="([^"<>]*)")?/uy;
      attribute.lastIndex = attributeIndex;
      const matched = attribute.exec(tagText);
      if (!matched || matched.index !== attributeIndex || !matched[1]) {
        throw new ApiError(502, "invalid_cdp_result", "The browser returned invalid element HTML.");
      }
      const attributeValue = matched[2] ?? null;
      if (
        (attributeValue !== null && /&(?!amp;|lt;|gt;|quot;)/u.test(attributeValue)) ||
        !validSanitizedHtmlAttribute(matched[1], attributeValue)
      ) {
        throw new ApiError(502, "invalid_cdp_result", "The browser returned unsafe element HTML.");
      }
      attributeIndex = attribute.lastIndex;
    }
    nodeCount += 1;
    if (nodeCount > 500) {
      throw new ApiError(413, "element_html_too_large", "The selected element HTML exceeds the gateway limit.");
    }
    if (!SANITIZED_HTML_VOID_TAGS.has(tag)) {
      stack.push(tag);
      if (stack.length > 25) {
        throw new ApiError(413, "element_html_too_large", "The selected element HTML exceeds the gateway limit.");
      }
    }
    index = tagEnd + 1;
  }
  if (stack.length !== 0) {
    throw new ApiError(502, "invalid_cdp_result", "The browser returned invalid element HTML.");
  }
}

function redactElementHtml(value: unknown): string {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    throw new ApiError(502, "invalid_cdp_result", "The browser returned invalid element HTML.");
  }
  if (new TextEncoder().encode(value).byteLength > MAX_ELEMENT_HTML_BYTES) {
    throw new ApiError(413, "element_html_too_large", "The selected element HTML exceeds the gateway limit.");
  }
  if (/<\/?(?:script|style|noscript|template|iframe|object|embed)\b/iu.test(value) || /\son[a-z]+\s*=/iu.test(value)) {
    throw new ApiError(502, "invalid_cdp_result", "The browser returned unsafe element HTML.");
  }
  assertSanitizedHtmlGrammar(value);
  const redacted = value.replace(
    /\bhttps?:\/\/[^\s<>"']+/giu,
    (candidate) => sanitizedNetworkUrl(candidate) ?? "[REDACTED URL]",
  ).replace(
    /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu,
    "$1 [REDACTED]",
  ).replace(
    /(["']?)(authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|api[_-]?key|credential)(["']?)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^"'\s,;}\]<]+)/giu,
    "$1$2$3$4[REDACTED]",
  ).replace(
    /\b(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,})\b/gu,
    "[REDACTED TOKEN]",
  );
  assertSanitizedHtmlGrammar(redacted);
  return redacted;
}

async function selectedElementHtml(
  cdp: BrowserToolCdpClient,
  backendNodeId: number,
): Promise<string> {
  const objectId = await resolvedElementObjectId(cdp, backendNodeId);
  try {
    const value = record(runtimeResultValue(await cdp.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: SERIALIZE_SANITIZED_OUTER_HTML,
      awaitPromise: false,
      returnByValue: true,
    })));
    if (value?.tooLarge === true) {
      throw new ApiError(413, "element_html_too_large", "The selected element HTML exceeds the gateway limit.");
    }
    return redactElementHtml(value?.html);
  } finally {
    await cdp.send("Runtime.releaseObject", { objectId }).catch(() => undefined);
  }
}

function elementScreenshotClip(value: unknown): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scale: 1;
} {
  const model = record(record(value)?.model);
  const quad = model?.border ?? model?.content;
  if (!Array.isArray(quad) || quad.length !== 8) {
    throw new ApiError(409, "element_not_visible", "The selected element has no visible bounds.");
  }
  const coordinates = quad.map(finiteNumber);
  if (coordinates.some((coordinate) => coordinate === null)) {
    throw new ApiError(409, "element_not_visible", "The selected element has no usable bounds.");
  }
  const numeric = coordinates.filter((coordinate): coordinate is number => coordinate !== null);
  const xs = numeric.filter((_, index) => index % 2 === 0);
  const ys = numeric.filter((_, index) => index % 2 === 1);
  const left = Math.max(0, Math.min(...xs));
  const top = Math.max(0, Math.min(...ys));
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const width = right - left;
  const height = bottom - top;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 8_192 ||
    height > 8_192 ||
    width * height > 16_777_216
  ) {
    throw new ApiError(409, "element_not_visible", "The selected element bounds are outside the capture limit.");
  }
  return { x: left, y: top, width, height, scale: 1 };
}

async function selectedElementScreenshot(
  cdp: BrowserToolCdpClient,
  backendNodeId: number,
): Promise<BrowserScreenshot> {
  const clip = elementScreenshotClip(
    await cdp.send("DOM.getBoxModel", { backendNodeId }),
  );
  const result = record(await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
    clip,
  }));
  const data = result?.data;
  if (typeof data !== "string") {
    throw new ApiError(502, "invalid_cdp_result", "The browser omitted the element screenshot.");
  }
  const bytes = decodeBase64(data);
  if (
    bytes.length < PNG_SIGNATURE.length ||
    !PNG_SIGNATURE.every((expected, index) => bytes[index] === expected)
  ) {
    throw new ApiError(502, "invalid_cdp_result", "The browser returned a non-PNG element screenshot.");
  }
  return { mediaType: "image/png", base64: data, byteLength: bytes.length };
}

export async function backendNodeAtViewportRatio(
  cdp: BrowserToolCdpClient,
  xRatio: number,
  yRatio: number,
): Promise<number> {
  const { x, y } = await viewportPoint(cdp, xRatio, yRatio);
  const result = record(await cdp.send("DOM.getNodeForLocation", {
    x,
    y,
    includeUserAgentShadowDOM: false,
    ignorePointerEventsNone: false,
  }));
  const backendNodeId = finiteNumber(result?.backendNodeId);
  if (
    backendNodeId === null ||
    !Number.isSafeInteger(backendNodeId) ||
    backendNodeId <= 0
  ) {
    throw new ApiError(409, "element_not_found", "No selectable element exists at that viewport position.");
  }
  return backendNodeId;
}

async function viewportPoint(
  cdp: BrowserToolCdpClient,
  xRatio: number,
  yRatio: number,
): Promise<{ readonly x: number; readonly y: number }> {
  if (
    !Number.isFinite(xRatio) ||
    !Number.isFinite(yRatio) ||
    xRatio < 0 ||
    xRatio > 1 ||
    yRatio < 0 ||
    yRatio > 1
  ) {
    throw new ApiError(400, "invalid_element_coordinates", "Element coordinates must be normalized numbers from 0 to 1.");
  }
  const metrics = record(await cdp.send("Page.getLayoutMetrics"));
  const viewport = record(metrics?.cssVisualViewport) ?? record(metrics?.visualViewport);
  const width = finiteNumber(viewport?.clientWidth);
  const height = finiteNumber(viewport?.clientHeight);
  if (width === null || height === null || width <= 0 || height <= 0) {
    throw new ApiError(502, "invalid_cdp_result", "The browser omitted its visible viewport.");
  }
  const x = Math.min(Math.max(0, Math.floor(xRatio * width)), Math.max(0, Math.ceil(width) - 1));
  const y = Math.min(Math.max(0, Math.floor(yRatio * height)), Math.max(0, Math.ceil(height) - 1));
  return { x, y };
}

export async function scrollViewport(
  cdp: BrowserToolCdpClient,
  xRatio: number,
  yRatio: number,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  if (
    !Number.isFinite(deltaX) ||
    !Number.isFinite(deltaY) ||
    Math.abs(deltaX) > 2_400 ||
    Math.abs(deltaY) > 2_400 ||
    (deltaX === 0 && deltaY === 0)
  ) {
    throw new ApiError(
      400,
      "invalid_scroll_delta",
      "Scroll deltas must be non-zero finite pixel values from -2400 to 2400.",
    );
  }
  const { x, y } = await viewportPoint(cdp, xRatio, yRatio);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x,
    y,
    deltaX,
    deltaY,
  });
}

export async function selectElementRepresentation(
  cdp: BrowserToolCdpClient,
  backendNodeId: number,
  representation: BrowserElementRepresentation,
): Promise<BrowserElementSelection> {
  if (representation === "selector") {
    return {
      representation,
      selector: await selectedElementSelector(cdp, backendNodeId),
      html: null,
      mediaType: null,
      base64: null,
      byteLength: null,
    };
  }
  if (representation === "html") {
    return {
      representation,
      selector: null,
      html: await selectedElementHtml(cdp, backendNodeId),
      mediaType: null,
      base64: null,
      byteLength: null,
    };
  }
  if (representation !== "png") {
    throw new ApiError(
      400,
      "invalid_element_representation",
      "Element representation must be selector, html, or png.",
    );
  }
  const screenshot = await selectedElementScreenshot(cdp, backendNodeId);
  return {
    representation,
    selector: null,
    html: null,
    mediaType: screenshot.mediaType,
    base64: screenshot.base64,
    byteLength: screenshot.byteLength,
  };
}

function boxCenter(value: unknown): { readonly x: number; readonly y: number } {
  const content = record(record(value)?.model)?.content;
  if (!Array.isArray(content) || content.length !== 8) {
    throw new ApiError(409, "element_not_visible", "The referenced element is not visible.");
  }
  const coordinates = content.map(finiteNumber);
  if (coordinates.some((coordinate) => coordinate === null)) {
    throw new ApiError(409, "element_not_visible", "The referenced element has no usable bounds.");
  }
  const numeric = coordinates.filter((coordinate): coordinate is number => coordinate !== null);
  const xs = numeric.filter((_, index) => index % 2 === 0);
  const ys = numeric.filter((_, index) => index % 2 === 1);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

export async function clickElement(
  cdp: BrowserToolCdpClient,
  backendNodeId: number,
): Promise<void> {
  await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
  const center = boxCenter(await cdp.send("DOM.getBoxModel", { backendNodeId }));
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: center.x,
    y: center.y,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    x: center.x,
    y: center.y,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    x: center.x,
    y: center.y,
  });
}

function attributes(value: unknown): ReadonlyMap<string, string> {
  const values = record(record(value)?.node)?.attributes;
  const result = new Map<string, string>();
  if (!Array.isArray(values)) return result;
  for (let index = 0; index + 1 < values.length; index += 2) {
    const name = values[index];
    const item = values[index + 1];
    if (typeof name === "string" && typeof item === "string") {
      result.set(name.toLowerCase(), item);
    }
  }
  return result;
}

function editableNode(value: unknown): {
  readonly objectId: string;
  readonly contentEditable: boolean;
} {
  const description = record(value);
  const node = record(description?.node);
  const nodeName = typeof node?.nodeName === "string" ? node.nodeName.toUpperCase() : "";
  const nodeAttributes = attributes(value);
  const contentEditable = nodeAttributes.get("contenteditable") === "true";
  const inputType = (nodeAttributes.get("type") ?? "text").toLowerCase();
  const credentialHints = [
    inputType,
    nodeAttributes.get("name") ?? "",
    nodeAttributes.get("id") ?? "",
    nodeAttributes.get("autocomplete") ?? "",
    nodeAttributes.get("aria-label") ?? "",
  ].join(" ");
  if (inputType === "password" || CREDENTIAL_FIELD.test(credentialHints)) {
    throw new ApiError(
      403,
      "credential_input_denied",
      "Remote Browser does not fill password or credential fields.",
    );
  }
  if (nodeName !== "INPUT" && nodeName !== "TEXTAREA" && !contentEditable) {
    throw new ApiError(409, "element_not_editable", "The referenced element is not editable.");
  }
  const objectId = record(description?.object)?.objectId;
  if (typeof objectId !== "string" || !objectId) {
    throw new ApiError(502, "invalid_cdp_result", "The browser could not resolve the input element.");
  }
  return { objectId, contentEditable };
}

const SET_ELEMENT_VALUE = `function(value, contentEditable) {
  if (contentEditable) {
    this.textContent = value;
  } else {
    const prototype = this instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (!descriptor || typeof descriptor.set !== "function") {
      throw new Error("No native value setter");
    }
    descriptor.set.call(this, value);
  }
  this.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
}`;

export async function fillElement(
  cdp: BrowserToolCdpClient,
  backendNodeId: number,
  value: string,
): Promise<void> {
  if (value.length > MAX_FILL_LENGTH) {
    throw new ApiError(400, "fill_too_large", "Input text exceeds the Remote Browser limit.");
  }
  const described = await cdp.send("DOM.describeNode", { backendNodeId, depth: 0 });
  const resolved = await cdp.send("DOM.resolveNode", { backendNodeId });
  const node = record(described);
  const object = record(resolved)?.object;
  const editability = editableNode({ node: node?.node, object });
  await cdp.send("DOM.focus", { backendNodeId });
  await cdp.send("Runtime.callFunctionOn", {
    objectId: editability.objectId,
    functionDeclaration: SET_ELEMENT_VALUE,
    arguments: [
      { value },
      { value: editability.contentEditable },
    ],
    awaitPromise: false,
    returnByValue: true,
    userGesture: true,
  });
}

export function sanitizedNetworkUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 16_384) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname
    .split("/")
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return "[REDACTED]";
      }
      return SENSITIVE_PATH_SEGMENT.test(decoded) || HIGH_ENTROPY_PATH_SEGMENT.test(decoded)
        ? "[REDACTED]"
        : segment;
    })
    .join("/");
  return url.toString().slice(0, 2_048);
}

function cdpTimestamp(value: unknown, fallback: number): number {
  const seconds = finiteNumber(value);
  return seconds === null ? fallback : Math.max(0, Math.floor(seconds * 1_000));
}

export function networkUpdateFromCdpEvent(
  method: string,
  paramsValue: unknown,
  receivedAt: number,
): NetworkRequestUpdate | null {
  const params = record(paramsValue);
  const requestId = params?.requestId;
  if (typeof requestId !== "string" || !requestId || requestId.length > 256) return null;
  if (method === "Network.requestWillBeSent") {
    const request = record(params.request);
    const requestMethod = boundedText(request?.method, 32);
    return {
      requestId,
      method: requestMethod,
      url: sanitizedNetworkUrl(request?.url),
      resourceType: boundedText(params.type, 64),
      status: null,
      failed: false,
      errorText: null,
      startedAt: cdpTimestamp(params.timestamp, receivedAt),
      finishedAt: null,
    };
  }
  if (method === "Network.responseReceived") {
    const response = record(params.response);
    return {
      requestId,
      method: null,
      url: sanitizedNetworkUrl(response?.url),
      resourceType: boundedText(params.type, 64),
      status: finiteNumber(response?.status),
      failed: null,
      errorText: null,
      startedAt: null,
      finishedAt: null,
    };
  }
  if (method === "Network.loadingFinished") {
    return {
      requestId,
      method: null,
      url: null,
      resourceType: null,
      status: null,
      failed: false,
      errorText: null,
      startedAt: null,
      finishedAt: cdpTimestamp(params.timestamp, receivedAt),
    };
  }
  if (method === "Network.loadingFailed") {
    return {
      requestId,
      method: null,
      url: null,
      resourceType: boundedText(params.type, 64),
      status: null,
      failed: true,
      errorText: boundedText(params.errorText, 500) ?? "Network request failed",
      startedAt: null,
      finishedAt: cdpTimestamp(params.timestamp, receivedAt),
    };
  }
  return null;
}

function remoteObjectText(value: unknown): string | null {
  const object = record(value);
  const direct = boundedText(object?.value, 500);
  if (direct !== null) return direct;
  return boundedText(object?.description, 500);
}

function exceptionText(value: unknown): string | null {
  const details = record(value);
  return (
    remoteObjectText(details?.exception) ??
    boundedText(details?.text, 1_000)
  );
}

export function diagnosticFromCdpEvent(
  method: string,
  paramsValue: unknown,
  receivedAt: number,
): BrowserDiagnosticCandidate | null {
  const params = record(paramsValue);
  if (!params) return null;
  if (method === "Runtime.exceptionThrown") {
    const details = record(params.exceptionDetails);
    return {
      kind: "exception",
      severity: "error",
      message: exceptionText(details) ?? "Page JavaScript exception",
      source: boundedText(details?.url, 500),
      occurredAt: receivedAt,
    };
  }
  if (method === "Runtime.consoleAPICalled") {
    const level = params.type;
    if (level !== "error" && level !== "warning" && level !== "assert") return null;
    const args = Array.isArray(params.args)
      ? params.args.map(remoteObjectText).filter((item): item is string => item !== null)
      : [];
    return {
      kind: "console",
      severity: level === "warning" ? "warning" : "error",
      message: (args.join(" ") || `Console ${level}`).slice(0, 2_000),
      source: null,
      occurredAt: receivedAt,
    };
  }
  if (method === "Log.entryAdded") {
    const entry = record(params.entry);
    if (!entry) return null;
    const level = entry?.level;
    if (level !== "error" && level !== "warning") return null;
    return {
      kind: "console",
      severity: level,
      message: boundedText(entry.text, 2_000) ?? `Browser log ${level}`,
      source: boundedText(entry.source, 128),
      occurredAt: receivedAt,
    };
  }
  if (method === "Network.loadingFailed") {
    return {
      kind: "network",
      severity: "error",
      message: boundedText(params.errorText, 1_000) ?? "Network request failed",
      source: boundedText(params.type, 128),
      occurredAt: receivedAt,
    };
  }
  if (method === "Network.responseReceived") {
    const response = record(params.response);
    const status = finiteNumber(response?.status);
    if (status === null || status < 400) return null;
    const url = sanitizedNetworkUrl(response?.url);
    return {
      kind: "http",
      severity: "error",
      message: `HTTP ${status}${url ? ` from ${url}` : ""}`.slice(0, 2_000),
      source: boundedText(params.type, 128),
      occurredAt: receivedAt,
    };
  }
  return null;
}
