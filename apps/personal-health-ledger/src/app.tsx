import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Badge,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  H1,
  H2,
  H3,
  Icon,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  MiniAppStatusBar,
  NativeSelect,
  Progress,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@theaiplatform/miniapp-sdk/ui';
import { sdk } from '@theaiplatform/miniapp-sdk/sdk';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Beaker,
  BookOpen,
  Box,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardList,
  Download,
  FileHeart,
  FileText,
  FlaskConical,
  HeartPulse,
  History,
  LockKeyhole,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Trash2,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  addSpecialistRun,
  clinicianSummary,
  connectSpecialist,
  createLedger,
  deleteEntity,
  estimateRunOut,
  estimateRunOutDate,
  parseLedger,
  replaceLedger,
  serializeLedger,
  updateItemStatus,
  updateOrderStatus,
  withRole,
  type LedgerState,
  type OrderStatus,
  type SpecialistTask,
} from './domain';
import { EntryDialog, type EntryKind } from './entry-dialog';
import { importAdministrationsCsv, serializeAdministrationsCsv } from './csv';
import {
  clearPreviewLedger,
  loadLedger,
  saveLedger,
  StorageConflictError,
} from './storage';
import {
  buildSpecialistPrompt,
  GROK_MODEL_PREFERENCE,
  installHealthSpecialist,
  runHealthSpecialist,
} from './specialist';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});
const numberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});
const todayIso = (): string => new Date().toISOString().slice(0, 10);
const formatDate = (value: string): string =>
  value ? dateFormatter.format(new Date(`${value}T12:00:00`)) : 'Not recorded';
const formatDateTime = (value: string): string =>
  value ? dateTimeFormatter.format(new Date(value)) : 'Not recorded';
const titleCase = (value: string): string =>
  value
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
const formatOutcomeValue = (
  outcome: LedgerState['outcomes'][number],
): string =>
  outcome.unit === 'score/10'
    ? `${numberFormatter.format(outcome.value)}/10`
    : `${numberFormatter.format(outcome.value)} ${outcome.unit}`;
