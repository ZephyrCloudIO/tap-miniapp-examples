import '@theaiplatform/miniapp-sdk/ui/styles.css';
import { useEffect, useState } from 'react';
import { TapEmailApp } from '../../src/app';
import { createDiagnosticRoot } from '../../src/diagnostic-root';
import { createEmailDiagnostics } from '../../src/diagnostics';
import type { MiniAppStorageEntry, MiniAppStorageMutationResult } from '@theaiplatform/miniapp-sdk/sdk';
import '../../src/styles.css';

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error('Diagnostic fixture storage denied');
  return response.json();
}
const diagnostics = createEmailDiagnostics({ storage: {
  get: async () => readResponse<MiniAppStorageEntry>(await fetch('/diagnostics')),
  set: async input => readResponse<MiniAppStorageMutationResult>(await fetch('/diagnostics', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })),
} });
const instrumented = {
  ...diagnostics,
  breadcrumb: (phase: Parameters<typeof diagnostics.breadcrumb>[0]) => {
    diagnostics.breadcrumb(phase);
    if (phase === 'mailbox.committed') window.parent.postMessage({ type: 'mailbox-ready' }, location.origin);
  },
};

function DiagnosticEmail() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== location.origin) return;
      if (event.data?.type === 'render-failure') setFailed(true);
      if (event.data?.type === 'promise-failure') void Promise.reject(new Error('Injected async failure after mailbox hydration'));
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
  if (failed) throw new Error('Injected render failure after mailbox hydration');
  return <TapEmailApp preview diagnostics={instrumented} />;
}

createDiagnosticRoot(document.getElementById('root')!, diagnostics).render(<DiagnosticEmail />);
