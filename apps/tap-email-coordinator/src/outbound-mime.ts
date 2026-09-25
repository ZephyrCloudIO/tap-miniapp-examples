import { Buffer } from 'node:buffer';

const maximumMimeBytes = 32 * 1_024 * 1_024;
const footerLabel = 'Sent with TAP Email on The AI Platform';

export class OutboundMimeError extends Error {
  readonly code = 'provider_draft_content_unsupported';
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function plainTextHtml(text: string): string {
  return `<div style="white-space:pre-wrap">${escapeHtml(text.replace(/\r\n?/gu, '\n'))}</div>`;
}

function encodedText(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/gu)?.join('\r\n') ?? '';
}

export function alternativeBody(text: string, boundary: string): string {
  return [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '', encodedText(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '', encodedText(plainTextHtml(text)),
    `--${boundary}--`, '',
  ].join('\r\n');
}

interface Part {
  headers: string[];
  body: string;
}

function parsePart(raw: string): Part {
  const split = raw.indexOf('\r\n\r\n');
  if (split < 0 || split > 65_536) throw new OutboundMimeError('Invalid MIME headers.');
  const headers = raw.slice(0, split).split(/\r\n(?![ \t])/u);
  if (headers.some(header => !/^[!-9;-~]+:/u.test(header))) {
    throw new OutboundMimeError('Invalid MIME header.');
  }
  return { headers, body: raw.slice(split + 4) };
}

function header(part: Part, name: string): string {
  const matches = part.headers.filter(value => value.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  if (matches.length > 1) throw new OutboundMimeError('Ambiguous MIME header.');
  return matches[0]?.slice(name.length + 1).replace(/\r\n[ \t]+/gu, ' ').trim() ?? '';
}

function setHeader(part: Part, name: string, value: string): void {
  part.headers = part.headers.filter(item => !item.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  if (value) part.headers.push(`${name}: ${value}`);
}

function serialize(part: Part): string {
  return `${part.headers.join('\r\n')}\r\n\r\n${part.body}`;
}

function parameter(value: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*(?:"([^"\\r\\n]*)"|([^;\\s]+))`, 'iu').exec(value);
  return match?.[1] ?? match?.[2];
}

function decodeText(part: Part): string {
  const encoding = header(part, 'Content-Transfer-Encoding').toLowerCase();
  let bytes: Uint8Array;
  if (encoding === 'base64') {
    const compact = part.body.replace(/\s/gu, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(compact)) throw new OutboundMimeError('Invalid base64 body.');
    bytes = Buffer.from(compact, 'base64');
    if (Buffer.from(bytes).toString('base64').replace(/=+$/u, '') !== compact.replace(/=+$/u, '')) {
      throw new OutboundMimeError('Invalid base64 body.');
    }
  } else if (encoding === 'quoted-printable') {
    const unfolded = part.body.replace(/=\r\n/gu, '');
    if (/=(?![0-9a-f]{2})/iu.test(unfolded)) throw new OutboundMimeError('Invalid quoted-printable body.');
    bytes = Buffer.from(unfolded.replace(/=([0-9a-f]{2})/giu,
      (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))), 'latin1');
  } else if (encoding === '' || encoding === '7bit' || encoding === '8bit') {
    bytes = Buffer.from(part.body, 'latin1');
  } else {
    throw new OutboundMimeError('Unsupported text encoding.');
  }
  try {
    return new TextDecoder(parameter(header(part, 'Content-Type'), 'charset') ?? 'utf-8', {
      fatal: true, ignoreBOM: false,
    }).decode(bytes);
  } catch {
    throw new OutboundMimeError('Unsupported text charset.');
  }
}

function replaceText(part: Part, type: string, text: string): void {
  setHeader(part, 'Content-Type', `${type}; charset=UTF-8`);
  setHeader(part, 'Content-Transfer-Encoding', 'base64');
  setHeader(part, 'Content-Length', '');
  part.body = encodedText(text);
}

function appendHtmlFooter(html: string, url: string): string {
  const footer = `<div data-tap-sent-with="1" style="margin-top:16px;font-size:12px;color:#666">Sent with TAP Email on <a href="${escapeHtml(url)}">The AI Platform</a></div>`;
  // Preserve the provider's HTML and its own signature. Do not rewrite quoted
  // messages or remove historical footers based on their visible text.
  const closingBody = /<\/body\s*>/iu.exec(html);
  return closingBody
    ? `${html.slice(0, closingBody.index)}${footer}${html.slice(closingBody.index)}`
    : html + footer;
}

/**
 * Transform only the message body branch. Attachments, related resources,
 * message/rfc822 forwards, headers, preambles and epilogues remain byte-exact.
 * Reject signed/encrypted or ambiguous bodies instead of damaging them.
 */
function decorate(part: Part, url: string, depth = 0, inAlternative = false): boolean {
  if (depth > 12) throw new OutboundMimeError('MIME nesting exceeds the supported limit.');
  const contentType = header(part, 'Content-Type') || 'text/plain';
  const type = contentType.split(';', 1)[0]!.trim().toLowerCase();
  if (/^attachment(?:;|$)/iu.test(header(part, 'Content-Disposition'))) return false;
  if (type === 'multipart/signed' || type === 'multipart/encrypted') {
    throw new OutboundMimeError('Signed or encrypted drafts cannot be decorated.');
  }
  if (type.startsWith('multipart/')) {
    if (!['multipart/mixed', 'multipart/related', 'multipart/alternative'].includes(type)) {
      throw new OutboundMimeError('Unsupported multipart body.');
    }
    const boundary = parameter(contentType, 'boundary');
    if (!boundary || boundary.length > 200) throw new OutboundMimeError('Invalid MIME boundary.');
    const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const pattern = new RegExp(`(?:^|\\r\\n)--${escaped}(--)?[ \\t]*(?:\\r\\n|$)`, 'gu');
    const markers = [...part.body.matchAll(pattern)];
    if (markers.length < 2 || markers.length > 100 || !markers.at(-1)?.[1] ||
        markers.slice(0, -1).some(marker => marker[1])) {
      throw new OutboundMimeError('Invalid multipart framing.');
    }
    const children = markers.slice(0, -1).map((marker, index) => {
      const start = marker.index! + marker[0].length;
      const end = markers[index + 1]!.index!;
      return { start, end, part: parsePart(part.body.slice(start, end)) };
    });
    const relatedStart = parameter(contentType, 'start');
    const selected = type === 'multipart/related' && relatedStart
      ? children.findIndex(child => header(child.part, 'Content-ID') === relatedStart)
      : 0;
    if (selected < 0) throw new OutboundMimeError('Missing related root.');
    const hasHtmlAlternative = children.some(child =>
      /^(?:text\/html|multipart\/related)(?:;|$)/iu.test(header(child.part, 'Content-Type')),
    );
    let changed = false;
    // Replace backwards so offsets into the original MIME remain valid.
    for (let index = children.length - 1; index >= 0; index -= 1) {
      if (type !== 'multipart/alternative' && index !== selected) continue;
      const child = children[index]!;
      if (decorate(child.part, url, depth + 1, type === 'multipart/alternative' && hasHtmlAlternative)) {
        part.body = part.body.slice(0, child.start) + serialize(child.part) + part.body.slice(child.end);
        changed = true;
      }
    }
    return changed;
  }
  if (type !== 'text/plain' && type !== 'text/html') return false;
  const text = decodeText(part);
  if (type === 'text/html') {
    replaceText(part, type, appendHtmlFooter(text, url));
  } else if (inAlternative) {
    replaceText(part, type, `${text.trimEnd()}\r\n\r\n${footerLabel}: ${url}`);
  } else {
    const boundary = `tap_alternative_${crypto.randomUUID()}`;
    setHeader(part, 'Content-Type', `multipart/alternative; boundary="${boundary}"`);
    setHeader(part, 'Content-Transfer-Encoding', '');
    part.body = alternativeBody(text, boundary);
    return decorate(part, url, depth + 1);
  }
  return true;
}

export function addSentWithFooter(raw: string, url: string): string {
  if (!/^https:\/\/theaiplatform\.app\/refer\/[a-f0-9]{32}\?/u.test(url) || url.length > 2_048) {
    throw new OutboundMimeError('Invalid referral URL.');
  }
  if (raw.length > Math.ceil(maximumMimeBytes * 4 / 3) || !/^[A-Za-z0-9_-]+={0,2}$/u.test(raw)) {
    throw new OutboundMimeError('Invalid or oversized draft.');
  }
  const bytes = Buffer.from(raw, 'base64url');
  if (bytes.byteLength > maximumMimeBytes || bytes.toString('base64url') !== raw.replace(/=+$/u, '')) {
    throw new OutboundMimeError('Invalid or oversized draft.');
  }
  const part = parsePart(bytes.toString('latin1'));
  const existing = header(part, 'X-TAP-Sent-With');
  if (existing) {
    if (existing !== url) throw new OutboundMimeError('Draft already has different attribution.');
    return raw;
  }
  if (!decorate(part, url)) throw new OutboundMimeError('No supported message body.');
  setHeader(part, 'X-TAP-Sent-With', url);
  setHeader(part, 'Content-Length', '');
  return Buffer.from(serialize(part), 'latin1').toString('base64url');
}
