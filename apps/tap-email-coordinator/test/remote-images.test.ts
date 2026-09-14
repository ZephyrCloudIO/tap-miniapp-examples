import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTapEmailCoordinator } from '../src/index';
import { sealSecret } from '../src/crypto';
import {
  proxyRemoteImages,
  remoteImageUrlsAllowedByHtml,
  remoteImageUrlsFromRequest,
  safeRemoteImageUrl,
} from '../src/remote-images';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('remote image proxy', () => {
  it('accepts only bounded public HTTPS image URLs', () => {
    expect(safeRemoteImageUrl('https://cdn.example.com/image.png#fragment')?.href)
      .toBe('https://cdn.example.com/image.png');
    for (const value of [
      'http://cdn.example.com/image.png',
      'https://user:secret@cdn.example.com/image.png',
      'https://cdn.example.com:8443/image.png',
      'https://localhost/image.png',
      'https://localhost./image.png',
      'https://printer/image.png',
      'https://127.0.0.1/image.png',
      'https://203.0.113.1/image.png',
      'https://10.2.3.4/image.png',
      'https://[::1]/image.png',
      'https://[::ffff:7f00:1]/image.png',
      'https://[ff02::1]/image.png',
      'not a URL',
    ]) {
      expect(safeRemoteImageUrl(value), value).toBeNull();
    }
  });

  it('deduplicates a bounded request and rejects oversized batches', () => {
    expect(remoteImageUrlsFromRequest({
      urls: ['https://cdn.example/a.png', 'https://cdn.example/a.png'],
    })).toEqual(['https://cdn.example/a.png']);
    expect(() => remoteImageUrlsFromRequest({ urls: [] })).toThrow(/between 1 and 32/u);
    expect(() => remoteImageUrlsFromRequest({
      urls: Array.from({ length: 33 }, (_, index) => `https://cdn.example/${index}.png`),
    })).toThrow(/between 1 and 32/u);
  });

  it('allows only requested URLs that are actually present in message HTML', async () => {
    const hero = 'https://cdn.example/hero.png?campaign=a&user=1';
    const logo = 'https://cdn.example/logo.png#top';
    await expect(remoteImageUrlsAllowedByHtml(
      `<main><img src="${hero.replace('&', '&amp;')}"><img src="${logo}"></main>`,
      [hero, logo, 'https://cdn.example/not-in-message.png'],
    )).resolves.toEqual([hero, logo]);
  });

  it('returns validated raster data without forwarding caller credentials', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual');
      expect(new Headers(init?.headers).has('Cookie')).toBe(false);
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      expect(new Headers(init?.headers).has('Referer')).toBe(false);
      return new Response(png, {
        headers: { 'Content-Type': 'image/png' },
      });
    });

    await expect(proxyRemoteImages(
      ['https://cdn.example/image.png'],
      fetcher,
    )).resolves.toEqual({
      images: [{
        url: 'https://cdn.example/image.png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        sizeBytes: 8,
      }],
      blocked: [],
    });
  });

  it('applies the total batch budget in input order', async () => {
    const largePng = new Uint8Array(1_572_864);
    largePng.set(png);
    const urls = Array.from(
      { length: 5 },
      (_, index) => `https://cdn.example/image-${index}.png`,
    );

    const result = await proxyRemoteImages(
      urls,
      async () => new Response(largePng, {
        headers: { 'Content-Type': 'image/png' },
      }),
    );

    expect(result.images.map(image => image.url)).toEqual(urls.slice(0, 4));
    expect(result.blocked).toEqual([{ url: urls[4], reason: 'too_large' }]);
  });

  it('revalidates redirect targets and rejects type spoofing and oversized bodies', async () => {
    const redirected = await proxyRemoteImages(
      ['https://cdn.example/redirect.png'],
      async input => String(input).includes('redirect.png')
        ? new Response(null, {
            status: 302,
            headers: { Location: 'https://images.example/final.png' },
          })
        : new Response(png, { headers: { 'Content-Type': 'image/png' } }),
    );
    expect(redirected.images).toHaveLength(1);

    const unsafeRedirect = await proxyRemoteImages(
      ['https://cdn.example/redirect.png'],
      async () => new Response(null, {
        status: 302,
        headers: { Location: 'https://127.0.0.1/private.png' },
      }),
    );
    expect(unsafeRedirect.blocked).toEqual([{
      url: 'https://cdn.example/redirect.png',
      reason: 'unsafe_redirect',
    }]);

    const spoofed = await proxyRemoteImages(
      ['https://cdn.example/spoof.png'],
      async () => new Response('<svg></svg>', {
        headers: { 'Content-Type': 'image/png' },
      }),
    );
    expect(spoofed.blocked[0]?.reason).toBe('non_image');

    const oversized = await proxyRemoteImages(
      ['https://cdn.example/large.png'],
      async () => new Response(png, {
        headers: {
          'Content-Length': String(2 * 1_024 * 1_024 + 1),
          'Content-Type': 'image/png',
        },
      }),
    );
    expect(oversized.blocked[0]?.reason).toBe('too_large');
  });
});

