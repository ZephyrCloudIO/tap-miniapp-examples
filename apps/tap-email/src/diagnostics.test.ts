import { describe, expect, it } from '@rstest/core';
import type { MiniAppStorageApi, MiniAppStorageEntry } from '@theaiplatform/miniapp-sdk/sdk';
import { createEmailDiagnostics, sanitizeDiagnosticText } from './diagnostics';

function storageFixture() {
  let entry: MiniAppStorageEntry = { revision: null, value: null };
  const storage: Pick<MiniAppStorageApi, 'get' | 'set'> = {
    get: () => entry,
    set: input => {
      if (input.expectedRevision !== entry.revision) throw new Error('conflict');
      entry = { value: input.value, revision: (entry.revision ?? 0) + 1 };
      return { revision: entry.revision! };
    },
  };
  return { storage, read: () => entry };
}

describe('Email diagnostics', () => {
  it('persists late errors and their bounded timeline across new mounts', async () => {
    const fixture = storageFixture();
    const diagnostics = createEmailDiagnostics({ storage: fixture.storage });
    for (let count = 0; count < 60; count += 1) diagnostics.breadcrumb('cache.loading');
    diagnostics.breadcrumb('cache.loaded');
    diagnostics.breadcrumb('mailbox.committed');
    const error = new TypeError('Cannot read properties of undefined');
    const report = diagnostics.capture(error, 'react.caught', '\n    at EmailThread (app.js:20:4)');
    expect(diagnostics.capture(error, 'window.error')).toBe(report);
    await diagnostics.flush();
    expect(diagnostics.persistence()).toBe('saved');
    expect(report.breadcrumbs).toHaveLength(40);
    expect(report.breadcrumbs.at(-2)?.phase).toBe('mailbox.committed');
    expect(report.error.componentStack).toContain('EmailThread');
    const reopened = createEmailDiagnostics({ storage: fixture.storage });
    for (let count = 0; count < 8; count += 1) reopened.capture(new Error(`Failure ${count}`), 'window.error');
    await reopened.flush();
    expect(fixture.read().value).toHaveLength(5);
    expect(JSON.stringify(fixture.read().value)).toContain('Failure 4');
  });

  it('still produces a copyable report when storage is denied', async () => {
    let calls = 0;
    const diagnostics = createEmailDiagnostics({ storage: {
      get: () => { calls += 1; throw new Error('denied'); },
      set: () => { throw new Error('denied'); },
    } });
    diagnostics.capture(new Error('render failed'), 'react.uncaught');
    await diagnostics.flush();
    expect(calls).toBe(3);
    expect(diagnostics.persistence()).toBe('unavailable');
    expect(diagnostics.latest()?.error.message).toBe('render failed');
  });

  it('removes credentials, addresses, quoted values and URL queries', () => {
    const text = sanitizeDiagnosticText('Failure for private@example.com "email subject" Bearer abc-secret at https://host/private/static/app.js?token=secret#account');
    expect(text).not.toContain('private@example');
    expect(text).not.toContain('email subject');
    expect(text).not.toContain('abc-secret');
    expect(text).not.toContain('token=secret');
    expect(text).toContain('app.js');
    expect(sanitizeDiagnosticText('a'.repeat(20_000))).toHaveLength(2_048);
    const report = createEmailDiagnostics().capture({ body: 'private mail', token: 'secret' }, 'window.rejection');
    expect(JSON.stringify(report)).not.toContain('private mail');
  });
});
