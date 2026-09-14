import createDOMPurify, { type Config } from 'dompurify';
import type { MiniAppTheme } from '@theaiplatform/miniapp-sdk/web';
import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  bridgeRichMessageKeyboardScroll,
  bridgeRichMessageWheel,
} from './iframe-scroll';
import { watchRichMessageLayout } from './iframe-layout';

const allowedTags = [
  'a',
  'abbr',
  'address',
  'article',
  'b',
  'blockquote',
  'body',
  'br',
  'caption',
  'center',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'font',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hr',
  'html',
  'i',
  'img',
  'li',
  'main',
  'mark',
  'ol',
  'p',
  'pre',
  's',
  'section',
  'small',
  'span',
  'strong',
  'style',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
  'wbr',
] as const;

const allowedAttributes = [
  'align',
  'alt',
  'bgcolor',
  'border',
  'cellpadding',
  'cellspacing',
  'class',
  'color',
  'colspan',
  'dir',
  'face',
  'height',
  'id',
  'lang',
  'loading',
  'nowrap',
  'open',
  'reversed',
  'role',
  'rowspan',
  'scope',
  'size',
  'span',
  'src',
  'start',
  'style',
  'summary',
  'title',
  'type',
  'valign',
  'width',
] as const;

// DOMPurify applies its URL check to every allowed attribute unless the
// attribute is explicitly classified as non-URL data. Email templates still
// lean heavily on these presentational attributes (especially table width and
// alignment); merely adding them to ALLOWED_ATTR is not enough. None of these
// attributes can initiate a request or navigation, so retaining them restores
// the sender's layout without broadening the frame's network surface.
const safePresentationAttributes = [
  'align',
  'bgcolor',
  'border',
  'cellpadding',
  'cellspacing',
  'color',
  'colspan',
  'dir',
  'face',
  'height',
  'lang',
  'loading',
  'nowrap',
  'open',
  'reversed',
  'rowspan',
  'scope',
  'size',
  'span',
  'start',
  'type',
  'valign',
  'width',
] as const;

const safeInlineImage = /^data:image\/(?:avif|gif|jpe?g|png|webp);base64,[a-z0-9+/]+={0,2}$/iu;
const cssComment = /\/\*[\s\S]*?\*\//gu;
const cssImport = /@import\s+(?:url\s*\([^)]*\)|"[^"]*"|'[^']*'|[^;])*;?/giu;
const cssUrl = /url\s*\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/giu;
const cssExpression = /expression\s*\([^)]*\)/giu;
const cssExecutableProperty = /(^|[;{])\s*(?:-moz-binding|behavior)\s*:[^;}]*;?/giu;
const cssRule = /([^{}]+)\{([^{}]*)\}/gu;
const cssHiddenPaint = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:collapse|hidden)|opacity\s*:\s*0(?:\.0+)?)\s*(?:!important\s*)?(?:;|$)/iu;
const knownQuotedContentClasses = [
  'gmail_extra',
  'gmail_quote',
  'protonmail_quote',
  'yahoo_quoted',
] as const;

const purifier = createDOMPurify(window);
const purifierConfig: Config = {
  ADD_URI_SAFE_ATTR: [...safePresentationAttributes],
  ALLOWED_ATTR: [...allowedAttributes],
  ALLOWED_TAGS: [...allowedTags],
  ALLOWED_URI_REGEXP: safeInlineImage,
  ALLOW_ARIA_ATTR: true,
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  FORBID_ATTR: [
    'action',
    'formaction',
    'href',
    'ping',
    'poster',
    'srcdoc',
    'srcset',
    'xlink:href',
  ],
  FORBID_TAGS: [
    'applet',
    'audio',
    'base',
    'button',
    'embed',
    'form',
    'frame',
    'frameset',
    'iframe',
    'input',
    'link',
    'math',
    'meta',
    'object',
    'script',
    'select',
    'source',
    'svg',
    'textarea',
    'video',
  ],
  PARSER_MEDIA_TYPE: 'text/html',
  RETURN_TRUSTED_TYPE: false,
  SAFE_FOR_XML: true,
  SANITIZE_DOM: true,
  SANITIZE_NAMED_PROPS: true,
  WHOLE_DOCUMENT: true,
};

