import React, { Component, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { EmailDiagnostics } from './diagnostics';

class EmailErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

function Committed({ diagnostics, children }: { diagnostics: EmailDiagnostics; children: ReactNode }) {
  useEffect(() => { diagnostics.breadcrumb('react.committed'); }, [diagnostics]);
  return children;
}

/** The recovery controls live outside React so an unmounted root cannot erase them. */
export function createDiagnosticRoot(container: HTMLElement, diagnostics: EmailDiagnostics) {
  const document = container.ownerDocument;
  const view = document.defaultView!;
  const app = document.createElement('div');
  app.className = 'email-react-root';
  const recovery = document.createElement('section');
  recovery.className = 'email-recovery';
  recovery.hidden = true;
  recovery.setAttribute('role', 'alert');
  recovery.setAttribute('aria-label', 'Email error recovery');
  const title = document.createElement('h1');
  title.textContent = 'Email encountered an error';
  const explanation = document.createElement('p');
  explanation.textContent = 'Copy the diagnostic report, then reload Email to try again.';
  const reference = document.createElement('p');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload Email';
  reload.onclick = () => { diagnostics.breadcrumb('surface.reload'); view.location.reload(); };
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy diagnostics';
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'View diagnostic report';
  const reportText = document.createElement('textarea');
  reportText.readOnly = true;
  reportText.setAttribute('aria-label', 'Diagnostic report');
  details.append(summary, reportText);
  copy.onclick = () => {
    const text = reportText.value;
    void (async () => {
      try {
        await view.navigator.clipboard.writeText(text);
        status.textContent = 'Diagnostics copied.';
      } catch {
        details.open = true;
        reportText.focus();
        reportText.select();
        status.textContent = 'Clipboard unavailable. Copy the selected report.';
      }
    })();
  };
  recovery.append(title, explanation, reference, reload, copy, status, details);
  container.replaceChildren(app, recovery);
  let fatal = false;
  let mounted = true;
  const unsubscribe = diagnostics.subscribe(report => {
    // Keep the initiating failure visible when teardown rejects in-flight work.
    if (report.source === 'react.recoverable' || fatal) return;
    fatal = true;
    app.hidden = true;
    recovery.hidden = false;
    reference.textContent = `Report ${report.id}`;
    reportText.value = JSON.stringify(report, null, 2);
    queueMicrotask(() => {
      if (mounted) { mounted = false; root.unmount(); }
    });
    status.textContent = 'Saving diagnostic report…';
    void diagnostics.flush().then(() => {
      status.textContent = diagnostics.persistence() === 'saved'
        ? 'Diagnostic report saved in TAP.'
        : 'TAP storage unavailable. Copy this report before closing Email.';
    });
  });
  const onError = (event: ErrorEvent) => diagnostics.capture(event.error ?? new Error(event.message), 'window.error');
  const onRejection = (event: PromiseRejectionEvent) => diagnostics.capture(event.reason, 'window.rejection');
  view.addEventListener('error', onError);
  view.addEventListener('unhandledrejection', onRejection);
  const root = createRoot(app, {
    onCaughtError: (error, info) => {
      diagnostics.capture(error, 'react.caught', info.componentStack ?? '');
      // React handled this exception; notify the browser/SDK's host reporter too.
      view.reportError?.(error);
    },
    onUncaughtError: (error, info) => {
      diagnostics.capture(error, 'react.uncaught', info.componentStack ?? '');
      view.reportError?.(error);
    },
    onRecoverableError: (error, info) => diagnostics.capture(error, 'react.recoverable', info.componentStack ?? ''),
  });
  diagnostics.breadcrumb('mount.requested');
  return {
    render(children: ReactNode) {
      if (!fatal) root.render(<EmailErrorBoundary><Committed diagnostics={diagnostics}>{children}</Committed></EmailErrorBoundary>);
    },
    unmount() {
      diagnostics.breadcrumb('surface.unmount');
      view.removeEventListener('error', onError);
      view.removeEventListener('unhandledrejection', onRejection);
      if (mounted) { mounted = false; root.unmount(); }
      unsubscribe();
      container.replaceChildren();
    },
  };
}
