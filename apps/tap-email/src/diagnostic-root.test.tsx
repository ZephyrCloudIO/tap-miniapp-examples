/** @rstest-environment jsdom */
import React, { act, useState, type Dispatch, type SetStateAction } from 'react';
import { describe, expect, it } from '@rstest/core';
import { createDiagnosticRoot } from './diagnostic-root';
import { createEmailDiagnostics } from './diagnostics';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Email diagnostic root', () => {
  it('keeps recovery controls and a persisted component stack after a late React failure', async () => {
    let crash: Dispatch<SetStateAction<boolean>> = () => undefined;
    const diagnostics = createEmailDiagnostics({ storage: {
      get: () => ({ value: null, revision: null }),
      set: () => ({ revision: 1 }),
    } });
    function Mailbox() {
      const [failed, setFailed] = useState(false);
      crash = setFailed;
      if (failed) throw new Error('Injected mailbox render failure');
      return <h1>Inbox loaded</h1>;
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createDiagnosticRoot(container, diagnostics);
    try {
      await act(async () => root.render(<Mailbox />));
      expect(container.textContent).toContain('Inbox loaded');
      diagnostics.breadcrumb('cache.loaded');
      diagnostics.breadcrumb('mailbox.committed');
      await act(async () => crash(true));
      await diagnostics.flush();
      expect(container.querySelector('section')?.hidden).toBe(false);
      expect(container.textContent).toContain('Email encountered an error');
      expect(container.textContent).toContain('Diagnostic report saved in TAP.');
      expect(diagnostics.latest()?.error.componentStack).toContain('Mailbox');
      expect(diagnostics.latest()?.breadcrumbs.some(entry => entry.phase === 'mailbox.committed')).toBe(true);
      const copy = [...container.querySelectorAll('button')].find(button => button.textContent === 'Copy diagnostics')!;
      await act(async () => copy.click());
      expect(container.querySelector('details')?.open).toBe(true);
      expect(container.querySelector('textarea')?.value).toContain('Injected mailbox render failure');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('captures global failures and removes handlers on unmount', async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const view = frame.contentWindow!;
    const container = frame.contentDocument!.createElement('div');
    const diagnostics = createEmailDiagnostics();
    const root = createDiagnosticRoot(container, diagnostics);
    const first = new ErrorEvent('error', { cancelable: true, error: new Error('event handler failed') });
    first.preventDefault();
    await act(async () => { view.dispatchEvent(first); });
    expect(diagnostics.latest()?.source).toBe('window.error');
    const report = diagnostics.latest();
    await act(async () => root.unmount());
    const second = new ErrorEvent('error', { cancelable: true, error: new Error('after unmount') });
    second.preventDefault();
    view.dispatchEvent(second);
    expect(diagnostics.latest()).toBe(report);
    frame.remove();
  });
});
