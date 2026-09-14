/** @rstest-environment jsdom */

import { describe, expect, it } from '@rstest/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildRichMessageDocument,
  extractRemoteImageUrls,
  hasKnownQuotedContent,
  isLikelyTrackingImage,
  listenForRichMessageKeyDown,
  RichMessageBody,
  richMessageGutter,
  richMessagePresentation,
  richMessageContentSecurityPolicy,
  sanitizeRichMessageCss,
  sanitizeRichMessageHtml,
} from './rich-message';

function parse(value: string): Document {
  return new DOMParser().parseFromString(value, 'text/html');
}

describe('TAP Email rich-message isolation', () => {
  it('preserves static email layout while removing active content and remote loads', () => {
    const sanitized = parse(sanitizeRichMessageHtml(`
      <!doctype html>
      <html>
        <head>
          <base href="https://attacker.example/">
          <meta http-equiv="refresh" content="0; url=https://attacker.example/">
          <link rel="stylesheet" href="https://attacker.example/mail.css">
          <style>
            @import url("https://attacker.example/import.css");
            .card { width: 620px; color: #171817; background: url(https://attacker.example/bg.png); }
            .legacy { width: expression(alert(1)); behavior: url(evil.htc); }
          </style>
        </head>
        <body style="margin: 0; background-image: url('https://attacker.example/body.png')">
          <script>globalThis.compromised = true</script>
          <iframe src="https://attacker.example/frame"></iframe>
          <form action="https://attacker.example/submit"><input name="secret"></form>
          <table class="card" cellpadding="24" style="border-collapse: collapse">
            <tbody><tr><td><strong>Medium Severity</strong></td></tr></tbody>
          </table>
          <a href="https://attacker.example/visit" target="_blank" ping="https://attacker.example/ping">Dashboard</a>
          <img alt="tracking" src="https://attacker.example/pixel.gif" srcset="https://attacker.example/pixel-2.gif 2x">
          <img alt="inline" src="data:image/png;base64,AAAA">
          <svg onload="globalThis.compromised = true"><circle /></svg>
        </body>
      </html>
    `));

    expect(sanitized.querySelector('table.card')).not.toBeNull();
    expect(sanitized.querySelector('td')?.textContent).toContain('Medium Severity');
    expect(sanitized.querySelector('style')?.textContent).toContain('width: 620px');
    expect(sanitized.querySelector('script, iframe, form, input, base, meta, link, svg')).toBeNull();

    const anchor = sanitized.querySelector('a');
    expect(anchor?.textContent).toBe('Dashboard');
    expect(anchor?.hasAttribute('href')).toBe(false);
    expect(anchor?.hasAttribute('target')).toBe(false);
    expect(anchor?.getAttribute('aria-disabled')).toBe('true');

    const images = sanitized.querySelectorAll('img');
    expect(images[0]?.hasAttribute('src')).toBe(false);
    expect(images[0]?.hasAttribute('srcset')).toBe(false);
    expect(images[0]?.hasAttribute('data-tap-image-blocked')).toBe(true);
    expect(images[1]?.getAttribute('src')).toBe('data:image/png;base64,AAAA');

    expect(sanitized.documentElement.outerHTML).not.toContain('attacker.example');
    expect(sanitized.documentElement.outerHTML).not.toContain('expression(');
    expect(sanitized.documentElement.outerHTML).not.toContain('behavior:');
  });

  it('strips external CSS fetches but retains safe inline image data', () => {
    const css = sanitizeRichMessageCss(`
      @import "https://attacker.example/a.css";
      .external { background: url(https://attacker.example/a.png); }
      .inline { background: url('data:image/gif;base64,R0lGODlhAQABAAAAACw='); }
      .old-ie { width: expression(document.cookie); }
    `);

    expect(css).not.toContain('@import');
    expect(css).not.toContain('attacker.example');
    expect(css).not.toContain('expression(');
    expect(css).toContain('url("data:image/gif;base64,R0lGODlhAQABAAAAACw=")');
  });

  it('builds a complete isolated document with a deny-by-default CSP', () => {
    const source = buildRichMessageDocument(`
      <style>.card { color: #111; }</style>
      <table class="card"><tbody><tr><td>Alert details</td></tr></tbody></table>
    `);
    const document = parse(source);
    const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]');

    expect(source.startsWith('<!doctype html>')).toBe(true);
    expect(policy?.getAttribute('content')).toBe(richMessageContentSecurityPolicy);
    expect(policy?.getAttribute('content')).toContain("script-src 'none'");
    expect(policy?.getAttribute('content')).toContain('img-src data:');
    expect(policy?.getAttribute('content')).toContain("form-action 'none'");
    expect(document.querySelector('table.card')).not.toBeNull();
    expect(document.querySelectorAll('style')).toHaveLength(1);
    expect(document.querySelector('style[data-tap-message-styles]')).not.toBeNull();
  });

  it('uses the host theme for ordinary prose mail', () => {
    const source = buildRichMessageDocument(
      '<div>Hello Zack</div><blockquote>Earlier message</blockquote>',
      {},
      { theme: 'dark' },
    );
    const document = parse(source);
    const baseStyles = document.head.querySelector('style[data-tap-message-styles]')?.textContent ?? '';

    expect(richMessagePresentation('<p>Ordinary conversation</p>')).toBe('adaptive');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.body.dataset.tapPresentation).toBe('adaptive');
    expect(baseStyles).toContain(':root[data-theme="dark"]');
    expect(baseStyles).toContain('body[data-tap-presentation="adaptive"]');
  });

  it('folds only known provider quote wrappers by default', () => {
    const html = `
      <p>Current reply</p>
      <blockquote>Quoted prose that is part of the current message</blockquote>
      <div class="gmail_quote">Earlier Gmail reply</div>
      <blockquote type="cite">Earlier standards-style reply</blockquote>
      <div type="cite">Earlier Apple Mail reply</div>
      <div class="gmail_signature">Current signature</div>
    `;
    const document = parse(buildRichMessageDocument(html));
    const ordinaryQuote = document.querySelector('blockquote:not([type])');
    const gmailQuote = document.querySelector('.gmail_quote');
    const markedQuotes = [...document.querySelectorAll('[data-tap-quoted]')]
      .map(element => element.textContent?.trim());
    const styles = document.querySelector('style[data-tap-message-styles]')?.textContent ?? '';

    expect(hasKnownQuotedContent(html)).toBe(true);
    expect(document.documentElement.dataset.tapShowQuoted).toBe('false');
    expect(gmailQuote?.hasAttribute('data-tap-quoted')).toBe(true);
    expect((gmailQuote as HTMLElement | null)?.style.getPropertyValue('display')).toBe('none');
    expect((gmailQuote as HTMLElement | null)?.style.getPropertyPriority('display')).toBe('important');
    expect(markedQuotes).toEqual([
      'Earlier Gmail reply',
      'Earlier standards-style reply',
      'Earlier Apple Mail reply',
    ]);
    expect(ordinaryQuote?.hasAttribute('data-tap-quoted')).toBe(false);
    expect(document.querySelector('.gmail_signature')?.hasAttribute('data-tap-quoted')).toBe(false);
    expect(styles).toContain('html:not([data-tap-show-quoted="true"]) [data-tap-quoted]');
    expect(hasKnownQuotedContent('<blockquote>Ordinary quotation</blockquote>')).toBe(false);
  });

  it('does not request remote images from quoted history until it is revealed', () => {
    const currentImage = 'https://cdn.example.com/current.png';
    const quotedImage = 'https://cdn.example.com/quoted.png';
    const html = `
      <img src="${currentImage}" width="640" height="320">
      <div class="gmail_quote"><img src="${quotedImage}" width="640" height="320"></div>
    `;

    expect(extractRemoteImageUrls(html, false, false)).toEqual([currentImage]);
    expect(extractRemoteImageUrls(html, false, true)).toEqual([currentImage, quotedImage]);
  });

  it('can reveal marked quoted content without weakening document isolation', () => {
    const source = buildRichMessageDocument(
      '<p>Current reply</p><div class="gmail_quote">Earlier reply</div>',
      {},
      { showQuotedContent: true, theme: 'dark' },
    );
    const document = parse(source);
    const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]');

    expect(document.documentElement.dataset.tapShowQuoted).toBe('true');
    expect(document.querySelector('.gmail_quote')?.hasAttribute('data-tap-quoted')).toBe(true);
    expect((document.querySelector('.gmail_quote') as HTMLElement | null)?.style.display).toBe('');
    expect(policy?.getAttribute('content')).toBe(richMessageContentSecurityPolicy);
    expect(source).not.toContain('allow-scripts');
  });

  it('offers a parent-realm quote disclosure only when a known quote exists', () => {
    const withQuote = parse(renderToStaticMarkup(createElement(RichMessageBody, {
      html: '<p>Current reply</p><div class="gmail_quote">Earlier reply</div>',
      title: 'Conversation message',
    })));
    const withoutQuote = parse(renderToStaticMarkup(createElement(RichMessageBody, {
      html: '<p>Current reply</p><blockquote>Quoted prose</blockquote>',
      title: 'Standalone message',
    })));
    const disclosure = withQuote.querySelector('button.rich-message-quote-toggle');

    expect(disclosure?.textContent).toBe('Show quoted text');
    expect(disclosure?.getAttribute('type')).toBe('button');
    expect(disclosure?.getAttribute('aria-expanded')).toBe('false');
    expect(disclosure?.getAttribute('aria-controls')).toBe(withQuote.querySelector('iframe')?.id);
    expect(withQuote.querySelector('iframe')?.contains(disclosure ?? null)).toBe(false);
    expect(withoutQuote.querySelector('button.rich-message-quote-toggle')).toBeNull();
  });

  it('does not mistake reset CSS or a small signature logo for a designed canvas', () => {
    const resetMail = `
      <style>html, body { margin: 0; color: #111; background: #fff; }</style>
      <p>See you tomorrow.</p>
    `;
    const signatureMail = `
      <p>Regards,<br>Zack</p>
      <table bgcolor="#ffffff" width="600"><tbody><tr><td>
        <a href="https://example.com" style="display: block">
          <img alt="Company logo" src="https://cdn.example.com/logo.png" width="120" height="40">
        </a>
      </td></tr></tbody></table>
    `;
    const marketingMail = `
      <style>.hero { max-width: 640px; background: #111; color: #fff; }</style>
      <table class="hero" width="640"><tbody><tr><td>
        <img alt="New collection" src="https://cdn.example.com/hero.png" width="640" height="420">
      </td></tr></tbody></table>
    `;

    expect(richMessagePresentation(resetMail)).toBe('adaptive');
    expect(richMessagePresentation(signatureMail)).toBe('adaptive');
    expect(richMessagePresentation(marketingMail)).toBe('authored');

    const signatureDocument = parse(buildRichMessageDocument(
      signatureMail,
      {},
      { theme: 'dark' },
    ));
    expect(signatureDocument.documentElement.dataset.theme).toBe('dark');
    expect(signatureDocument.body.dataset.tapPresentation).toBe('adaptive');
    expect(signatureDocument.querySelector('table')?.hasAttribute('bgcolor')).toBe(false);
  });

  it('does not let hidden quoted history dictate the current reply presentation', () => {
    const quotedMarketingMail = `
      <p>Thanks, that works for me.</p>
      <div class="gmail_quote">
        <table width="640" bgcolor="#111"><tbody><tr><td>
          <img alt="Old campaign" src="https://cdn.example.com/old-hero.png" width="640" height="420">
        </td></tr></tbody></table>
      </div>
    `;

    expect(richMessagePresentation(quotedMarketingMail)).toBe('adaptive');
  });

  it('removes sender paint from adaptive full documents and all prose descendants', () => {
    const source = buildRichMessageDocument(`
      <!doctype html>
      <html style="color: #050505 !important; background: #fff !important">
        <head>
          <style>
            html, body { color: #111 !important; background: #fff !important; }
            #headline, strong, pre { color: #000 !important; -webkit-text-fill-color: #000 !important; }
          </style>
        </head>
        <body style="padding: 0 !important; color: #111 !important; background-color: #fff !important">
          <h1 id="headline" style="font-size: 22px; color: #000 !important">Heading</h1>
          <p><strong style="color: #111 !important">Strong copy</strong></p>
          <pre style="all: initial !important; color: #000 !important">code sample</pre>
        </body>
      </html>
    `, {}, { theme: 'dark' });
    const document = parse(source);
    const baseStyles = document.querySelector('style[data-tap-message-styles]')?.textContent ?? '';

    expect(document.body.dataset.tapPresentation).toBe('adaptive');
    expect(document.querySelectorAll('style:not([data-tap-message-styles])')).toHaveLength(0);
    expect(document.documentElement.getAttribute('style')).toBeNull();
    expect(document.body.style.getPropertyValue('padding')).toMatch(/^0(?:px)?$/u);
    expect(document.body.style.getPropertyPriority('padding')).toBe('important');
    expect(document.body.style.getPropertyValue('color')).toBe('');
    expect(document.body.style.getPropertyValue('background-color')).toBe('');
    expect(document.querySelector<HTMLElement>('h1')?.style.fontSize).toBe('22px');
    expect(document.querySelector<HTMLElement>('h1')?.style.color).toBe('');
    expect(document.querySelector('strong')?.getAttribute('style')).toBeNull();
    expect(document.querySelector('pre')?.getAttribute('style')).toBeNull();
    expect(baseStyles).toContain('body[data-tap-presentation="adaptive"] *');
    expect(baseStyles).toContain('background: var(--tap-message-canvas) !important');
    expect(baseStyles).toContain('color: var(--tap-message-copy) !important');
    expect(baseStyles).toContain('color: inherit !important');
    expect(baseStyles).toContain('background-image: none !important');
  });

  it('keeps sender-designed canvases authored while still adding a gutter', () => {
    const html = `
      <style>.hero { background: #000; color: #fff; }</style>
      <table class="hero" width="640"><tbody><tr><td>Launch</td></tr></tbody></table>
    `;
    const document = parse(buildRichMessageDocument(html, {}, { theme: 'dark' }));

    expect(richMessagePresentation(html)).toBe('authored');
    expect(document.body.dataset.tapPresentation).toBe('authored');
    expect(document.head.querySelector('style[data-tap-message-styles]')?.textContent).toContain(
      'body[data-tap-presentation="authored"]',
    );
    expect(document.querySelector('style:not([data-tap-message-styles])')?.textContent).toContain(
      'background: #000',
    );
  });

  it('retains legacy email table geometry without permitting request attributes', () => {
    const document = parse(sanitizeRichMessageHtml(`
      <body bgcolor="#f0ebde">
        <table
          align="center"
          bgcolor="#f0ebde"
          border="0"
          cellpadding="0"
          cellspacing="0"
          width="100%"
        >
          <tbody><tr><td align="center" valign="top">
            <table align="center" width="600"><tbody><tr>
              <td bgcolor="#ffffff" height="238" width="550">Newsletter</td>
            </tr></tbody></table>
          </td></tr></tbody>
        </table>
        <img
          alt="Newsletter hero"
          height="238"
          src="https://sender.example/hero.jpg"
          srcset="https://sender.example/hero@2x.jpg 2x"
          width="550"
        >
      </body>
    `));
    const tables = document.querySelectorAll('table');
    const cells = document.querySelectorAll('td');
    const image = document.querySelector('img');

    expect(document.body.getAttribute('bgcolor')).toBe('#f0ebde');
    expect(tables[0]?.getAttribute('align')).toBe('center');
    expect(tables[0]?.getAttribute('width')).toBe('100%');
    expect(tables[0]?.getAttribute('cellpadding')).toBe('0');
    expect(tables[0]?.getAttribute('cellspacing')).toBe('0');
    expect(tables[1]?.getAttribute('width')).toBe('600');
    expect(cells[0]?.getAttribute('valign')).toBe('top');
    expect(cells[1]?.getAttribute('bgcolor')).toBe('#ffffff');
    expect(cells[1]?.getAttribute('height')).toBe('238');
    expect(cells[1]?.getAttribute('width')).toBe('550');
    expect(image?.getAttribute('width')).toBe('550');
    expect(image?.getAttribute('height')).toBe('238');
    expect(image?.hasAttribute('src')).toBe(false);
    expect(image?.hasAttribute('srcset')).toBe(false);
    expect(image?.hasAttribute('data-tap-image-blocked')).toBe(true);
    expect(document.documentElement.outerHTML).not.toContain('sender.example');
  });

  it('keeps authored body spacing and scales large images without distortion', () => {
    const document = parse(buildRichMessageDocument(`
      <body style="width: 760px; margin: 12px; padding: 24px">
        <table width="600"><tbody><tr><td>
          <img
            alt="Wide campaign hero"
            height="450"
            src="data:image/png;base64,AAAA"
            style="height: 900px"
            width="1200"
          >
        </td></tr></tbody></table>
      </body>
    `, {}, { presentation: 'authored' }));
    const baseStyles = document.querySelector(
      'style[data-tap-message-styles]',
    )?.textContent ?? '';

    expect(document.body.style.width).toBe('760px');
    expect(document.body.style.margin).toBe('12px');
    expect(document.body.style.padding).toBe('24px');
    expect(baseStyles).toContain('img { max-width: 100% !important; }');
    expect(baseStyles).toContain('img[width][height] { height: auto !important; }');
    const styleElement = window.document.createElement('style');
    styleElement.textContent = baseStyles;
    window.document.head.append(styleElement);
    try {
      const responsiveImageRule = [...(styleElement.sheet?.cssRules ?? [])]
        .find(rule => 'selectorText' in rule && rule.selectorText === 'img[width][height]');
      expect(responsiveImageRule).toBeDefined();
      expect((responsiveImageRule as CSSStyleRule).style.getPropertyValue('height')).toBe('auto');
      expect((responsiveImageRule as CSSStyleRule).style.getPropertyPriority('height')).toBe('important');
    } finally {
      styleElement.remove();
    }
    expect(baseStyles).not.toContain('width: auto !important');
    expect(baseStyles).not.toContain('margin: 0 !important');
    expect(baseStyles).not.toContain('padding: 0 !important');
  });

  it('grants the rich-content frame only same-origin layout measurement', () => {
    const markup = renderToStaticMarkup(createElement(RichMessageBody, {
      html: '<p>Static message</p>',
      theme: 'dark',
      title: 'Rich email from Vercel',
    }));
    const frame = parse(markup).querySelector('iframe');
    const shell = frame?.parentElement;

    expect(shell?.classList.contains('rich-message-shell')).toBe(true);
    expect(shell?.getAttribute('style')).toContain(`padding:${richMessageGutter}`);
    expect(shell?.getAttribute('data-theme')).toBe('dark');
    expect(shell?.getAttribute('data-presentation')).toBe('adaptive');
    expect(frame?.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(frame?.getAttribute('sandbox')).not.toContain('allow-scripts');
    expect(frame?.getAttribute('sandbox')).not.toContain('allow-forms');
    expect(frame?.getAttribute('sandbox')).not.toContain('allow-popups');
    expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame?.getAttribute('data-theme')).toBe('dark');
    expect(frame?.getAttribute('data-presentation')).toBe('adaptive');
  });

  it('bridges keyboard shortcuts from the isolated document and cleans up', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const received: string[] = [];
    const stopListening = listenForRichMessageKeyDown(frame, event => {
      received.push(event.key);
      event.preventDefault();
    });
    const frameDocument = frame.contentDocument;
    expect(frameDocument).not.toBeNull();

    const shortcut = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'H',
    });
    expect(frameDocument!.dispatchEvent(shortcut)).toBe(false);
    expect(received).toEqual(['H']);

    stopListening();
    frameDocument!.dispatchEvent(new KeyboardEvent('keydown', { key: 'R' }));
    expect(received).toEqual(['H']);
    frame.remove();
  });

  it('selects ordinary sender images while suppressing tiny and hidden trackers', () => {
    const html = `
      <img src="https://d3k81ch9hvuctc.cloudfront.net/company/McM4Ha/images/hero.jpeg" width="1200" height="900">
      <img src="https://ctrk.klclick.com/l/01K4/pixel.gif" width="1" height="1">
      <img src="https://track.example.com/hidden.gif" style="display: none">
      <img src="cid:logo@message">
      <img src="data:image/png;base64,AAAA">
    `;
    const document = parse(html);
    expect(isLikelyTrackingImage(document.querySelectorAll('img')[1]!)).toBe(true);
    expect(extractRemoteImageUrls(html)).toEqual([
      'https://d3k81ch9hvuctc.cloudfront.net/company/McM4Ha/images/hero.jpeg',
    ]);
    expect(extractRemoteImageUrls(html, true)).toEqual([
      'https://d3k81ch9hvuctc.cloudfront.net/company/McM4Ha/images/hero.jpeg',
      'https://ctrk.klclick.com/l/01K4/pixel.gif',
      'https://track.example.com/hidden.gif',
    ]);
  });

  it('does not fetch tracking pixels hidden by sender styles or a hidden ancestor', () => {
    const visible = 'https://cdn.example.com/visible.png';
    const classHidden = 'https://track.example.com/class-hidden.gif';
    const ancestorHidden = 'https://track.example.com/ancestor-hidden.gif';
    const html = `
      <style>
        .tracking-pixel { display: none !important; }
        #receipt-wrapper { visibility: hidden; }
      </style>
      <img src="${visible}" width="640" height="320">
      <img class="tracking-pixel" src="${classHidden}" width="24" height="24">
      <span id="receipt-wrapper"><img src="${ancestorHidden}" width="24" height="24"></span>
    `;

    expect(extractRemoteImageUrls(html, false)).toEqual([visible]);
    expect(extractRemoteImageUrls(html, true)).toEqual([
      visible,
      classHidden,
      ancestorHidden,
    ]);
  });

  it('extracts every eligible sender image instead of silently truncating after 32', () => {
    const urls = Array.from(
      { length: 65 },
      (_, index) => `https://cdn.example.com/campaign/image-${index}.png`,
    );
    const html = urls
      .map(url => `<img alt="Campaign asset" src="${url}" width="640" height="320">`)
      .join('');

    expect(extractRemoteImageUrls(html)).toEqual(urls);
  });

  it('renders only validated proxied image data and never exposes sender URLs', () => {
    const hero = 'https://cdn.example.com/hero.png';
    const tracker = 'https://tracker.example.com/open.gif';
    const source = buildRichMessageDocument(
      `<main><img alt="Hero" src="${hero}"><img alt="Tracker" src="${tracker}" width="1" height="1"></main>`,
      { [hero]: 'data:image/png;base64,iVBORw0KGgo=' },
    );
    const document = parse(source);
    const images = document.querySelectorAll('img');

    expect(images[0]?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(images[0]?.hasAttribute('data-tap-image-blocked')).toBe(false);
    expect(images[1]?.hasAttribute('src')).toBe(false);
    expect(images[1]?.hasAttribute('data-tap-image-blocked')).toBe(true);
    expect(source).not.toContain('cdn.example.com');
    expect(source).not.toContain('tracker.example.com');
    expect(source).toContain('img-src data:');
  });

  it('fails closed for unsupported proxied image formats', () => {
    const url = 'https://cdn.example.com/vector.svg';
    const source = buildRichMessageDocument(
      `<img src="${url}">`,
      { [url]: 'data:image/svg+xml;base64,PHN2Zz4=' },
    );
    const image = parse(source).querySelector('img');

    expect(image?.hasAttribute('src')).toBe(false);
    expect(image?.hasAttribute('data-tap-image-blocked')).toBe(true);
    expect(source).not.toContain(url);
  });
});