describe('remote image route', () => {
  const richImageUrl = 'https://cdn.example/image.png';
  const route = 'https://coordinator.example/v1/accounts/google_personal/threads/gmail_thread_1/messages/gmail_message_1/remote-images';

  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM mail_messages'),
      env.DB.prepare('DELETE FROM mail_threads'),
      env.DB.prepare('DELETE FROM google_accounts'),
    ]);
    const bodyText = await sealSecret('Image', env.GOOGLE_TOKEN_ENCRYPTION_KEY);
    const bodyHtml = await sealSecret(
      `<main><img src="${richImageUrl}"></main>`,
      env.GOOGLE_TOKEN_ENCRYPTION_KEY,
    );
    await env.DB.prepare(
      `INSERT INTO google_accounts
         (profile_id, account_id, google_subject, connection_state,
          coverage_state, unresolved_failures, created_at, updated_at)
       VALUES ('profile_1', 'google_personal', 'google_subject_1', 'active',
               'current', 0, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO mail_threads
         (profile_id, account_id, thread_id, history_id, subject, snippet,
          participants_json, received_at, unread, starred, important,
          in_inbox, needs_response, waiting_on_others, label_ids_json, updated_at)
       VALUES ('profile_1', 'google_personal', 'gmail_thread_1', 'history_1',
               'Images', 'Image', '[]', '2026-09-13T00:00:00.000Z',
               1, 0, 0, 1, 0, 0, '["INBOX"]', '2026-09-13T00:00:00.000Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO mail_messages
         (profile_id, account_id, thread_id, message_id, internet_message_id,
          sender_json, recipients_json, sent_at, body_text_ciphertext,
          body_html_ciphertext, ordinal, updated_at)
       VALUES ('profile_1', 'google_personal', 'gmail_thread_1', 'gmail_message_1',
               NULL, '{"name":"Sender","address":"sender@example.com"}', '[]',
               '2026-09-13T00:00:00.000Z', ?, ?, 0, '2026-09-13T00:00:00.000Z')`,
    ).bind(bodyText, bodyHtml).run();
  });

  it('requires coordinator authorization and passes one bounded batch to the loader', async () => {
    const loadRemoteImages = vi.fn(async (urls: readonly string[]) => ({
      images: [{
        url: urls[0]!,
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        sizeBytes: 8,
      }],
      blocked: [],
    }));
    const verifyAccess = vi.fn(async () => ({ profileId: 'profile_1' }));
    const worker = createTapEmailCoordinator({ loadRemoteImages, verifyAccess });
    const response = await worker.fetch(new Request(
      route,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ urls: [richImageUrl] }),
      },
    ), env);

    expect(response.status).toBe(200);
    expect(verifyAccess).toHaveBeenCalledOnce();
    expect(loadRemoteImages).toHaveBeenCalledWith([richImageUrl]);
    expect(await response.json()).toMatchObject({ images: [{ sizeBytes: 8 }] });
  });

  it('rejects malformed batches before invoking the loader', async () => {
    const loadRemoteImages = vi.fn();
    const worker = createTapEmailCoordinator({
      loadRemoteImages,
      verifyAccess: async () => ({ profileId: 'profile_1' }),
    });
    const response = await worker.fetch(new Request(
      route,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [] }),
      },
    ), env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_remote_images' });
    expect(loadRemoteImages).not.toHaveBeenCalled();
  });

  it('rejects a URL that is not bound to the authenticated stored message', async () => {
    const loadRemoteImages = vi.fn();
    const worker = createTapEmailCoordinator({
      loadRemoteImages,
      verifyAccess: async () => ({ profileId: 'profile_1' }),
    });
    const response = await worker.fetch(new Request(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: ['https://attacker.example/private.png'] }),
    }), env);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'unbound_remote_image' });
    expect(loadRemoteImages).not.toHaveBeenCalled();
  });

  it('does not expose another profile\'s message-image capability', async () => {
    const loadRemoteImages = vi.fn();
    const worker = createTapEmailCoordinator({
      loadRemoteImages,
      verifyAccess: async () => ({ profileId: 'profile_2' }),
    });
    const response = await worker.fetch(new Request(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [richImageUrl] }),
    }), env);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'message_not_found' });
    expect(loadRemoteImages).not.toHaveBeenCalled();
  });
});