export const richMessageContentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "media-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "navigate-to 'none'",
].join('; ');

const isolatedDocumentStyles = `
:root {
  color-scheme: light;
  --tap-message-canvas: #fff;
  --tap-message-copy: #171817;
  --tap-message-muted: #62645f;
  --tap-message-link: #1769aa;
  --tap-message-quote-border: #d8d9d5;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --tap-message-canvas: #1a1c1a;
  --tap-message-copy: #e7e5df;
  --tap-message-muted: #a6aaa2;
  --tap-message-link: #78b8e6;
  --tap-message-quote-border: #4b4e48;
}
:root[data-tap-presentation="authored"] {
  color-scheme: light;
  --tap-message-canvas: #fff;
  --tap-message-copy: #171817;
}
html, body { box-sizing: border-box; margin: 0; min-width: 0; max-width: 100%; }
html { background: var(--tap-message-canvas); }
body {
  width: auto;
  overflow: auto;
  margin: 0;
  padding: 0;
}
body[data-tap-presentation="authored"] {
  color-scheme: light;
}
body[data-tap-presentation="adaptive"] {
  background: var(--tap-message-canvas) !important;
  color: var(--tap-message-copy) !important;
  overflow-wrap: anywhere;
  font: 400 15px/1.68 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
body[data-tap-presentation="adaptive"] * {
  background-color: transparent !important;
  background-image: none !important;
  color: inherit !important;
  -webkit-text-fill-color: currentColor !important;
}
body[data-tap-presentation="adaptive"] a {
  color: var(--tap-message-link) !important;
  -webkit-text-fill-color: currentColor !important;
}
body[data-tap-presentation="adaptive"] blockquote {
  margin-inline: 0;
  padding-inline-start: 18px;
  border-inline-start: 2px solid var(--tap-message-quote-border);
  color: var(--tap-message-muted) !important;
}
body[data-tap-presentation="adaptive"] pre {
  max-width: 100%;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
table { max-width: 100%; }
img { max-width: 100% !important; }
img[width][height] { height: auto !important; }
img[data-tap-image-blocked] { display: none !important; }
html:not([data-tap-show-quoted="true"]) [data-tap-quoted] { display: none !important; }
a:not([href]) { cursor: default; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;

export type RichMessagePresentation = 'adaptive' | 'authored';

function isRootResetSelector(value: string): boolean {
  return value
    .split(',')
    .map(selector => selector.trim().toLowerCase())
    .every(selector => selector === '*' || selector === ':root' || selector === 'html' || selector === 'body');
}

function visualStyleEvidence(value: string): number {
  let evidence = 0;
  if (/(?:^|;)\s*background(?:-color|-image)?\s*:\s*(?!transparent\b|none\b|inherit\b|initial\b|unset\b)[^;}]+/iu.test(value)) {
    evidence += 1;
  }
  if (/(?:^|;)\s*(?:border-radius|box-shadow)\s*:\s*(?!none\b|0(?:px)?\b)[^;}]+/iu.test(value)) {
    evidence += 1;
  }
  if (/(?:^|;)\s*(?:max-width|min-width|width)\s*:\s*(?:[4-9]\d{2}|\d{4,})px\b/iu.test(value)) {
    evidence += 1;
  }
  return evidence;
}

function authoredStyleEvidence(document: Document): number {
  let evidence = 0;
  for (const style of document.querySelectorAll('style')) {
    const css = (style.textContent ?? '').replace(cssComment, '');
    for (const match of css.matchAll(cssRule)) {
      if (isRootResetSelector(match[1] ?? '')) continue;
      const visualEvidence = visualStyleEvidence(match[2] ?? '');
      if (visualEvidence > 0) evidence += visualEvidence > 1 ? 3 : 2;
      if (evidence >= 5) return evidence;
    }
  }
  for (const element of document.querySelectorAll<HTMLElement>('[style]')) {
    if (element.matches('html, body')) continue;
    const visualEvidence = visualStyleEvidence(element.getAttribute('style') ?? '');
    if (visualEvidence > 0) evidence += visualEvidence > 1 ? 3 : 2;
    if (evidence >= 5) return evidence;
  }
  return evidence;
}

function visibleImageEvidence(document: Document): number {
  let visibleImages = 0;
  let hasLargeImage = false;
  const hiddenSelectors = cssHiddenSelectors(document);
  for (const image of document.querySelectorAll('img')) {
    if (isLikelyTrackingImageWithSelectors(image, hiddenSelectors)) continue;
    visibleImages += 1;
    const style = image.getAttribute('style') ?? '';
    const width = numericDimension(image.getAttribute('width')) ?? styleDimension(style, 'width');
    const height = numericDimension(image.getAttribute('height')) ?? styleDimension(style, 'height');
    if ((width !== null && width >= 320) || (height !== null && height >= 180)) {
      hasLargeImage = true;
    }
  }
  // A single small or unmeasured image is commonly just a signature logo.
  return (hasLargeImage ? 3 : 0) + (visibleImages >= 2 ? 2 : 0);
}

function layoutTableEvidence(document: Document): number {
  const tables = [...document.querySelectorAll('table')];
  return tables.length > 0 ? 3 : 0;
}

function callToActionEvidence(document: Document): number {
  for (const anchor of document.querySelectorAll<HTMLElement>('a')) {
    const style = anchor.getAttribute('style') ?? '';
    if (/(?:^|;)\s*(?:background(?:-color)?|border-radius)\s*:/iu.test(style)) {
      return 1;
    }
  }
  return 0;
}

/**
 * Keep sender-authored visual canvases intact, while allowing ordinary prose
 * mail (including quoted conversations) to follow the host appearance.
 */
export function richMessagePresentation(value: string): RichMessagePresentation {
  const parsed = createSanitizedDocument(value);
  for (const quotedRoot of knownQuotedContentRoots(parsed)) quotedRoot.remove();
  const evidence = authoredStyleEvidence(parsed)
    + visibleImageEvidence(parsed)
    + layoutTableEvidence(parsed)
    // Background paint supports an authored classification, but cannot turn a
    // signature's lone layout table into a forced light canvas on its own.
    + (parsed.querySelector('table [bgcolor], table[bgcolor]') ? 1 : 0)
    + callToActionEvidence(parsed);
  return evidence >= 5 ? 'authored' : 'adaptive';
}

export function sanitizeRichMessageCss(value: string): string {
  const withoutExecutableProperties = value
    .replace(cssComment, '')
    .replace(cssImport, '')
    .replace(cssExpression, 'none')
    .replace(cssExecutableProperty, '$1');
  return withoutExecutableProperties.replace(cssUrl, match => {
    const rawValue = match
      .slice(match.indexOf('(') + 1, -1)
      .trim()
      .replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, '$1$2');
    return safeInlineImage.test(rawValue) ? `url("${rawValue}")` : 'none';
  });
}

function absoluteRemoteImageUrl(value: string): string | null {
  if (!value || value.length > 4_096) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      (parsed.port && parsed.port !== '443')
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function numericDimension(value: string | null): number | null {
  if (!value) return null;
  const match = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/iu.exec(value);
  if (!match?.[1]) return null;
  const dimension = Number(match[1]);
  return Number.isFinite(dimension) ? dimension : null;
}

function styleDimension(style: string, property: 'height' | 'width'): number | null {
  const match = new RegExp(
    `(?:^|;)\\s*${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)(?:px)?(?:\\s*!important)?\\s*(?:;|$)`,
    'iu',
  ).exec(style);
  return numericDimension(match?.[1] ?? null);
}

export function isLikelyTrackingImage(image: Element): boolean {
  return isLikelyTrackingImageWithSelectors(
    image,
    cssHiddenSelectors(image.ownerDocument),
  );
}

function elementIsHidden(
  element: Element,
  hiddenSelectors: readonly string[],
): boolean {
  const style = element.getAttribute('style') ?? '';
  if (
    element.hasAttribute('hidden') ||
    /(?:^|;)\s*display\s*:\s*none(?:\s*!important)?\s*(?:;|$)/iu.test(style) ||
    /(?:^|;)\s*visibility\s*:\s*(?:collapse|hidden)(?:\s*!important)?\s*(?:;|$)/iu.test(style) ||
    /(?:^|;)\s*opacity\s*:\s*0(?:\.0+)?(?:\s*!important)?\s*(?:;|$)/iu.test(style)
  ) {
    return true;
  }
  return hiddenSelectors.some(selector => {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  });
}

function cssHiddenSelectors(document: Document): readonly string[] {
  const selectors = new Set<string>();
  for (const style of document.querySelectorAll('style')) {
    const css = sanitizeRichMessageCss(style.textContent ?? '');
    for (const match of css.matchAll(cssRule)) {
      if (!cssHiddenPaint.test(match[2] ?? '')) continue;
      const selector = (match[1] ?? '').trim();
      if (selector && !selector.startsWith('@')) selectors.add(selector);
    }
  }
  return [...selectors];
}

function isLikelyTrackingImageWithSelectors(
  image: Element,
  hiddenSelectors: readonly string[],
): boolean {
  let current: Element | null = image;
  while (current) {
    if (elementIsHidden(current, hiddenSelectors)) return true;
    current = current.parentElement;
  }
  const style = image.getAttribute('style') ?? '';
  const width = numericDimension(image.getAttribute('width')) ?? styleDimension(style, 'width');
  const height = numericDimension(image.getAttribute('height')) ?? styleDimension(style, 'height');
  return width !== null && height !== null && width <= 2 && height <= 2;
}

export function extractRemoteImageUrls(
  value: string,
  includeTrackingPixels = false,
  includeQuotedContent = true,
): readonly string[] {
  const parsed = new DOMParser().parseFromString(value, 'text/html');
  const hiddenSelectors = includeTrackingPixels ? [] : cssHiddenSelectors(parsed);
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const image of parsed.querySelectorAll('img[src]')) {
    if (!includeQuotedContent && hasKnownQuotedContentAncestor(image)) continue;
    if (
      !includeTrackingPixels &&
      isLikelyTrackingImageWithSelectors(image, hiddenSelectors)
    ) {
      continue;
    }
    const source = absoluteRemoteImageUrl(image.getAttribute('src') ?? '');
    if (!source || seen.has(source)) continue;
    seen.add(source);
    urls.push(source);
  }
  return urls;
}

function isKnownQuotedContentElement(element: Element): boolean {
  return knownQuotedContentClasses.some(className => element.classList.contains(className)) ||
    (
      (element.tagName === 'BLOCKQUOTE' || element.tagName === 'DIV') &&
      element.getAttribute('type')?.trim().toLowerCase() === 'cite'
    );
}

function hasKnownQuotedContentAncestor(element: Element): boolean {
  let current = element.parentElement;
  while (current) {
    if (isKnownQuotedContentElement(current)) return true;
    current = current.parentElement;
  }
  return false;
}

function hydrateRemoteImages(
  value: string,
  remoteImages: Readonly<Record<string, string>>,
): string {
  if (Object.keys(remoteImages).length === 0) return value;
  const parsed = new DOMParser().parseFromString(value, 'text/html');
  for (const image of parsed.querySelectorAll('img[src]')) {
    const source = image.getAttribute('src') ?? '';
    const replacement = remoteImages[source];
    if (replacement && safeInlineImage.test(replacement)) {
      image.setAttribute('src', replacement);
    }
  }
  return parsed.documentElement.outerHTML;
}

function createSanitizedDocument(value: string): Document {
  const sanitized = purifier.sanitize(value, purifierConfig);
  const parsed = new DOMParser().parseFromString(String(sanitized), 'text/html');

  for (const style of parsed.querySelectorAll('style')) {
    const safeCss = sanitizeRichMessageCss(style.textContent ?? '');
    if (safeCss.trim()) style.textContent = safeCss;
    else style.remove();
  }
  for (const element of parsed.querySelectorAll<HTMLElement>('[style]')) {
    const safeCss = sanitizeRichMessageCss(element.getAttribute('style') ?? '');
    if (safeCss.trim()) element.setAttribute('style', safeCss);
    else element.removeAttribute('style');
  }
  for (const image of parsed.querySelectorAll('img')) {
    const source = image.getAttribute('src') ?? '';
    if (safeInlineImage.test(source)) continue;
    image.removeAttribute('src');
    image.setAttribute('data-tap-image-blocked', '');
  }
  for (const anchor of parsed.querySelectorAll('a')) {
    anchor.removeAttribute('href');
    anchor.removeAttribute('ping');
    anchor.removeAttribute('target');
    anchor.setAttribute('aria-disabled', 'true');
  }

  return parsed;
}

function knownQuotedContentRoots(document: Document): readonly HTMLElement[] {
  const roots = new Set<HTMLElement>();
  for (const element of document.querySelectorAll<HTMLElement>(
    knownQuotedContentClasses.map(className => `.${className}`).join(', '),
  )) {
    roots.add(element);
  }
  for (const element of document.querySelectorAll<HTMLElement>('blockquote[type], div[type]')) {
    if (isKnownQuotedContentElement(element)) {
      roots.add(element);
    }
  }
  return [...roots].filter(root => !hasKnownQuotedContentAncestor(root));
}

function markKnownQuotedContent(document: Document, showQuotedContent: boolean): boolean {
  const roots = knownQuotedContentRoots(document);
  for (const root of roots) {
    root.setAttribute('data-tap-quoted', '');
    if (!showQuotedContent) root.style.setProperty('display', 'none', 'important');
  }
  return roots.length > 0;
}

/** Detect only provider-defined reply wrappers, after the message has been sanitized. */
export function hasKnownQuotedContent(value: string): boolean {
  return knownQuotedContentRoots(createSanitizedDocument(value)).length > 0;
}

function normalizeAdaptiveAppearance(document: Document): void {
  for (const style of document.querySelectorAll('style')) style.remove();
  for (const element of document.querySelectorAll<HTMLElement>('html, body, body *')) {
    element.removeAttribute('bgcolor');
    element.removeAttribute('color');
    if (!element.hasAttribute('style')) continue;
    const properties = Array.from(
      { length: element.style.length },
      (_, index) => element.style.item(index),
    );
    for (const property of properties) {
      if (
        property === 'all' ||
        property === 'color' ||
        property === 'color-scheme' ||
        property === '-webkit-text-fill-color' ||
        property.startsWith('background')
      ) {
        element.style.removeProperty(property);
      }
    }
    if (!element.style.cssText.trim()) element.removeAttribute('style');
  }
}

export function sanitizeRichMessageHtml(value: string): string {
  return createSanitizedDocument(value).documentElement.outerHTML;
}

export function buildRichMessageDocument(
  value: string,
  remoteImages: Readonly<Record<string, string>> = {},
  options: {
    readonly presentation?: RichMessagePresentation;
    readonly showQuotedContent?: boolean;
    readonly theme?: MiniAppTheme;
  } = {},
): string {
  const parsed = createSanitizedDocument(hydrateRemoteImages(value, remoteImages));
  const presentation = options.presentation ?? richMessagePresentation(value);
  const showQuotedContent = options.showQuotedContent ?? false;
  const theme = options.theme ?? 'light';
  if (presentation === 'adaptive') normalizeAdaptiveAppearance(parsed);
  markKnownQuotedContent(parsed, showQuotedContent);
  const charset = parsed.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  const policy = parsed.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', richMessageContentSecurityPolicy);
  const viewport = parsed.createElement('meta');
  viewport.setAttribute('name', 'viewport');
  viewport.setAttribute('content', 'width=device-width, initial-scale=1');
  const baseStyles = parsed.createElement('style');
  baseStyles.setAttribute('data-tap-message-styles', '');
  baseStyles.textContent = isolatedDocumentStyles;
  parsed.documentElement.dataset.theme = theme;
  parsed.documentElement.dataset.tapPresentation = presentation;
  parsed.documentElement.dataset.tapShowQuoted = String(showQuotedContent);
  parsed.body.dataset.tapPresentation = presentation;
  parsed.head.prepend(charset, policy, viewport);
  parsed.head.append(baseStyles);
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}

const minimumFrameHeight = 140;
const maximumFrameHeight = 12_000;
export const richMessageGutter = 'clamp(16px, 2.4vw, 26px)';

function measuredFrameHeight(frame: HTMLIFrameElement): number {
  const document = frame.contentDocument;
  if (!document) return minimumFrameHeight;
  const height = Math.max(
    document.body?.scrollHeight ?? 0,
    document.documentElement.scrollHeight,
  );
  return Math.min(maximumFrameHeight, Math.max(minimumFrameHeight, height));
}

interface RichMessageBodyProps {
  readonly html: string;
  readonly imagesEnabled?: boolean;
  readonly loadRemoteImages?: (
    urls: readonly string[],
  ) => Promise<Readonly<Record<string, string>>>;
  readonly onKeyDown?: (event: KeyboardEvent) => void;
  readonly theme?: MiniAppTheme;
  readonly title: string;
  readonly trackingPixelsEnabled?: boolean;
}

export function listenForRichMessageKeyDown(
  frame: HTMLIFrameElement,
  listener: (event: KeyboardEvent) => void,
): () => void {
  const document = frame.contentDocument;
  if (!document) return () => undefined;
  document.addEventListener('keydown', listener);
  return () => document.removeEventListener('keydown', listener);
}

export function RichMessageBody({
  html,
  imagesEnabled = false,
  loadRemoteImages,
  onKeyDown,
  theme = 'light',
  title,
  trackingPixelsEnabled = false,
}: RichMessageBodyProps) {
  const frameId = useId();
  const presentation = useMemo(() => richMessagePresentation(html), [html]);
  const hasQuotedContent = useMemo(() => hasKnownQuotedContent(html), [html]);
  const [quoteDisclosure, setQuoteDisclosure] = useState({ html, shown: false });
  const showQuotedContent = quoteDisclosure.html === html && quoteDisclosure.shown;
  const imageUrls = useMemo(
    () => imagesEnabled
      ? extractRemoteImageUrls(html, trackingPixelsEnabled, showQuotedContent)
      : [],
    [html, imagesEnabled, showQuotedContent, trackingPixelsEnabled],
  );
  const [remoteImages, setRemoteImages] = useState<Readonly<Record<string, string>>>({});
  const [imageStatus, setImageStatus] = useState<'idle' | 'loading' | 'partial' | 'error'>('idle');
  const source = useMemo(
    () => buildRichMessageDocument(html, remoteImages, {
      presentation,
      showQuotedContent,
      theme,
    }),
    [html, presentation, remoteImages, showQuotedContent, theme],
  );
  const frameRef = useRef<HTMLIFrameElement>(null);
  const heightUpdateTimerRef = useRef<number | null>(null);
  const removeLayoutListenerRef = useRef<(() => void) | null>(null);
  const removeKeyDownListenerRef = useRef<(() => void) | null>(null);
  const removeKeyboardScrollListenerRef = useRef<(() => void) | null>(null);
  const removeWheelListenerRef = useRef<(() => void) | null>(null);
  const keyDownListenerRef = useRef(onKeyDown);
  const [height, setHeight] = useState(minimumFrameHeight);
  keyDownListenerRef.current = onKeyDown;

  useEffect(() => {
    let active = true;
    setRemoteImages({});
    if (!imagesEnabled || !loadRemoteImages || imageUrls.length === 0) {
      setImageStatus('idle');
      return () => { active = false; };
    }
    setImageStatus('loading');
    void loadRemoteImages(imageUrls).then(
      images => {
        if (!active) return;
        setRemoteImages(images);
        setImageStatus(Object.keys(images).length < imageUrls.length ? 'partial' : 'idle');
      },
      () => {
        if (!active) return;
        setImageStatus('error');
      },
    );
    return () => { active = false; };
  }, [imageUrls, imagesEnabled, loadRemoteImages]);

  const updateHeight = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const nextHeight = measuredFrameHeight(frame);
    setHeight(current => current === nextHeight ? current : nextHeight);
  }, []);

  const scheduleHeightUpdate = useCallback(() => {
    if (heightUpdateTimerRef.current !== null) return;
    heightUpdateTimerRef.current = window.setTimeout(() => {
      heightUpdateTimerRef.current = null;
      updateHeight();
    }, 0);
  }, [updateHeight]);

  const handleLoad = useCallback(() => {
    if (heightUpdateTimerRef.current !== null) {
      window.clearTimeout(heightUpdateTimerRef.current);
      heightUpdateTimerRef.current = null;
    }
    removeLayoutListenerRef.current?.();
    removeLayoutListenerRef.current = null;
    removeKeyDownListenerRef.current?.();
    removeKeyDownListenerRef.current = null;
    removeKeyboardScrollListenerRef.current?.();
    removeKeyboardScrollListenerRef.current = null;
    removeWheelListenerRef.current?.();
    removeWheelListenerRef.current = null;
    const frame = frameRef.current;
    if (frame) {
      removeKeyDownListenerRef.current = listenForRichMessageKeyDown(
        frame,
        event => keyDownListenerRef.current?.(event),
      );
      const reader = frame.closest<HTMLElement>('.message-body');
      removeKeyboardScrollListenerRef.current = bridgeRichMessageKeyboardScroll(frame, reader);
      removeWheelListenerRef.current = bridgeRichMessageWheel(
        frame,
        reader,
      );
    }
    updateHeight();
    if (frame) {
      removeLayoutListenerRef.current = watchRichMessageLayout(
        frame,
        scheduleHeightUpdate,
      );
    }
  }, [scheduleHeightUpdate, updateHeight]);

  useEffect(
    () => () => {
      if (heightUpdateTimerRef.current !== null) {
        window.clearTimeout(heightUpdateTimerRef.current);
      }
      removeLayoutListenerRef.current?.();
      removeKeyDownListenerRef.current?.();
      removeKeyboardScrollListenerRef.current?.();
      removeWheelListenerRef.current?.();
    },
    [],
  );

  return (
    <div
      className="rich-message-shell"
      data-presentation={presentation}
      data-theme={theme}
      style={{ padding: richMessageGutter }}
    >
      <iframe
        className="rich-message-frame"
        data-presentation={presentation}
        data-theme={theme}
        id={frameId}
        onLoad={handleLoad}
        ref={frameRef}
        referrerPolicy="no-referrer"
        sandbox="allow-same-origin"
        srcDoc={source}
        style={{ height }}
        title={title}
      />
      {hasQuotedContent ? (
        <button
          aria-controls={frameId}
          aria-expanded={showQuotedContent}
          className="rich-message-quote-toggle"
          onClick={() => setQuoteDisclosure({ html, shown: !showQuotedContent })}
          type="button"
        >
          {showQuotedContent ? 'Hide quoted text' : 'Show quoted text'}
        </button>
      ) : null}
      {imageStatus === 'loading' ? (
        <p className="remote-image-status" role="status">Loading message images privately…</p>
      ) : imageStatus === 'partial' ? (
        <p className="remote-image-status">Some message images were blocked.</p>
      ) : imageStatus === 'error' ? (
        <p className="remote-image-status" role="alert">Message images could not be loaded.</p>
      ) : null}
    </div>
  );
}
