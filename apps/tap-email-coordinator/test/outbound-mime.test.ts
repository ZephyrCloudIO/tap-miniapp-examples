import { Buffer } from 'node:buffer';
import PostalMime from 'postal-mime';
import { describe, expect, it } from 'vitest';
import { addSentWithFooter, alternativeBody, plainTextHtml } from '../src/outbound-mime';

const url = `https://theaiplatform.app/refer/${'a'.repeat(32)}?utm_source=tap_email&utm_medium=email&utm_campaign=sent_with&utm_content=signature`;
const footer = 'Sent with TAP Email on The AI Platform';
const encode = (raw: string) => Buffer.from(raw).toString('base64url');
const decode = (raw: string) => Buffer.from(raw, 'base64url');
const parse = (raw: string) => PostalMime.parse(decode(raw));

describe('outbound HTML and send-only footer', () => {
  it('makes HTML the preferred alternative and escapes authored text without adding a footer', async () => {
    const raw = encode('Content-Type: multipart/alternative; boundary="body"\r\n\r\n' +
      alternativeBody('Hello <script>alert("x")</script> & friends\n\nZack 📨', 'body'));
    const message = await parse(raw);
    expect(message.text).toContain('Zack 📨');
    expect(message.html).toContain('&lt;script&gt;');
    expect(message.html).not.toContain('<script>');
    expect(message.html).not.toContain(footer);
    expect(decode(raw).toString().indexOf('text/html')).toBeGreaterThan(decode(raw).toString().indexOf('text/plain'));
  });

  it('adds one linked footer after the signature to both alternatives', async () => {
    const original = encode('Message-ID: <draft@tap-email.local>\r\nContent-Type: multipart/alternative; boundary="body"\r\n\r\n' +
      alternativeBody('Hello!\n\nZack', 'body'));
    const final = addSentWithFooter(original, url);
    const parsed = await parse(final);
    expect(parsed.messageId).toBe('<draft@tap-email.local>');
    expect(parsed.text).toContain(`Zack\r\n\r\n${footer}: ${url}`);
    expect(parsed.html).toContain('Sent with TAP Email on <a href="https://theaiplatform.app/refer/');
    expect(parsed.html).toContain('">The AI Platform</a>');
    expect(addSentWithFooter(final, url)).toBe(final);
    expect((await parse(original)).text).not.toContain(footer);
  });

  it('upgrades an existing plain-text provider draft, preserving its edits and threading', async () => {
    const raw = encode('To: friend@example.com\r\nSubject: Re: Launch\r\nIn-Reply-To: <old@example.com>\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nEdited in Gmail\r\n\r\nZack');
    const parsed = await parse(addSentWithFooter(raw, url));
    expect(parsed.inReplyTo).toBe('<old@example.com>');
    expect(parsed.text).toContain('Edited in Gmail');
    expect(parsed.html).toContain('Edited in Gmail');
    expect(parsed.subject).toBe('Re: Launch');
  });

  it('upgrades a provider multipart alternative that only has plain text', async () => {
    const raw = encode('Content-Type: multipart/alternative; boundary="plain"\r\n\r\n--plain\r\nContent-Type: text/plain\r\n\r\nHello\r\n--plain--\r\n');
    const parsed = await parse(addSentWithFooter(raw, url));
    expect(parsed.text).toContain(footer);
    expect(parsed.html).toContain('The AI Platform</a>');
  });

  it('preserves attachment bytes, filenames and MIME framing', async () => {
    const attachment = 'Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="report.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\nAAEC//79';
    const raw = encode('Content-Type: multipart/mixed; boundary="mixed"\r\n\r\nPreamble\r\n--mixed\r\nContent-Type: multipart/alternative; boundary="body"\r\n\r\n' +
      alternativeBody('Attached.\n\nZack', 'body') + '\r\n--mixed\r\n' + attachment + '\r\n--mixed--\r\nEpilogue');
    const final = addSentWithFooter(raw, url);
    expect(decode(final).toString()).toContain(attachment);
    expect(decode(final).toString()).toContain('Epilogue');
    const parsed = await parse(final);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]?.filename).toBe('report.bin');
    expect(new Uint8Array(parsed.attachments[0]!.content as ArrayBuffer)).toEqual(new Uint8Array([0, 1, 2, 255, 254, 253]));
    expect(parsed.html).toContain('The AI Platform</a>');
  });

  it('preserves inline resources and converts quoted-printable HTML without rewriting old footers', async () => {
    const raw = encode('Content-Type: multipart/related; boundary="related"; start="<body>"\r\n\r\n--related\r\nContent-Type: image/png\r\nContent-ID: <image>\r\nContent-Transfer-Encoding: base64\r\n\r\nAQID\r\n--related\r\nContent-Type: text/html; charset=iso-8859-1\r\nContent-ID: <body>\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<html><body><p>Caf=E9</p><img src=3D"cid:image"><blockquote>Sent with TAP Email on The AI Platform</blockquote><p>Zack</p></body></html>\r\n--related--\r\n');
    const parsed = await parse(addSentWithFooter(raw, url));
    expect(parsed.html).toContain('Café');
    expect(parsed.html).toContain('<blockquote>Sent with TAP Email on The AI Platform</blockquote>');
    expect(parsed.html).toContain('The AI Platform</a></div></body>');
    expect(parsed.attachments[0]?.contentId).toBe('<image>');
  });

  it('does not modify an attached email or plain-text attachment', async () => {
    const attached = 'Content-Type: message/rfc822\r\nContent-Disposition: attachment\r\n\r\nSubject: Attached email\r\nContent-Type: text/plain\r\n\r\nKeep me';
    const raw = encode(`Content-Type: multipart/mixed; boundary="mixed"\r\n\r\n--mixed\r\nContent-Type: text/plain\r\n\r\nHello\r\n--mixed\r\n${attached}\r\n--mixed--\r\n`);
    expect(decode(addSentWithFooter(raw, url)).toString()).toContain(attached);
  });

  it('fails without mutating ambiguous, signed, encrypted or unsupported message bodies', () => {
    for (const type of ['multipart/signed', 'multipart/encrypted', 'application/pkcs7-mime', 'multipart/mixed; boundary="missing"']) {
      expect(() => addSentWithFooter(encode(`Content-Type: ${type}\r\n\r\nbody`), url)).toThrow();
    }
    expect(() => addSentWithFooter(encode('Content-Type: text/plain\r\nContent-Type: text/html\r\n\r\nbody'), url)).toThrow();
    expect(() => addSentWithFooter(encode('Content-Type: text/plain\r\n\r\nbody'), 'https://evil.example/refer/a')).toThrow();
  });

  it('normalizes text newlines and preserves visual whitespace', () => {
    expect(plainTextHtml('A\r\nB\rC')).toBe('<div style="white-space:pre-wrap">A\nB\nC</div>');
  });
});