const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
const httpUrl = /^https?:\/\//i;
const download = (name: string, value: string, type: string): void => {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

const NAVIGATION = [
  { value: 'overview', label: 'Today', icon: HeartPulse },
  { value: 'outcomes', label: 'Journey', icon: TrendingUp },
  { value: 'regimen', label: 'Plan', icon: ClipboardList },
  { value: 'inventory', label: 'Supply', icon: Box },
  { value: 'research', label: 'Research', icon: BookOpen },
  { value: 'reports', label: 'Share', icon: FileHeart },
] as const;

const PAGE_COPY: Record<
  string,
  {
    readonly eyebrow: string;
    readonly title: string;
    readonly description: string;
  }
> = {
  overview: {
    eyebrow: 'Your day',
    title: 'Today',
    description:
      'Record how you feel, what happened, and anything that needs attention.',
  },
  regimen: {
    eyebrow: 'Your plan',
    title: 'Plan & Schedule',
    description:
      'Keep intended schedules clear and separate from what actually happened.',
  },
  inventory: {
    eyebrow: 'Your supply',
    title: 'Supply & Orders',
    description:
      'Know what remains, what may run out, and where each container came from.',
  },
  outcomes: {
    eyebrow: 'Over time',
    title: 'Your Journey',
    description:
      'See feelings, measurements, events, and regimen changes together without assuming cause.',
  },
  research: {
    eyebrow: 'Evidence & reflection',
    title: 'Research & Questions',
    description:
      'Investigate an item, review your record, or prepare a focused question.',
  },
  reports: {
    eyebrow: 'Private sharing',
    title: 'Share & Export',
    description:
      'Prepare useful context for a conversation or take a private copy of your data.',
  },
};

interface AppProps {
  readonly preview?: boolean;
  readonly context?: TapFederatedSurfaceMountContext;
}

interface DialogState {
  readonly kind: EntryKind;
  readonly itemId?: string;
  readonly lotId?: string;
}

interface ConfirmationRequest {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly tone?: 'default' | 'destructive';
  readonly onConfirm: () => void;
}

type RequestConfirmation = (request: ConfirmationRequest) => void;

const closedDialog: DialogState = { kind: null };

export function HealthLedgerApp({ preview = false, context }: AppProps) {
  const [state, setState] = useState<LedgerState | null>(null);
  const stateRef = useRef<LedgerState | null>(null);
  const revisionRef = useRef<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(closedDialog);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState(() => {
    const hash = globalThis.location?.hash.replace('#', '') ?? '';
    return NAVIGATION.some(item => item.value === hash) ? hash : 'overview';
  });
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void loadLedger(preview)
      .then(loadedLedger => {
        if (cancelled) return;
        revisionRef.current = loadedLedger.revision;
        stateRef.current = loadedLedger.state;
        setState(loadedLedger.state);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : 'The ledger could not be loaded.',
          );
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [preview]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!preview) return;
    window.__HEALTH_LEDGER_PREVIEW__ = {
      setRole(role) {
        setState(current => (current ? withRole(current, role) : current));
      },
      reset() {
        clearPreviewLedger();
        revisionRef.current = null;
        setState(null);
        setActiveTab('overview');
        globalThis.history?.replaceState(null, '', '#overview');
      },
    };
    return () => {
      delete window.__HEALTH_LEDGER_PREVIEW__;
    };
  }, [preview]);

  const commit = useCallback(
    async (next: LedgerState, message: string): Promise<string | null> => {
      setSaving(true);
      setError(null);
      try {
        const revision = await saveLedger(next, preview, revisionRef.current);
        revisionRef.current = revision;
        stateRef.current = next;
        setState(next);
        setNotice(message);
      } catch (cause) {
        const saveError =
          cause instanceof StorageConflictError
            ? 'This ledger changed in another session. Reload it before saving again.'
            : cause instanceof Error
              ? cause.message
              : 'The change could not be saved.';
        setError(saveError);
        setSaving(false);
        return saveError;
      }
      if (context) {
        try {
          await context.events.publish('ledger.changed', {
            instanceId: context.instanceId,
            auditCount: next.audit.length,
          });
        } catch (cause) {
          setError(
            `The record was saved, but TAP could not publish its change event. ${cause instanceof Error ? cause.message : 'Retry after checking the host connection.'}`,
          );
        }
      }
      setSaving(false);
      return null;
    },
    [context, preview],
  );

  const mutate = useCallback(
    async (
      operation: (current: LedgerState) => LedgerState,
      message: string,
    ): Promise<string | null> => {
      const current = stateRef.current;
      if (!current) return 'The ledger is not available. Reload and try again.';
      try {
        return await commit(operation(current), message);
      } catch (cause) {
        const operationError =
          cause instanceof Error ? cause.message : 'The operation failed.';
        setError(operationError);
        return operationError;
      }
    },
    [commit],
  );

  const reload = useCallback(() => {
    setLoaded(false);
    setError(null);
    void loadLedger(preview)
      .then(loadedLedger => {
        revisionRef.current = loadedLedger.revision;
        setState(loadedLedger.state);
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'The ledger could not be reloaded.',
        ),
      )
      .finally(() => setLoaded(true));
  }, [preview]);

  const changeTab = useCallback((next: string) => {
    setActiveTab(next);
    globalThis.history?.replaceState(null, '', `#${next}`);
  }, []);

  if (!loaded) return <LoadingScreen />;
  if (!state) {
    return (
      <Onboarding
        error={error}
        saving={saving}
        onCreate={async (ownerLabel, jurisdiction) => {
          try {
            const commitError = await commit(
              createLedger(ownerLabel, jurisdiction),
              'Private ledger created',
            );
            if (!commitError) window.scrollTo({ top: 0, behavior: 'auto' });
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : 'The ledger could not be created.',
            );
          }
        }}
      />
    );
  }

  const readOnly = state.role === 'viewer';
  const page = PAGE_COPY[activeTab] ?? PAGE_COPY.overview!;
  const openDialog = (
    kind: Exclude<EntryKind, null>,
    itemId?: string,
    lotId?: string,
  ) =>
    setDialog({
      kind,
      ...(itemId ? { itemId } : {}),
      ...(lotId ? { lotId } : {}),
    });

  return (
    <Tabs
      value={activeTab}
      onValueChange={changeTab}
      className="app-shell"
      data-component="HealthLedgerApp"
    >
      <a className="skip-link" href="#main-content">
        Skip to Content
      </a>
      <aside className="sidebar" aria-label="Ledger navigation">
        <div className="brand-lockup">
          <span className="brand-symbol">
            <Icon icon={HeartPulse} size="md" aria-hidden="true" />
          </span>
          <div className="brand-copy">
            <strong>Health Ledger</strong>
            <span>Personal & private</span>
          </div>
        </div>
        <TabsList
          className="side-navigation"
          aria-label="Health ledger sections"
        >
          {NAVIGATION.map(item => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="nav-item"
            >
              <Icon icon={item.icon} size="sm" aria-hidden="true" />
              <span>{item.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="sidebar-spacer" />
        <div className="profile-panel">
          <span className="profile-avatar">
            <Icon icon={UserRound} size="sm" aria-hidden="true" />
          </span>
          <div className="profile-copy">
            <strong>{state.ownerLabel}</strong>
            <span>{readOnly ? 'Viewer access' : 'Ledger owner'}</span>
          </div>
          <Badge variant={readOnly ? 'outline' : 'secondary'}>
            {readOnly ? 'View' : 'Owner'}
          </Badge>
        </div>
      </aside>

      <div className="app-main">
        <header className="page-header">
          <div className="page-heading">
            <span className="page-eyebrow">{page.eyebrow}</span>
            <H1>{page.title}</H1>
            <p>{page.description}</p>
          </div>
          <ButtonGroup className="header-actions">
            {preview ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void commit(
                    withRole(state, readOnly ? 'owner' : 'viewer'),
                    readOnly
                      ? 'Owner preview enabled'
                      : 'Read-only preview enabled',
                  )
                }
              >
                {readOnly ? 'Preview as Owner' : 'Preview as Viewer'}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={reload}
              aria-label="Reload ledger"
            >
              <Icon icon={RefreshCw} size="sm" aria-hidden="true" />
            </Button>
            <Button
              disabled={readOnly || saving}
              size="sm"
              onClick={() => setQuickAddOpen(true)}
            >
              <Icon icon={Plus} size="sm" aria-hidden="true" /> Quick Add
            </Button>
          </ButtonGroup>
        </header>

        <div className="feedback-region" aria-live="polite">
          {error ? (
            <Alert variant="destructive" className="feedback-alert">
              <Icon icon={AlertCircle} size="sm" aria-hidden="true" />
              <AlertTitle>Couldn’t Save This Change</AlertTitle>
              <AlertDescription>
                {error}{' '}
                <Button variant="link" onClick={() => setError(null)}>
                  Dismiss
                </Button>
              </AlertDescription>
            </Alert>
          ) : notice ? (
            <div className="success-banner" role="status">
              <span>
                <Icon icon={Check} size="sm" aria-hidden="true" />
              </span>
              <div>
                <strong>{notice}</strong>
              </div>
            </div>
          ) : null}
        </div>

        <main id="main-content" className="content-area">
          <TabsContent value="overview" className="page-panel">
            <OverviewPage
              state={state}
              readOnly={readOnly}
              openDialog={openDialog}
              navigate={changeTab}
              mutate={mutate}
              requestConfirmation={setConfirmation}
            />
          </TabsContent>
          <TabsContent value="regimen" className="page-panel">
            <RegimenPage
              state={state}
              readOnly={readOnly}
              openDialog={openDialog}
              mutate={mutate}
              requestConfirmation={setConfirmation}
            />
          </TabsContent>
          <TabsContent value="inventory" className="page-panel">
            <InventoryPage
              state={state}
              readOnly={readOnly}
              openDialog={openDialog}
              mutate={mutate}
              requestConfirmation={setConfirmation}
            />
          </TabsContent>
          <TabsContent value="outcomes" className="page-panel">
            <OutcomesPage
              state={state}
              readOnly={readOnly}
              openDialog={openDialog}
              mutate={mutate}
              requestConfirmation={setConfirmation}
            />
          </TabsContent>
          <TabsContent value="research" className="page-panel">
            <ResearchPage
              state={state}
              readOnly={readOnly}
              openDialog={openDialog}
              preview={preview}
              context={context}
              mutate={mutate}
              requestConfirmation={setConfirmation}
            />
          </TabsContent>
          <TabsContent value="reports" className="page-panel">
            <ReportsPage
              state={state}
              readOnly={readOnly}
              preview={preview}
              context={context}
              importRef={importRef}
              onImported={next =>
                mutate(
                  current => replaceLedger(current, next),
                  'Validated archive imported',
                )
              }
              onCsvImported={csv =>
                mutate(
                  current => importAdministrationsCsv(current, csv),
                  'Validated administration CSV imported',
                )
              }
              requestConfirmation={setConfirmation}
            />
          </TabsContent>
        </main>
        <MiniAppStatusBar className="app-statusbar">
          <span>
            <span
              className={`status-dot${saving ? ' status-dot-saving' : ''}`}
            />
            {saving ? 'Saving…' : 'All changes saved'}
          </span>
        </MiniAppStatusBar>
      </div>

      <EntryDialog
        kind={dialog.kind}
        state={state}
        {...(dialog.itemId ? { targetItemId: dialog.itemId } : {})}
        {...(dialog.lotId ? { targetLotId: dialog.lotId } : {})}
        onClose={() => setDialog(closedDialog)}
        onSubmit={mutate}
      />
      <QuickAddDialog
        open={quickAddOpen}
        hasItems={Boolean(state.items.length)}
        onDismiss={() => setQuickAddOpen(false)}
        onChoose={kind => {
          setQuickAddOpen(false);
          openDialog(kind);
        }}
      />
      <ConfirmationDialog
        request={confirmation}
        onDismiss={() => setConfirmation(null)}
      />
    </Tabs>
  );
}

function ConfirmationDialog({
  request,
  onDismiss,
}: {
  readonly request: ConfirmationRequest | null;
  readonly onDismiss: () => void;
}) {
  return (
    <AlertDialog
      open={Boolean(request)}
      onOpenChange={open => {
        if (!open) onDismiss();
      }}
    >
      <AlertDialogContent className="confirmation-dialog">
        <span className="confirmation-icon" aria-hidden="true">
          <Icon icon={AlertTriangle} size="md" />
        </span>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {request?.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Current Data</AlertDialogCancel>
          <AlertDialogAction
            className={
              request?.tone === 'destructive'
                ? 'confirmation-action-destructive'
                : undefined
            }
            onClick={() => {
              request?.onConfirm();
              onDismiss();
            }}
          >
            {request?.actionLabel ?? 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function QuickAddDialog({
  open,
  hasItems,
  onDismiss,
  onChoose,
}: {
  readonly open: boolean;
  readonly hasItems: boolean;
  readonly onDismiss: () => void;
  readonly onChoose: (
    kind:
      | 'check-in'
      | 'outcome'
      | 'administration'
      | 'confounder'
      | 'adverse',
  ) => void;
}) {
  const choices = [
    {
      kind: 'check-in' as const,
      icon: HeartPulse,
      title: 'How I Feel',
      description: 'Add a 0–10 check-in to your journey.',
      requiresItem: false,
    },
    {
      kind: 'outcome' as const,
      icon: TrendingUp,
      title: 'Measurement or Lab',
      description: 'Record a value, unit, source, and reference range.',
      requiresItem: false,
    },
    {
      kind: 'administration' as const,
      icon: CalendarClock,
      title: 'What I Took',
      description: 'Record an observed administration or variation.',
      requiresItem: true,
    },
    {
      kind: 'confounder' as const,
      icon: Activity,
      title: 'What Else Happened',
      description: 'Add illness, sleep, travel, diet, or training context.',
      requiresItem: false,
    },
    {
      kind: 'adverse' as const,
      icon: AlertTriangle,
      title: 'Safety Event',
      description: 'Document a reaction linked to a tracked item.',
      requiresItem: true,
    },
  ];
  return (
    <Dialog open={open} onOpenChange={next => !next && onDismiss()}>
      <DialogContent className="quick-add-dialog">
        <DialogHeader>
          <DialogTitle>What Would You Like to Record?</DialogTitle>
          <DialogDescription>
            Choose the smallest entry that captures what changed.
          </DialogDescription>
        </DialogHeader>
        <div className="quick-add-grid">
          {choices.map(choice => (
            <button
              key={choice.kind}
              type="button"
              className="quick-add-option"
              disabled={choice.requiresItem && !hasItems}
              onClick={() => onChoose(choice.kind)}
            >
              <span>
                <Icon icon={choice.icon} size="sm" aria-hidden="true" />
              </span>
              <div>
                <strong>{choice.title}</strong>
                <small>
                  {choice.requiresItem && !hasItems
                    ? 'Add an item to your plan first.'
                    : choice.description}
                </small>
              </div>
              <Icon icon={ChevronRight} size="sm" aria-hidden="true" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen" aria-busy="true">
      <span className="loading-mark">
        <Icon icon={HeartPulse} size="lg" aria-hidden="true" />
      </span>
      <div>
        <H2>Opening Your Ledger</H2>
        <p>Loading private records…</p>
      </div>
      <Progress value={42} />
    </main>
  );
}

function Onboarding({
  error,
  saving,
  onCreate,
}: {
  readonly error: string | null;
  readonly saving: boolean;
  readonly onCreate: (owner: string, jurisdiction: string) => Promise<void>;
}) {
  return (
    <main className="onboarding-page">
      <section className="onboarding-story">
        <span className="onboarding-brand">
          <Icon icon={HeartPulse} size="lg" aria-hidden="true" />
        </span>
        <div>
          <span className="page-eyebrow">Personal Health Ledger</span>
          <H1>Understand your health journey, one check-in at a time.</H1>
        </div>
        <p>
          Record how you feel, what you took, and what changed. See the whole
          story over time and bring clearer questions to your next conversation.
        </p>
        <div className="onboarding-points">
          <Feature
            icon={HeartPulse}
            title="Check in quickly"
            text="Capture mood, energy, sleep, pain, recovery, or a symptom on a consistent scale."
          />
          <Feature
            icon={History}
            title="See what changed"
            text="Feelings, measurements, context, and regimen changes share one timeline."
          />
          <Feature
            icon={Stethoscope}
            title="Know your next step"
            text="Spot missing check-ins, supply concerns, and questions worth discussing."
          />
        </div>
      </section>
      <Card className="onboarding-card">
        <CardHeader>
          <span className="step-label">Private by default</span>
          <CardTitle>Create Your Private Ledger</CardTitle>
          <CardDescription>
            Start empty and add only what matters to you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="onboarding-form"
            autoComplete="off"
            onSubmit={event => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void onCreate(
                String(data.get('owner') ?? ''),
                String(data.get('jurisdiction') ?? ''),
              );
            }}
          >
            <label htmlFor="ledger-name">
              Ledger Name <span aria-hidden="true">*</span>
            </label>
            <Input
              id="ledger-name"
              name="owner"
              autoComplete="off"
              required
              maxLength={80}
              placeholder="e.g. My health record…"
            />
            <label htmlFor="ledger-jurisdiction">
              Safety-Resource Jurisdiction <span aria-hidden="true">*</span>
            </label>
            <NativeSelect
              id="ledger-jurisdiction"
              name="jurisdiction"
              required
              defaultValue="US"
            >
              <option value="US">United States</option>
              <option value="CA">Canada</option>
              <option value="GB">United Kingdom</option>
              <option value="AU">Australia</option>
              <option value="other">Other</option>
            </NativeSelect>
            <p className="field-help">
              Used to show appropriate official emergency and safety-reporting
              resources.
            </p>
            {error ? (
              <p className="inline-error" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" size="lg" disabled={saving}>
              {saving ? 'Creating Ledger…' : 'Create Private Ledger'}{' '}
              {!saving ? (
                <Icon icon={ArrowRight} size="sm" aria-hidden="true" />
              ) : null}
            </Button>
          </form>
          <div className="onboarding-security">
            <Icon icon={ShieldCheck} size="sm" aria-hidden="true" />
            <span>
              Packaged records use TAP’s workspace-and-package-scoped storage.
              Browser preview data stays separate.
            </span>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function Feature({
  icon,
  title,
  text,
}: {
  readonly icon: typeof Activity;
  readonly title: string;
  readonly text: string;
}) {
  return (
    <div className="feature-row">
      <span>
        <Icon icon={icon} size="sm" aria-hidden="true" />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}

interface PageCommonProps {
  readonly state: LedgerState;
  readonly readOnly: boolean;
  readonly openDialog: (
    kind: Exclude<EntryKind, null>,
    itemId?: string,
    lotId?: string,
  ) => void;
}

function OverviewPage({
  state,
  readOnly,
  openDialog,
  navigate,
  mutate,
  requestConfirmation,
}: PageCommonProps & {
  readonly navigate: (tab: string) => void;
  readonly mutate: Mutation;
  readonly requestConfirmation: RequestConfirmation;
}) {
  const today = todayIso();
  const todayAdministrations = state.administrations.filter(
    entry => entry.actualAt.slice(0, 10) === today,
  );
  const todayOutcomes = state.outcomes.filter(
    outcome => outcome.occurredAt.slice(0, 10) === today,
  );
  const todayContext = state.confounders.filter(
    record => record.occurredAt.slice(0, 10) === today,
  );
  const todaySafety = state.adverseEvents.filter(
    record => record.occurredAt.slice(0, 10) === today,
  );
  const todayCheckIns = todayOutcomes.filter(
    outcome => outcome.source === 'self-reported check-in',
  );
  const latestCheckIn = todayCheckIns.toSorted((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt),
  )[0];
  const activeItems = state.items.filter(item => item.status === 'active');
  const expiringLots = state.lots.filter(
    lot =>
      lot.expiresOn &&
      lot.expiresOn <=
        new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
  );
  const lowLots = state.lots.filter(
    lot =>
      lot.quantityReceived > 0 &&
      lot.currentQuantity / lot.quantityReceived <= 0.2,
  );
  const runningOutLots = state.lots.filter(lot => {
    const projected = estimateRunOutDate(state, lot);
    return (
      projected !== null &&
      projected <=
        new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
    );
  });
  const inventoryAttention = new Set([
    ...expiringLots.map(lot => lot.id),
    ...lowLots.map(lot => lot.id),
    ...runningOutLots.map(lot => lot.id),
  ]).size;
  const attentionCount =
    inventoryAttention +
    state.adverseEvents.filter(event => event.severity === 'serious').length;
  const story = [
    ...todayAdministrations.map(entry => ({
      id: entry.id,
      at: entry.actualAt,
      type: 'administration' as const,
      entityType: 'administration' as const,
      badge: 'Administration',
      title:
        state.items.find(item => item.id === entry.itemId)?.name ??
        'Unknown item',
      detail: `${titleCase(entry.status)} · ${numberFormatter.format(entry.dose)} ${entry.unit} · ${entry.route}`,
    })),
    ...todayOutcomes.map(outcome => ({
      id: outcome.id,
      at: outcome.occurredAt,
      type: 'outcome' as const,
      entityType: 'outcome' as const,
      badge:
        outcome.source === 'self-reported check-in' ? 'Check-In' : 'Outcome',
      title: outcome.name,
      detail: `${formatOutcomeValue(outcome)}${outcome.notes ? ` · ${outcome.notes}` : ''}`,
    })),
    ...todayContext.map(record => ({
      id: record.id,
      at: record.occurredAt,
      type: 'context' as const,
      entityType: 'confounder' as const,
      badge: 'Context',
      title: titleCase(record.kind),
      detail: record.note,
    })),
    ...todaySafety.map(record => ({
      id: record.id,
      at: record.occurredAt,
      type: 'safety' as const,
      entityType: 'adverse-event' as const,
      badge: 'Safety',
      title: `${titleCase(record.severity)} safety event`,
      detail: record.description,
    })),
  ].toSorted((a, b) => b.at.localeCompare(a.at));

  const nextSteps = [
    ...(!state.items.length
      ? [
          {
            id: 'plan',
            title: 'Add your first plan',
            detail:
              'Start with one medication, supplement, vitamin, peptide, or other item you want to track.',
            label: 'Open Plan',
            action: () => navigate('regimen'),
          },
        ]
      : []),
    ...(inventoryAttention
      ? [
          {
            id: 'supply',
            title: `${inventoryAttention} ${inventoryAttention === 1 ? 'supply record needs' : 'supply records need'} attention`,
            detail:
              'Review low stock, projected run-out, or an approaching expiration.',
            label: 'Review Supply',
            action: () => navigate('inventory'),
          },
        ]
      : []),
    ...(attentionCount > inventoryAttention
      ? [
          {
            id: 'safety',
            title: 'A serious safety event is in your journey',
            detail:
              'Review the record and use appropriate professional or emergency support for serious or worsening symptoms.',
            label: 'Open Journey',
            action: () => navigate('outcomes'),
          },
        ]
      : []),
  ];
  return (
    <div className="today-layout">
      <section className="today-primary">
        <Card className="check-in-card">
          <CardHeader className="card-header-row">
            <div>
              <span className="section-kicker">Daily Check-In</span>
              <CardTitle>
                {latestCheckIn
                  ? `${latestCheckIn.name}: ${numberFormatter.format(latestCheckIn.value)}/10`
                  : 'How are you feeling today?'}
              </CardTitle>
              <CardDescription>
                {latestCheckIn
                  ? latestCheckIn.notes ||
                    `Recorded ${formatDateTime(latestCheckIn.occurredAt)}. Add another signal only when it helps tell the story.`
                  : 'Track one signal consistently—such as mood, energy, sleep, pain, recovery, or a symptom.'}
              </CardDescription>
            </div>
            <Button
              disabled={readOnly}
              onClick={() => openDialog('check-in')}
            >
              <Icon icon={HeartPulse} size="sm" aria-hidden="true" /> Check In
            </Button>
          </CardHeader>
        </Card>

        <Card className="today-card">
          <CardHeader className="card-header-row">
            <div>
              <span className="section-kicker">Today’s Story</span>
              <CardTitle>What You Recorded</CardTitle>
              <CardDescription>
                Feelings, context, safety notes, and observed administrations
                appear together.
              </CardDescription>
            </div>
            {story.length ? (
              <Button variant="ghost" onClick={() => navigate('outcomes')}>
                View Journey{' '}
                <Icon icon={ChevronRight} size="sm" aria-hidden="true" />
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {story.length ? (
              <div className="activity-list">
                {story.map(event => (
                  <div className="activity-row" key={`${event.type}-${event.id}`}>
                    <span className="activity-time">
                      {timeFormatter.format(new Date(event.at))}
                    </span>
                    <span className={`event-marker event-${event.type}`}>
                      <Icon
                        icon={
                          event.type === 'outcome'
                            ? HeartPulse
                            : event.type === 'context'
                              ? Activity
                              : event.type === 'safety'
                                ? AlertTriangle
                                : Check
                        }
                        size="xs"
                        aria-hidden="true"
                      />
                    </span>
                    <div className="activity-copy">
                      <strong>{event.title}</strong>
                      <span>{event.detail}</span>
                    </div>
                    <Badge variant="outline">{event.badge}</Badge>
                    {!readOnly ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete ${event.title}`}
                        onClick={() =>
                          requestConfirmation({
                            title: `Delete ${event.title}?`,
                            description:
                              event.entityType === 'administration'
                                ? 'This removes the observed event and restores any linked inventory quantity.'
                                : 'This removes the record from your journey. This action cannot be undone.',
                            actionLabel: 'Delete Record',
                            tone: 'destructive',
                            onConfirm: () =>
                              void mutate(
                                current =>
                                  deleteEntity(
                                    current,
                                    event.entityType,
                                    event.id,
                                  ),
                                event.entityType === 'administration'
                                  ? 'Administration deleted and inventory restored'
                                  : 'Journey record deleted',
                              ),
                          })
                        }
                      >
                        <Icon icon={Trash2} size="sm" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={CalendarClock}
                title="Nothing Recorded Today"
                description="Start with how you feel. Add administrations or context only when they happened."
              />
            )}
          </CardContent>
        </Card>
      </section>

      <aside className="today-secondary" aria-label="Next steps and safety">
        <Card className="next-steps-card">
          <CardHeader>
            <span className="section-kicker">What’s Next</span>
            <CardTitle>Your Next Steps</CardTitle>
            <CardDescription>
              Based only on records you have entered.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {nextSteps.length ? (
              <div className="next-step-list">
                {nextSteps.map(step => (
                  <div className="next-step" key={step.id}>
                    <span>
                      <Icon
                        icon={step.id === 'safety' ? AlertTriangle : ArrowRight}
                        size="xs"
                        aria-hidden="true"
                      />
                    </span>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.detail}</p>
                      <Button
                        variant="link"
                        disabled={readOnly && step.id === 'check-in'}
                        onClick={step.action}
                      >
                        {step.label}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                icon={Check}
                title="You’re Caught Up"
                description="No missing daily check-in, supply concern, or serious safety record needs attention."
              />
            )}
            {state.items.length ? (
              <div className="plan-context">
                <span>{activeItems.length}</span>
                <div>
                  <strong>
                    Active {activeItems.length === 1 ? 'plan' : 'plans'}
                  </strong>
                  <small>{state.items.length} tracked in total</small>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('regimen')}
                >
                  Review
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
        <SafetyPanel jurisdiction={state.jurisdiction} />
      </aside>
    </div>
  );
}

function SafetyPanel({ jurisdiction }: { readonly jurisdiction: string }) {
  const us = jurisdiction === 'US';
  return (
    <Card className="safety-panel">
      <CardHeader>
        <span className="safety-shield">
          <Icon icon={ShieldCheck} size="sm" aria-hidden="true" />
        </span>
        <div>
          <CardTitle>Urgent Safety</CardTitle>
          <CardDescription>
            Don’t wait for an app or agent during an emergency.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <p>
          For serious or worsening symptoms, contact local emergency services
          now.{us ? ' In the U.S., call 911.' : ''}
        </p>
        {us ? (
          <div className="resource-links">
            <a href="https://www.poison.org/" target="_blank" rel="noreferrer">
              Poison Control{' '}
              <Icon icon={ArrowRight} size="xs" aria-hidden="true" />
            </a>
            <a
              href="https://www.fda.gov/safety/medwatch-fda-safety-information-and-adverse-event-reporting-program"
              target="_blank"
              rel="noreferrer"
            >
              FDA MedWatch{' '}
              <Icon icon={ArrowRight} size="xs" aria-hidden="true" />
            </a>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RegimenPage({
  state,
  readOnly,
  openDialog,
  mutate,
  requestConfirmation,
}: PageCommonProps & {
  readonly mutate: Mutation;
  readonly requestConfirmation: RequestConfirmation;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const filteredItems = useMemo(
    () =>
      state.items.filter(item => {
        const matchesQuery =
          `${item.name} ${item.canonicalName} ${item.category}`
            .toLowerCase()
            .includes(query.toLowerCase());
        return matchesQuery && (filter === 'all' || item.status === filter);
      }),
    [filter, query, state.items],
  );
  return (
    <>
      <PageToolbar>
        <div className="search-field">
          <Icon icon={Search} size="sm" aria-hidden="true" />
          <Input
            aria-label="Search plan"
            name="plan-search"
            autoComplete="off"
            placeholder="Search plan…"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </div>
        <NativeSelect
          aria-label="Filter regimen by status"
          name="plan-status-filter"
          value={filter}
          onChange={event => setFilter(event.target.value)}
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="planned">Planned</option>
          <option value="paused">Paused</option>
          <option value="discontinued">Discontinued</option>
        </NativeSelect>
        <Button disabled={readOnly} onClick={() => openDialog('item')}>
          <Icon icon={Plus} size="sm" aria-hidden="true" /> Add Item
        </Button>
      </PageToolbar>
      {filteredItems.length ? (
        <div className="regimen-grid">
          {filteredItems.map(item => {
            const schedule = item.schedules.at(-1);
            return (
              <Card className="regimen-card" key={item.id}>
                <CardHeader>
                  <div className="regimen-title-row">
                    <CategoryMark category={item.category} />
                    <div className="regimen-title">
                      <CardTitle>{item.name}</CardTitle>
                      <CardDescription>
                        {item.canonicalName !== item.name
                          ? item.canonicalName
                          : titleCase(item.category)}
                      </CardDescription>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="regimen-details">
                    <Detail
                      label="Current Plan"
                      value={
                        schedule
                          ? `${numberFormatter.format(schedule.dose)} ${schedule.unit} · ${schedule.cadence}`
                          : 'No active schedule'
                      }
                    />
                    <Detail
                      label="Route & Form"
                      value={
                        [item.route, item.form].filter(Boolean).join(' · ') ||
                        'Not recorded'
                      }
                    />
                    <Detail
                      label="Regulatory Status"
                      value={item.regulatoryStatus || 'Not recorded'}
                    />
                    <Detail
                      label="Instruction Source"
                      value={
                        schedule?.source
                          ? titleCase(schedule.source)
                          : 'Not recorded'
                      }
                    />
                  </div>
                  <div className="regimen-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={readOnly}
                      onClick={() => openDialog('administration', item.id)}
                    >
                      Log What Happened
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={readOnly}
                      onClick={() => openDialog('schedule', item.id)}
                    >
                      Change Schedule
                    </Button>
                    <NativeSelect
                      aria-label={`Tracking status for ${item.name}`}
                      name={`tracking-status-${item.id}`}
                      disabled={readOnly}
                      value={item.status}
                      onChange={event =>
                        mutate(
                          current =>
                            updateItemStatus(
                              current,
                              item.id,
                              event.target
                                .value as LedgerState['items'][number]['status'],
                            ),
                          `${item.name} status updated`,
                        )
                      }
                    >
                      <option value="active">Active</option>
                      <option value="planned">Planned</option>
                      <option value="paused">Paused</option>
                      <option value="discontinued">Discontinued</option>
                    </NativeSelect>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={readOnly}
                      aria-label={`Delete ${item.name}`}
                      onClick={() =>
                        requestConfirmation({
                          title: `Delete ${item.name}?`,
                          description:
                            'This removes the item permanently. Items with linked inventory or administration history remain protected and cannot be deleted.',
                          actionLabel: 'Delete Item',
                          tone: 'destructive',
                          onConfirm: () =>
                            mutate(
                              current => deleteEntity(current, 'item', item.id),
                              'Item deleted',
                            ),
                        })
                      }
                    >
                      <Icon icon={Trash2} size="sm" aria-hidden="true" />
                    </Button>
                  </div>
                  {item.schedules.length > 1 ? (
                    <details className="schedule-history">
                      <summary>
                        <Icon icon={History} size="sm" aria-hidden="true" />{' '}
                        Schedule History
                      </summary>
                      {item.schedules.toReversed().map(version => (
                        <div key={version.id}>
                          <span>
                            {formatDate(version.effectiveFrom)}
                            {version.effectiveTo
                              ? ` – ${formatDate(version.effectiveTo)}`
                              : ' – Present'}
                          </span>
                          <strong>
                            {numberFormatter.format(version.dose)}{' '}
                            {version.unit} · {version.cadence}
                          </strong>
                        </div>
                      ))}
                    </details>
                  ) : null}
                  {item.statusHistory.length > 1 ? (
                    <details className="schedule-history">
                      <summary>
                        <Icon icon={History} size="sm" aria-hidden="true" />{' '}
                        Status History
                      </summary>
                      {item.statusHistory.toReversed().map(period => (
                        <div key={period.id}>
                          <span>
                            {formatDate(period.effectiveFrom)}
                            {period.effectiveTo
                              ? ` – ${formatDate(period.effectiveTo)}`
                              : ' – Present'}
                          </span>
                          <strong>{titleCase(period.status)}</strong>
                        </div>
                      ))}
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title={state.items.length ? 'No Plans Match' : 'Build Your Plan'}
          description={
            state.items.length
              ? 'Adjust your search or status filter.'
              : 'Add one item from a label, prescription, clinician instruction, or your own record.'
          }
          action={
            !readOnly && !state.items.length ? (
              <Button onClick={() => openDialog('item')}>
                <Icon icon={Plus} size="sm" aria-hidden="true" /> Add First Item
              </Button>
            ) : undefined
          }
        />
      )}
    </>
  );
}

type Mutation = (
  operation: (state: LedgerState) => LedgerState,
  message: string,
) => Promise<string | null>;

function InventoryPage({
  state,
  readOnly,
  openDialog,
  mutate,
  requestConfirmation,
}: PageCommonProps & {
  readonly mutate: Mutation;
  readonly requestConfirmation: RequestConfirmation;
}) {
  const expiring = state.lots.filter(
    lot =>
      lot.expiresOn &&
      lot.expiresOn <=
        new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  );
  return (
    <>
      <PageToolbar>
        <div className={`supply-status${expiring.length ? ' supply-status-alert' : ''}`}>
          <Icon
            icon={expiring.length ? AlertTriangle : PackageCheck}
            size="sm"
            aria-hidden="true"
          />
          <span>
            {expiring.length
              ? `${expiring.length} ${expiring.length === 1 ? 'lot expires' : 'lots expire'} within 30 days`
              : `${state.lots.length} ${state.lots.length === 1 ? 'lot' : 'lots'} tracked · no expiration within 30 days`}
          </span>
        </div>
        <ButtonGroup>
          <Button
            variant="outline"
            disabled={readOnly || !state.items.length}
            onClick={() => openDialog('order')}
          >
            <Icon icon={PackageCheck} size="sm" aria-hidden="true" /> Add Order
          </Button>
          <Button
            disabled={readOnly || !state.items.length}
            onClick={() => openDialog('lot')}
          >
            <Icon icon={Plus} size="sm" aria-hidden="true" /> Add Lot
          </Button>
        </ButtonGroup>
      </PageToolbar>
      <Card className="table-card">
        <CardHeader>
          <CardTitle>What You Have</CardTitle>
          <CardDescription>
            Current estimates reflect only confirmed user-entered quantities and
            administrations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.lots.length ? (
            <div className="inventory-table">
              <div className="table-header">
                <span>Item & Lot</span>
                <span>Remaining</span>
                <span>Expiration</span>
                <span>Estimate</span>
                <span>Actions</span>
              </div>
              {state.lots.map(lot => {
                const item = state.items.find(
                  candidate => candidate.id === lot.itemId,
                );
                const percent = lot.quantityReceived
                  ? Math.max(
                      0,
                      (lot.currentQuantity / lot.quantityReceived) * 100,
                    )
                  : 0;
                const doses = estimateRunOut(state, lot);
                const projected = estimateRunOutDate(state, lot);
                return (
                  <div className="inventory-row" key={lot.id}>
                    <div className="inventory-identity">
                      <CategoryMark category={item?.category ?? 'other'} />
                      <div>
                        <strong>{item?.name ?? 'Unknown item'}</strong>
                        <span>Lot {lot.lotNumber || 'Not recorded'}</span>
                      </div>
                    </div>
                    <div className="quantity-cell">
                      <strong>
                        {numberFormatter.format(lot.currentQuantity)} /{' '}
                        {numberFormatter.format(lot.quantityReceived)}{' '}
                        {lot.unit}
                      </strong>
                      <Progress value={percent} />
                    </div>
                    <span>{formatDate(lot.expiresOn)}</span>
                    <span>
                      {doses === null
                        ? 'Needs administration data'
                        : projected
                          ? `≈ ${doses} doses · ${formatDate(projected)}`
                          : `≈ ${doses} average logged doses`}
                    </span>
                    <div className="row-actions">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={readOnly}
                        onClick={() =>
                          openDialog('administration', lot.itemId, lot.id)
                        }
                      >
                        Log Use
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={readOnly}
                        onClick={() =>
                          openDialog('reconstitution', lot.itemId, lot.id)
                        }
                        aria-label={`Record reconstitution for lot ${lot.lotNumber || 'unnumbered'}`}
                      >
                        <Icon icon={Beaker} size="sm" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={readOnly}
                        aria-label={`Delete lot ${lot.lotNumber || 'unnumbered'}`}
                        onClick={() =>
                          requestConfirmation({
                            title: `Delete lot ${lot.lotNumber || 'without a number'}?`,
                            description:
                              'Lots with linked administrations, reconstitution records, or safety events remain protected until those records are removed.',
                            actionLabel: 'Delete Lot',
                            tone: 'destructive',
                            onConfirm: () =>
                              void mutate(
                                current => deleteEntity(current, 'lot', lot.id),
                                'Inventory lot deleted',
                              ),
                          })
                        }
                      >
                        <Icon icon={Trash2} size="sm" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Box}
              title="No Inventory Lots"
              description="Add each physical container separately to track provenance, expiration, and estimated quantity."
              action={
                !readOnly && state.items.length ? (
                  <Button onClick={() => openDialog('lot')}>
                    Add First Lot
                  </Button>
                ) : undefined
              }
            />
          )}
        </CardContent>
      </Card>
      {state.reconstitutions.length ? (
        <Card className="reconstitution-card">
          <CardHeader>
          <CardTitle>Reconstitution History</CardTitle>
            <CardDescription>
              Auditable confirmed inputs and transparent arithmetic—not
              preparation instructions.
            </CardDescription>
          </CardHeader>
          <CardContent className="reconstitution-list">
            {state.reconstitutions.map(record => {
              const item = state.items.find(
                candidate => candidate.id === record.itemId,
              );
              const lot = state.lots.find(
                candidate => candidate.id === record.lotId,
              );
              return (
                <Item key={record.id} className="reconstitution-row">
                  <span className="order-icon">
                    <Icon icon={Beaker} size="sm" aria-hidden="true" />
                  </span>
                  <ItemContent>
                    <ItemTitle>{item?.name ?? 'Unknown item'}</ItemTitle>
                    <ItemDescription>
                      {formatDateTime(record.occurredAt)} · Lot{' '}
                      {lot?.lotNumber || 'not recorded'} ·{' '}
                      {numberFormatter.format(record.labeledAmount)}{' '}
                      {record.labeledUnit} ÷{' '}
                      {numberFormatter.format(record.diluentVolumeMl)} mL ={' '}
                      {numberFormatter.format(record.resultingConcentration)}{' '}
                      {record.labeledUnit}/mL
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={readOnly}
                      aria-label={`Delete reconstitution record for ${item?.name ?? 'unknown item'}`}
                      onClick={() =>
                        requestConfirmation({
                          title: 'Delete this reconstitution record?',
                          description:
                            'This removes the confirmed-input calculation from the ledger. It does not change administration or lot quantities.',
                          actionLabel: 'Delete Record',
                          tone: 'destructive',
                          onConfirm: () =>
                            void mutate(
                              current =>
                                deleteEntity(
                                  current,
                                  'reconstitution',
                                  record.id,
                                ),
                              'Reconstitution record deleted',
                            ),
                        })
                      }
                    >
                      <Icon icon={Trash2} size="sm" aria-hidden="true" />
                    </Button>
                  </ItemActions>
                </Item>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
      <Card className="orders-card">
        <CardHeader>
          <CardTitle>Incoming & Past Orders</CardTitle>
          <CardDescription>
            Factual tracking only. The ledger never automatically reorders a
            product.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.orders.length ? (
            <div className="order-list">
              {state.orders.map(order => (
                <Item key={order.id} className="order-row">
                  <span className="order-icon">
                    <Icon icon={PackageCheck} size="sm" aria-hidden="true" />
                  </span>
                  <ItemContent>
                    <ItemTitle>{order.reference}</ItemTitle>
                    <ItemDescription>
                      {state.items.find(item => item.id === order.itemId)
                        ?.name ?? 'Unknown item'}{' '}
                      · {numberFormatter.format(order.quantity)} {order.unit} ·
                      Ordered {formatDate(order.orderedOn)}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <NativeSelect
                      aria-label={`Status for ${order.reference}`}
                      name={`order-status-${order.id}`}
                      value={order.status}
                      disabled={readOnly}
                      onChange={event =>
                        mutate(
                          current =>
                            updateOrderStatus(
                              current,
                              order.id,
                              event.target.value as OrderStatus,
                            ),
                          'Order status updated',
                        )
                      }
                    >
                      {[
                        'ordered',
                        'confirmed',
                        'shipped',
                        'delivered',
                        'partially-received',
                        'cancelled',
                        'returned',
                        'disputed',
                      ].map(status => (
                        <option key={status} value={status}>
                          {titleCase(status)}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={readOnly}
                      aria-label={`Delete order ${order.reference}`}
                      onClick={() =>
                        requestConfirmation({
                          title: `Delete order ${order.reference}?`,
                          description:
                            'This removes the shipment record. Inventory lots and administrations are not changed.',
                          actionLabel: 'Delete Order',
                          tone: 'destructive',
                          onConfirm: () =>
                            void mutate(
                              current =>
                                deleteEntity(current, 'order', order.id),
                              'Order deleted',
                            ),
                        })
                      }
                    >
                      <Icon icon={Trash2} size="sm" aria-hidden="true" />
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              icon={PackageCheck}
              title="No Orders Tracked"
              description="Add an order when you want a factual shipment and receipt history."
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function OutcomesPage({
  state,
  readOnly,
  openDialog,
  mutate,
  requestConfirmation,
}: PageCommonProps & {
  readonly mutate: Mutation;
  readonly requestConfirmation: RequestConfirmation;
}) {
  const [filter, setFilter] = useState('all');
  const timeline = useMemo(() => {
    const all = [
      ...state.outcomes.map(record => ({
        id: record.id,
        at: record.occurredAt,
        title: record.name,
        detail: `${formatOutcomeValue(record)}${record.notes ? ` · ${record.notes}` : ''}`,
        type: 'feeling' as const,
        kind:
          record.source === 'self-reported check-in'
            ? 'Check-In'
            : 'Measurement',
        entityType: 'outcome' as const,
      })),
      ...state.confounders.map(record => ({
        id: record.id,
        at: record.occurredAt,
        title: titleCase(record.kind),
        detail: record.note,
        type: 'context' as const,
        kind: 'Context',
        entityType: 'confounder' as const,
      })),
      ...state.administrations.map(record => ({
        id: record.id,
        at: record.actualAt,
        title:
          state.items.find(item => item.id === record.itemId)?.name ??
          'Unknown item',
        detail: `${titleCase(record.status)} · ${numberFormatter.format(record.dose)} ${record.unit} · ${record.route}${record.reaction ? ` · ${record.reaction}` : ''}`,
        type: 'regimen' as const,
        kind: 'Administration',
        entityType: 'administration' as const,
      })),
      ...state.adverseEvents.map(record => ({
        id: record.id,
        at: record.occurredAt,
        title:
          state.items.find(item => item.id === record.itemId)?.name ??
          'Safety event',
        detail: `${titleCase(record.severity)} · ${record.description}`,
        type: 'safety' as const,
        kind: 'Safety Event',
        entityType: 'adverse-event' as const,
      })),
      ...state.items.flatMap(item => [
        ...item.statusHistory.map(period => ({
          id: period.id,
          at: `${period.effectiveFrom}T12:00:00`,
          title: `${item.name} became ${period.status}`,
          detail: `Tracking status from ${formatDate(period.effectiveFrom)}${period.effectiveTo ? ` through ${formatDate(period.effectiveTo)}` : ''}`,
          type: 'regimen' as const,
          kind: 'Plan Change',
          entityType: null,
        })),
        ...item.schedules.slice(1).map(schedule => ({
          id: schedule.id,
          at: `${schedule.effectiveFrom}T12:00:00`,
          title: `${item.name} schedule changed`,
          detail: `${numberFormatter.format(schedule.dose)} ${schedule.unit} · ${schedule.cadence} · ${titleCase(schedule.source)}`,
          type: 'regimen' as const,
          kind: 'Schedule Change',
          entityType: null,
        })),
      ]),
    ].toSorted((a, b) => b.at.localeCompare(a.at));
    return filter === 'all' ? all : all.filter(event => event.type === filter);
  }, [filter, state]);
  return (
    <>
      <PageToolbar>
        <div className="association-note">
          <Icon icon={Sparkles} size="sm" aria-hidden="true" />
          <span>Timing can reveal patterns, but it does not establish cause.</span>
        </div>
        <ButtonGroup>
          <Button
            variant="outline"
            disabled={readOnly}
            onClick={() => openDialog('confounder')}
          >
            <Icon icon={Plus} size="sm" aria-hidden="true" /> Add Context
          </Button>
          <Button
            variant="outline"
            disabled={readOnly || !state.items.length}
            onClick={() => openDialog('adverse')}
          >
            <Icon icon={AlertTriangle} size="sm" aria-hidden="true" /> Safety
            Event
          </Button>
          <Button disabled={readOnly} onClick={() => openDialog('check-in')}>
            <Icon icon={HeartPulse} size="sm" aria-hidden="true" /> Check In
          </Button>
        </ButtonGroup>
      </PageToolbar>
      <Card className="trend-card journey-trends">
        <CardHeader>
          <CardTitle>Changes Over Time</CardTitle>
          <CardDescription>
            Each signal keeps its own unit. The ledger never combines unlike
            measurements into one score.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OutcomeVisualization state={state} />
        </CardContent>
      </Card>
      <Card className="timeline-card">
        <CardHeader className="card-header-row">
          <div>
            <CardTitle>Your Timeline</CardTitle>
            <CardDescription>
              A single history of feelings, context, administrations, safety
              notes, and plan changes.
            </CardDescription>
          </div>
          <NativeSelect
            aria-label="Filter journey timeline"
            name="journey-filter"
            value={filter}
            onChange={event => setFilter(event.target.value)}
          >
            <option value="all">Everything</option>
            <option value="feeling">Feelings & Measurements</option>
            <option value="regimen">Plan & Administrations</option>
            <option value="context">Life Context</option>
            <option value="safety">Safety Events</option>
          </NativeSelect>
        </CardHeader>
        <CardContent>
          {timeline.length ? (
            <div className="timeline-list">
              {timeline.map(event => (
                <div
                  className="timeline-event"
                  key={`${event.type}-${event.id}`}
                >
                  <div className="timeline-date">
                    <strong>{formatDateTime(event.at)}</strong>
                    <span>{event.kind}</span>
                  </div>
                  <span className={`timeline-marker marker-${event.type}`}>
                    <Icon
                      icon={
                        event.type === 'feeling'
                          ? HeartPulse
                          : event.type === 'regimen'
                            ? ClipboardList
                            : event.type === 'safety'
                              ? AlertTriangle
                              : Activity
                      }
                      size="xs"
                      aria-hidden="true"
                    />
                  </span>
                  <div className="timeline-copy">
                    <strong>{event.title}</strong>
                    <span>{event.detail}</span>
                  </div>
                  {event.entityType ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={readOnly}
                      aria-label={`Delete ${event.title}`}
                      onClick={() =>
                        requestConfirmation({
                          title: `Delete ${event.title}?`,
                          description:
                            event.entityType === 'administration'
                              ? 'This removes the observed event and restores any linked inventory quantity.'
                              : 'This permanently removes the record from your journey and cannot be undone.',
                          actionLabel: 'Delete Record',
                          tone: 'destructive',
                          onConfirm: () =>
                            void mutate(
                              current =>
                                deleteEntity(
                                  current,
                                  event.entityType,
                                  event.id,
                                ),
                              event.entityType === 'administration'
                                ? 'Administration deleted and inventory restored'
                                : 'Journey record deleted',
                            ),
                        })
                      }
                    >
                      <Icon icon={Trash2} size="sm" aria-hidden="true" />
                    </Button>
                  ) : (
                    <span className="timeline-preserved">Versioned</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={TrendingUp}
              title={filter === 'all' ? 'Your Journey Starts Here' : 'No Matching Records'}
              description={
                filter === 'all'
                  ? 'Check in with how you feel, then add events and context as they happen.'
                  : 'Choose another timeline filter or add a new record.'
              }
              action={
                !readOnly && filter === 'all' ? (
                  <Button onClick={() => openDialog('check-in')}>
                    Start With a Check-In
                  </Button>
                ) : undefined
              }
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function OutcomeVisualization({ state }: { readonly state: LedgerState }) {
  const grouped = Object.values(
    state.outcomes.reduce<Record<string, typeof state.outcomes>>(
      (groups, outcome) => {
        const key = `${outcome.name}\u0000${outcome.unit}`;
        groups[key] = [...(groups[key] ?? []), outcome];
        return groups;
      },
      {},
    ),
  );
  if (!grouped.length)
    return (
      <EmptyState
        compact
        icon={TrendingUp}
        title="No Measurements to Plot"
        description="The chart appears after you record an outcome or measurement."
      />
    );
  return (
    <div className="measurement-groups">
      {grouped.slice(0, 4).map(records => {
        const sorted = records.toSorted((a, b) =>
          a.occurredAt.localeCompare(b.occurredAt),
        );
        const min = Math.min(...sorted.map(record => record.value));
        const max = Math.max(...sorted.map(record => record.value));
        const span = max - min || 1;
        const points = sorted
          .map(
            (record, index) =>
              `${sorted.length === 1 ? 50 : 5 + (index / (sorted.length - 1)) * 90},${85 - ((record.value - min) / span) * 65}`,
          )
          .join(' ');
        const latest = sorted.at(-1)!;
        return (
          <div
            className="measurement-group"
            key={`${latest.name}-${latest.unit}`}
          >
            <div className="measurement-heading">
              <div>
                <strong>{latest.name}</strong>
                <span>
                  {sorted.length} {sorted.length === 1 ? 'record' : 'records'}
                </span>
              </div>
              <div>
                <strong>
                  {formatOutcomeValue(latest)}
                </strong>
                <span>Latest · {formatDateTime(latest.occurredAt)}</span>
              </div>
            </div>
            {sorted.length > 1 ? (
              <svg
                className="mini-chart"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                role="img"
                aria-label={`${latest.name} values over time`}
              >
                <line x1="5" y1="85" x2="95" y2="85" />
                <polyline points={points} />
              </svg>
            ) : (
              <p className="single-measurement">
                Add another {latest.name.toLowerCase()} record to reveal a
                change over time.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

const specialistTaskLabels: Record<SpecialistTask, string> = {
  'research-update': 'Find Current Evidence',
  'anecdotal-pulse': 'Scan Anecdotal Reports',
  'record-audit': 'Audit My Record',
  'results-review': 'Review a Result',
  'appointment-summary': 'Prepare for an Appointment',
};

function ResearchPage({
  state,
  readOnly,
  openDialog,
  preview,
  context,
  mutate,
  requestConfirmation,
}: PageCommonProps & {
  readonly preview: boolean;
  readonly context: TapFederatedSurfaceMountContext | undefined;
  readonly mutate: Mutation;
  readonly requestConfirmation: RequestConfirmation;
}) {
  const [task, setTask] = useState<SpecialistTask>('research-update');
  const [itemId, setItemId] = useState(state.items[0]?.id ?? '');
  const [viewId, setViewId] = useState(state.savedViews[0]?.id ?? '');
  const [question, setQuestion] = useState('');
  const [privateContextApproved, setPrivateContextApproved] = useState(false);
  const [specialistStatus, setSpecialistStatus] = useState<
    'idle' | 'connecting' | 'running'
  >('idle');
  const [specialistError, setSpecialistError] = useState<string | null>(null);
  const binding = state.specialistBinding;
  const needsItem = task === 'research-update' || task === 'anecdotal-pulse';
  const workspaceId = context?.workspaceId ?? '';

  const connect = async (): Promise<void> => {
    setSpecialistError(null);
    setSpecialistStatus('connecting');
    try {
      const installed = await installHealthSpecialist(workspaceId);
      const persistenceError = await mutate(
        current =>
          connectSpecialist(current, {
            ...installed,
            connectedAt: new Date().toISOString(),
          }),
        'Personal Health Researcher connected',
      );
      if (persistenceError)
        throw new Error(
          `The specialist and private channel were created, but the connection receipt could not be saved. ${persistenceError}`,
        );
    } catch (cause) {
      setSpecialistError(
        cause instanceof Error
          ? cause.message
          : 'The specialist could not be connected.',
      );
    } finally {
      setSpecialistStatus('idle');
    }
  };

  const run = async (): Promise<void> => {
    if (!binding) return;
    const replayKey = crypto.randomUUID();
    setSpecialistError(null);
    setSpecialistStatus('running');
    try {
      const prompt = buildSpecialistPrompt({
        task,
        state,
        itemId,
        viewId,
        question,
        privateContextApproved,
      });
      const result = await runHealthSpecialist({
        workspaceId,
        channelId: binding.channelId,
        specialistId: binding.specialistId,
        task,
        content: prompt,
      });
      const persistenceError = await mutate(
        current =>
          addSpecialistRun(current, {
            replayKey,
            task,
            itemId: needsItem ? itemId : '',
            question,
            content: result.content,
            modelUsed: result.modelUsed,
            toolReceipts: result.toolReceipts,
            sourceChannelId: binding.channelId,
          }),
        `${specialistTaskLabels[task]} completed`,
      );
      if (persistenceError)
        throw new Error(
          `The specialist completed the turn, but its response could not be saved to the ledger. ${persistenceError}`,
        );
      setQuestion('');
      setPrivateContextApproved(false);
    } catch (cause) {
      setSpecialistError(
        cause instanceof Error ? cause.message : 'The specialist turn failed.',
      );
    } finally {
      setSpecialistStatus('idle');
    }
  };

  return (
    <>
      <Card className="specialist-card">
        <CardHeader className="card-header-row">
          <div>
            <span className="section-kicker">Ask & Review</span>
            <CardTitle>Work With Your Health Researcher</CardTitle>
            <CardDescription>
              Find evidence, look for gaps in your record, review a result, or
              prepare focused questions—with explicit context approval.
            </CardDescription>
          </div>
          {binding || !preview ? (
            <Badge variant={binding ? 'secondary' : 'outline'}>
              {binding ? 'Connected' : 'Not Connected'}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent>
          <details className="capability-details">
            <summary>
              <Icon icon={ShieldCheck} size="sm" aria-hidden="true" />
              Model, Tools & Privacy
            </summary>
            <p>
              TAP requests <strong>{GROK_MODEL_PREFERENCE}</strong> and applies
              the workspace’s current model policy. This host exposes{' '}
              <strong>web_search</strong> and <strong>web_fetch</strong>, not
              native X Search. The actual model and tool receipts are saved
              with each response. Private ledger context is sent only after you
              approve the visible boundary for that request.
            </p>
          </details>
          {specialistError ? (
            <Alert variant="destructive" className="specialist-error">
              <Icon icon={AlertCircle} size="sm" aria-hidden="true" />
              <AlertTitle>Specialist Operation Failed</AlertTitle>
              <AlertDescription>{specialistError}</AlertDescription>
            </Alert>
          ) : null}
          {preview ? (
            <div className="specialist-unavailable">
              <span>
                <Icon icon={LockKeyhole} size="md" aria-hidden="true" />
              </span>
              <div>
                <strong>Host authority is required</strong>
                <p>
                  Browser preview cannot install or invoke a TAP specialist. No
                  local or simulated response is substituted. Package this app
                  to connect the managed specialist and its private channel.
                </p>
              </div>
            </div>
          ) : !workspaceId ? (
            <Alert variant="destructive">
              <Icon icon={AlertCircle} size="sm" aria-hidden="true" />
              <AlertTitle>Workspace Context Missing</AlertTitle>
              <AlertDescription>
                TAP did not provide a workspace ID, so a private specialist
                channel cannot be created from this surface.
              </AlertDescription>
            </Alert>
          ) : !binding ? (
            <div className="specialist-connect">
              <div className="specialist-capabilities">
                <span>
                  <strong>Preferred model</strong>
                  <small>{GROK_MODEL_PREFERENCE}</small>
                </span>
                <span>
                  <strong>Allowed tools</strong>
                  <small>web_search · web_fetch</small>
                </span>
                <span>
                  <strong>Channel</strong>
                  <small>New private TAP channel</small>
                </span>
              </div>
              {!readOnly ? (
                <Button
                  onClick={() => void connect()}
                  disabled={specialistStatus !== 'idle'}
                >
                  <Icon
                    icon={
                      specialistStatus === 'connecting' ? RefreshCw : Sparkles
                    }
                    size="sm"
                    aria-hidden="true"
                    className={
                      specialistStatus === 'connecting'
                        ? 'spin-icon'
                        : undefined
                    }
                  />
                  {specialistStatus === 'connecting'
                    ? 'Connecting…'
                    : 'Connect Health Specialist'}
                </Button>
              ) : (
                <p className="read-only-note">
                  Viewer access cannot install or invoke specialists.
                </p>
              )}
            </div>
          ) : (
            <div className="specialist-workspace">
              {!readOnly ? (
                <div className="specialist-form">
                  <div className="specialist-fields">
                    <label htmlFor="specialist-task">
                      Task
                      <NativeSelect
                        id="specialist-task"
                        name="specialist-task"
                        value={task}
                        onChange={event => {
                          setTask(event.target.value as SpecialistTask);
                          setPrivateContextApproved(false);
                        }}
                      >
                        {Object.entries(specialistTaskLabels).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ),
                        )}
                      </NativeSelect>
                    </label>
                    {needsItem ? (
                      <>
                        <label htmlFor="specialist-item">
                          Tracked Item
                          <NativeSelect
                            id="specialist-item"
                            name="specialist-item"
                            value={itemId}
                            onChange={event => {
                              setItemId(event.target.value);
                              setPrivateContextApproved(false);
                            }}
                          >
                            <option value="">Choose an item…</option>
                            {state.items.map(item => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </NativeSelect>
                        </label>
                        <label htmlFor="specialist-view">
                          Research View
                          <NativeSelect
                            id="specialist-view"
                            name="specialist-view"
                            value={viewId}
                            onChange={event => {
                              setViewId(event.target.value);
                              setPrivateContextApproved(false);
                            }}
                          >
                            <option value="">Choose a saved view…</option>
                            {state.savedViews.map(view => (
                              <option key={view.id} value={view.id}>
                                {view.name}
                              </option>
                            ))}
                          </NativeSelect>
                        </label>
                      </>
                    ) : null}
                  </div>
                  <label htmlFor="specialist-question">
                    Focus or Question <span>(optional)</span>
                    <Textarea
                      id="specialist-question"
                      name="specialist-question"
                      autoComplete="off"
                      value={question}
                      maxLength={1200}
                      rows={3}
                      placeholder="Add a precise question, date range, or concern for the specialist to address…"
                      onChange={event => setQuestion(event.target.value)}
                    />
                  </label>
                  <label className="privacy-consent">
                    <Checkbox
                      name="private-context-approved"
                      checked={privateContextApproved}
                      onCheckedChange={checked =>
                        setPrivateContextApproved(checked === true)
                      }
                    />
                    <span>
                      <strong>Approve this private-context transfer</strong>
                      <small>
                        {needsItem
                          ? 'Send only the selected item’s canonical name, category, jurisdiction, and recorded regulatory status.'
                          : 'Send up to 20 active items and the 20 most recent administrations, outcomes, confounders, and safety events. Your ledger name is excluded.'}
                      </small>
                    </span>
                  </label>
                  <div className="specialist-run-actions">
                    <p>
                      Actual model and tool receipts are saved with the
                      response. No receipt means no claim that a tool ran.
                    </p>
                    <Button
                      disabled={
                        specialistStatus !== 'idle' ||
                        !privateContextApproved ||
                        (needsItem && (!itemId || !viewId))
                      }
                      onClick={() => void run()}
                    >
                      <Icon
                        icon={
                          specialistStatus === 'running' ? RefreshCw : Sparkles
                        }
                        size="sm"
                        aria-hidden="true"
                        className={
                          specialistStatus === 'running'
                            ? 'spin-icon'
                            : undefined
                        }
                      />
                      {specialistStatus === 'running'
                        ? 'Researching…'
                        : `Run ${specialistTaskLabels[task]}`}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="read-only-note">
                  Specialist history is visible, but viewer access cannot send
                  private context or start a new turn.
                </p>
              )}
              <div className="specialist-history" aria-live="polite">
                <div className="subsection-heading">
                  <div>
                    <H3>Completed Briefings</H3>
                    <p>
                      Persisted output with host-reported execution receipts.
                    </p>
                  </div>
                  <Badge variant="outline">{state.specialistRuns.length}</Badge>
                </div>
                {state.specialistRuns.length ? (
                  state.specialistRuns.map(runRecord => (
                    <details className="specialist-result" key={runRecord.id}>
                      <summary>
                        <span>
                          <strong>
                            {specialistTaskLabels[runRecord.task]}
                          </strong>
                          <small>{formatDateTime(runRecord.createdAt)}</small>
                        </span>
                        <span className="receipt-list">
                          <Badge variant="outline">
                            {runRecord.modelUsed || 'Model not reported'}
                          </Badge>
                          {runRecord.toolReceipts.map(receipt => (
                            <Badge
                              key={`${receipt.toolName}-${receipt.success}`}
                              variant={
                                receipt.success ? 'secondary' : 'destructive'
                              }
                            >
                              {receipt.toolName}
                              {receipt.success ? '' : ' failed'}
                            </Badge>
                          ))}
                        </span>
                      </summary>
                      {runRecord.question ? (
                        <p className="specialist-question">
                          <strong>Requested focus:</strong> {runRecord.question}
                        </p>
                      ) : null}
                      <LinkedSpecialistContent value={runRecord.content} />
                      <small className="channel-receipt">
                        Private source channel: {runRecord.sourceChannelId}
                      </small>
                      {!readOnly ? (
                        <div className="specialist-result-actions">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              requestConfirmation({
                                title: 'Delete this specialist briefing?',
                                description:
                                  'This removes the persisted briefing and its execution receipts from the ledger. It does not delete the private TAP channel timeline.',
                                actionLabel: 'Delete Briefing',
                                tone: 'destructive',
                                onConfirm: () =>
                                  void mutate(
                                    current =>
                                      deleteEntity(
                                        current,
                                        'specialist-run',
                                        runRecord.id,
                                      ),
                                    'Specialist briefing deleted',
                                  ),
                              })
                            }
                          >
                            <Icon icon={Trash2} size="sm" aria-hidden="true" />
                            Delete Briefing
                          </Button>
                        </div>
                      ) : null}
                    </details>
                  ))
                ) : (
                  <EmptyState
                    compact
                    icon={Sparkles}
                    title="No Specialist Briefings Yet"
                    description="Run a task after reviewing and approving the exact private-context boundary."
                  />
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <section className="research-views-section">
          <div className="section-heading-row">
            <div>
              <span className="section-kicker">Saved Filters</span>
              <H2>Your Research Views</H2>
              <p>
                Reuse the evidence scope that fits a specific question.
              </p>
            </div>
            <Button disabled={readOnly} onClick={() => openDialog('view')}>
              <Icon icon={Plus} size="sm" aria-hidden="true" /> Save View
            </Button>
          </div>
          {state.savedViews.length ? (
            <div className="research-view-grid">
              {state.savedViews.map(view => (
                <Card className="research-view" key={view.id}>
                  <CardHeader>
                    <span className="view-icon">
                      <Icon
                        icon={
                          view.scope === 'approved-only'
                            ? ShieldCheck
                            : FlaskConical
                        }
                        size="sm"
                        aria-hidden="true"
                      />
                    </span>
                    <div>
                      <CardTitle>{view.name}</CardTitle>
                      <CardDescription>{titleCase(view.scope)}</CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="tag-list">
                      {view.evidenceTypes.map(type => (
                        <Badge variant="outline" key={type}>
                          {titleCase(type)}
                        </Badge>
                      ))}
                    </div>
                    <div className="view-status">
                      <span className="status-dot status-dot-muted" />
                      Ready for specialist-backed discovery
                    </div>
                    {!readOnly ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="view-delete"
                        onClick={() =>
                          requestConfirmation({
                            title: `Delete ${view.name}?`,
                            description:
                              'This removes the saved discovery scope. Existing specialist briefings remain available with their original content.',
                            actionLabel: 'Delete View',
                            tone: 'destructive',
                            onConfirm: () =>
                              void mutate(
                                current =>
                                  deleteEntity(current, 'saved-view', view.id),
                                'Research view deleted',
                              ),
                          })
                        }
                      >
                        <Icon icon={Trash2} size="sm" aria-hidden="true" />
                        Delete View
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={BookOpen}
              title="No Research Filter Saved"
              description="Save an approved-only, human, preclinical, or anecdotal scope before running item research."
              action={
                !readOnly ? (
                  <Button onClick={() => openDialog('view')}>
                    Save First View
                  </Button>
                ) : undefined
              }
            />
          )}
          <details className="evidence-guide">
            <summary>How Evidence Is Kept Separate</summary>
            <div>
              <ol className="evidence-ladder">
                <li>
                  <span>1</span>
                  <div>
                    <strong>Regulatory & Labeling</strong>
                    <small>Safety communications and approved labeling</small>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>Human Evidence</strong>
                    <small>
                      Guidelines, reviews, trials, and observational studies
                    </small>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>Preclinical Evidence</strong>
                    <small>Animal, in-vitro, and mechanistic research</small>
                  </div>
                </li>
                <li>
                  <span>4</span>
                  <div>
                    <strong>Commentary & Anecdotes</strong>
                    <small>Expert views, web posts, X posts, and forums</small>
                  </div>
                </li>
              </ol>
              <p>
                Animal or cell-culture exposure is never translated into a
                human dose. Regulatory status is a factual filter, not an
                automatic exclusion.
              </p>
            </div>
          </details>
      </section>
    </>
  );
}

function LinkedSpecialistContent({ value }: { readonly value: string }) {
  return (
    <div className="specialist-content">
      {value.split(/(https?:\/\/[^\s<>"']+)/gi).map((part, index) =>
        httpUrl.test(part) ? (
          <a
            href={part}
            key={`${part}-${index}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            {part}
          </a>
        ) : (
          <span key={`text-${index}`}>{part}</span>
        ),
      )}
    </div>
  );
}

function ReportsPage({
  state,
  readOnly,
  preview,
  context,
  importRef,
  onImported,
  onCsvImported,
  requestConfirmation,
}: {
  readonly state: LedgerState;
  readonly readOnly: boolean;
  readonly preview: boolean;
  readonly context: TapFederatedSurfaceMountContext | undefined;
  readonly importRef: React.RefObject<HTMLInputElement | null>;
  readonly onImported: (state: LedgerState) => void;
  readonly onCsvImported: (csv: string) => Promise<string | null>;
  readonly requestConfirmation: RequestConfirmation;
}) {
  const [platformStatus, setPlatformStatus] = useState<string | null>(null);
  const csvImportRef = useRef<HTMLInputElement>(null);
  const summary = clinicianSummary(state);
  const csv = serializeAdministrationsCsv(state);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Clinician Summary</title><style>body{font:16px/1.5 system-ui;max-width:760px;margin:48px auto;padding:0 24px;color:#17211f}pre{white-space:pre-wrap;font:inherit}footer{margin-top:40px;color:#64706d;font-size:13px}</style></head><body><pre>${escapeHtml(summary)}</pre><footer>Generated from user-entered Personal Health Ledger records on ${escapeHtml(dateFormatter.format(new Date()))}.</footer></body></html>`;
  if (readOnly)
    return (
      <div className="reports-layout">
        <section className="report-preview">
          <div className="paper">
            <div className="paper-header">
              <span className="paper-mark">
                <Icon icon={FileHeart} size="md" aria-hidden="true" />
              </span>
              <div>
                <span>Personal Health Ledger</span>
                <H2>Clinician Summary</H2>
              </div>
              <Badge variant="outline">Private</Badge>
            </div>
            <pre>{summary}</pre>
            <footer>
              Generated {dateFormatter.format(new Date())} · User-entered record
            </footer>
          </div>
        </section>
        <aside className="export-rail">
          <Card>
            <CardHeader>
              <CardTitle>Viewer Access</CardTitle>
              <CardDescription>
                This role can review the summary but cannot export, replace, or
                write private ledger data.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="storage-boundary">
                <Icon icon={ShieldCheck} size="sm" aria-hidden="true" />
                Ask a ledger owner if an export or archive replacement is
                required.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>
    );
  const saveToVfs = async () => {
    if (!context?.conversationId || !sdk.vfs) {
      setPlatformStatus('TAP VFS is not available in this surface context.');
      return;
    }
    try {
      await sdk.vfs.writeFile(
        context.conversationId,
        `personal-health-ledger/clinician-summary-${todayIso()}.txt`,
        new TextEncoder().encode(summary),
      );
      setPlatformStatus(
        'Summary saved to the active conversation’s protected VFS.',
      );
    } catch (cause) {
      setPlatformStatus(
        cause instanceof Error ? cause.message : 'The VFS export failed.',
      );
    }
  };
  return (
    <div className="reports-layout">
      <section className="report-preview">
        <div className="paper">
          <div className="paper-header">
            <span className="paper-mark">
              <Icon icon={FileHeart} size="md" aria-hidden="true" />
            </span>
            <div>
              <span>Personal Health Ledger</span>
              <H2>Clinician Summary</H2>
            </div>
            <Badge variant="outline">Private</Badge>
          </div>
          <pre>{summary}</pre>
          <footer>
            Generated {dateFormatter.format(new Date())} · User-entered record
          </footer>
        </div>
      </section>
      <aside className="export-rail">
        <Card>
          <CardHeader>
            <CardTitle>Choose a Format</CardTitle>
            <CardDescription>
              Choose the format that fits your next conversation.
            </CardDescription>
          </CardHeader>
          <CardContent className="export-options">
            <ExportOption
              icon={FileText}
              title="Printable HTML"
              description="Clinician-friendly layout"
              onClick={() =>
                download(
                  `clinician-summary-${todayIso()}.html`,
                  html,
                  'text/html',
                )
              }
            />
            <ExportOption
              icon={Download}
              title="Plain Text"
              description="Portable concise summary"
              onClick={() =>
                download(
                  `clinician-summary-${todayIso()}.txt`,
                  summary,
                  'text/plain',
                )
              }
            />
            <ExportOption
              icon={ClipboardList}
              title="Administration CSV"
              description="Structured event history"
              onClick={() =>
                download(`health-ledger-${todayIso()}.csv`, csv, 'text/csv')
              }
            />
            <ExportOption
              icon={Box}
              title="Complete Archive"
              description="Machine-readable JSON"
              onClick={() =>
                download(
                  `health-ledger-${todayIso()}.json`,
                  serializeLedger(state),
                  'application/json',
                )
              }
            />
            <ExportOption
              icon={LockKeyhole}
              title="Save to TAP VFS"
              description="Requires an active conversation"
              onClick={() => void saveToVfs()}
            />
            {platformStatus ? (
              <p className="platform-status" role="status">
                {platformStatus}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Bring In Records</CardTitle>
            <CardDescription>
              Validate a complete archive or add administration rows to the
              current ledger.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <input
              ref={importRef}
              type="file"
              aria-label="JSON archive file"
              accept="application/json,.json"
              className="sr-only"
              onChange={event => {
                const file = event.target.files?.[0];
                if (!file) return;
                void file
                  .text()
                  .then(parseLedger)
                  .then(next =>
                    requestConfirmation({
                      title: 'Replace the current ledger?',
                      description:
                        'The validated archive will replace every current ledger record. Export a backup first if you may need to restore this version.',
                      actionLabel: 'Replace Ledger',
                      tone: 'destructive',
                      onConfirm: () => onImported(next),
                    }),
                  )
                  .catch((cause: unknown) =>
                    setPlatformStatus(
                      cause instanceof Error
                        ? cause.message
                        : 'The archive could not be imported.',
                    ),
                  );
                event.currentTarget.value = '';
              }}
            />
            <Button
              variant="outline"
              className="full-width"
              onClick={() => importRef.current?.click()}
            >
              Choose JSON Archive…
            </Button>
            <input
              ref={csvImportRef}
              type="file"
              aria-label="Administration CSV file"
              accept="text/csv,.csv"
              className="sr-only"
              onChange={event => {
                const file = event.target.files?.[0];
                if (!file) return;
                void file
                  .text()
                  .then(csvText =>
                    requestConfirmation({
                      title: 'Import administration rows?',
                      description:
                        'Rows must match an existing item and optional lot by name. Confirmed rows update authoritative inventory and duplicate replay keys are rejected.',
                      actionLabel: 'Import CSV',
                      onConfirm: () => void onCsvImported(csvText),
                    }),
                  )
                  .catch((cause: unknown) =>
                    setPlatformStatus(
                      cause instanceof Error
                        ? cause.message
                        : 'The CSV could not be read.',
                    ),
                  );
                event.currentTarget.value = '';
              }}
            />
            <Button
              variant="outline"
              className="full-width import-secondary"
              onClick={() => csvImportRef.current?.click()}
            >
              Choose Administration CSV…
            </Button>
            <p className="storage-boundary">
              <Icon icon={ShieldCheck} size="sm" aria-hidden="true" />
              {preview
                ? 'Preview uses a browser-only key that packaged execution never reads.'
                : 'TAP derives the workspace and exact-package storage scope from the authenticated frame.'}
            </p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function ExportOption({
  icon,
  title,
  description,
  onClick,
}: {
  readonly icon: typeof Download;
  readonly title: string;
  readonly description: string;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" className="export-option" onClick={onClick}>
      <span>
        <Icon icon={icon} size="sm" aria-hidden="true" />
      </span>
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
      <Icon icon={ChevronRight} size="sm" aria-hidden="true" />
    </button>
  );
}

function CategoryMark({ category }: { readonly category: string }) {
  const icon = category.includes('medication')
    ? Stethoscope
    : category === 'peptide'
      ? Beaker
      : category === 'vitamin'
        ? Sparkles
        : FlaskConical;
  return (
    <span
      className={`category-mark category-${category}`}
      title={titleCase(category)}
    >
      <Icon icon={icon} size="sm" aria-hidden="true" />
    </span>
  );
}

function StatusBadge({
  status,
}: {
  readonly status: LedgerState['items'][number]['status'];
}) {
  return (
    <Badge
      variant={status === 'active' ? 'default' : 'outline'}
      className={`status-badge status-${status}`}
    >
      <span />
      {titleCase(status)}
    </Badge>
  );
}

function Detail({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PageToolbar({ children }: { readonly children: ReactNode }) {
  return <div className="page-toolbar">{children}</div>;
}

function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  readonly icon: typeof Activity;
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
  readonly compact?: boolean;
}) {
  return (
    <Empty
      variant="outline"
      size={compact ? 'compact' : 'default'}
      className="designed-empty"
    >
      <span className="empty-icon">
        <Icon icon={icon} size="md" aria-hidden="true" />
      </span>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action}
    </Empty>
  );
}
