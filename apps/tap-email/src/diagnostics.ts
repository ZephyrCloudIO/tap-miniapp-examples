import type { MiniAppStorageApi } from '@theaiplatform/miniapp-sdk/sdk';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';

declare const __TAP_EMAIL_BUILD__: { revision: string; dirty: boolean; version: string; sdkVersion: string };

export const diagnosticsAddress = { namespace: 'tap-email', key: 'diagnostics/v1' };
const maximumBreadcrumbs = 40;
const maximumReports = 5;

export type EmailDiagnosticPhase =
  | 'mount.requested' | 'react.committed' | 'authority.waiting' | 'authority.ready'
  | 'cache.loading' | 'cache.loaded' | 'cache.failed' | 'mailbox.committed'
  | 'mailbox.requested' | 'mailbox.page' | 'mailbox.loaded' | 'mailbox.failed'
  | 'surface.unmount' | 'surface.reload' | 'surface.error';
export type EmailErrorSource = 'react.caught' | 'react.uncaught' | 'react.recoverable' | 'window.error' | 'window.rejection';
export type DiagnosticBreadcrumb = { at: string; phase: EmailDiagnosticPhase };
export type EmailDiagnosticReport = {
  schemaVersion: 1;
  id: string;
  capturedAt: string;
  build: { revision: string; dirty: boolean; version: string; sdkVersion: string };
  surface: { packageId: string; releaseId: string; installationId: string; contributionId: string; instanceId: string } | null;
  source: EmailErrorSource;
  error: { name: string; message: string; stack: string; componentStack: string };
  breadcrumbs: DiagnosticBreadcrumb[];
};

// Never stringify thrown objects: they can contain mailbox bodies or HTTP headers.
export function sanitizeDiagnosticText(value: string, limit = 2_048): string {
  return value.slice(0, 16_384)
    .replace(/https?:\/\/[^\s)]+/giu, url => {
      const location = url.split(/[?#]/u, 1)[0]!;
      return location.slice(location.lastIndexOf('/') + 1) || '[url]';
    })
    .replace(/\bBearer\s+[^\s,;]+/giu, 'Bearer [redacted]')
    .replace(/\b(?:access_token|refresh_token|authorization|password|secret|token)\s*[:=]\s*[^\s,;]+/giu, '[credential redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/gu, '[token redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[email redacted]')
    .replace(/(["'`])[^\n]*?\1/gu, '[quoted value redacted]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .slice(0, limit);
}

export interface EmailDiagnostics {
  breadcrumb(phase: EmailDiagnosticPhase): void;
  capture(error: unknown, source: EmailErrorSource, componentStack?: string): EmailDiagnosticReport;
  subscribe(listener: (report: EmailDiagnosticReport) => void): () => void;
  latest(): EmailDiagnosticReport | null;
  flush(): Promise<void>;
  persistence(): 'pending' | 'saved' | 'unavailable';
}

export function createEmailDiagnostics(options: {
  context?: TapFederatedSurfaceMountContext;
  storage?: Pick<MiniAppStorageApi, 'get' | 'set'>;
  now?: () => Date;
  randomId?: () => string;
} = {}): EmailDiagnostics {
  const now = options.now ?? (() => new Date());
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const breadcrumbs: DiagnosticBreadcrumb[] = [];
  const listeners = new Set<(report: EmailDiagnosticReport) => void>();
  let latest: EmailDiagnosticReport | null = null;
  let writes = Promise.resolve();
  let persistence: 'pending' | 'saved' | 'unavailable' = 'unavailable';
  let reportCount = 0;
  const seen = new WeakMap<object, EmailDiagnosticReport>();
  const breadcrumb = (phase: EmailDiagnosticPhase) => {
    breadcrumbs.push({ at: now().toISOString(), phase });
    if (breadcrumbs.length > maximumBreadcrumbs) breadcrumbs.shift();
  };
  return {
    breadcrumb,
    latest: () => latest,
    persistence: () => persistence,
    flush: () => writes,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    capture(error, source, componentStack = '') {
      if (reportCount >= maximumReports && latest) return latest;
      if (typeof error === 'object' && error !== null) {
        const previous = seen.get(error);
        if (previous) return previous;
      }
      breadcrumb('surface.error');
      reportCount += 1;
      const context = options.context;
      const report: EmailDiagnosticReport = {
        schemaVersion: 1,
        id: randomId(),
        capturedAt: now().toISOString(),
        build: typeof __TAP_EMAIL_BUILD__ === 'undefined'
          ? { revision: 'development', dirty: true, version: 'development', sdkVersion: 'unknown' }
          : __TAP_EMAIL_BUILD__,
        surface: context ? {
          packageId: context.packageId, releaseId: context.releaseId,
          installationId: context.installationId, contributionId: context.contributionId,
          instanceId: context.instanceId,
        } : null,
        source,
        error: {
          name: error instanceof Error ? sanitizeDiagnosticText(error.name, 80) : 'NonErrorThrown',
          message: error instanceof Error ? sanitizeDiagnosticText(error.message) : 'A non-Error value was thrown (details omitted).',
          stack: error instanceof Error ? sanitizeDiagnosticText((error.stack ?? '').split('\n').slice(1, 13).join('\n'), 4_096) : '',
          componentStack: sanitizeDiagnosticText(componentStack, 4_096),
        },
        breadcrumbs: breadcrumbs.map(entry => ({ ...entry })),
      };
      if (typeof error === 'object' && error !== null) seen.set(error, report);
      latest = report;
      const storage = options.storage;
      if (storage) {
        persistence = 'pending';
        writes = writes.then(async () => {
          // The host owns scope and revision checks. Retry conflicts from another surface.
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              const current = await storage.get(diagnosticsAddress);
              const previous = Array.isArray(current.value) ? current.value.slice(-(maximumReports - 1)) : [];
              await storage.set({ ...diagnosticsAddress, expectedRevision: current.revision, value: [...previous, report] });
              if (latest === report) persistence = 'saved';
              return;
            } catch {
              if (attempt === 2 && latest === report) persistence = 'unavailable';
            }
          }
        });
      }
      for (const listener of listeners) {
        try { listener(report); } catch { /* Reporting must not cause another app failure. */ }
      }
      return report;
    },
  };
}
