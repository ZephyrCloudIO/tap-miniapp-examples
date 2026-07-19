import { useEffect, useMemo, useState } from 'react';
import {
  sdk,
  type MiniAppHttpCredentialMetadata,
  type MiniAppHttpResponse,
} from '@theaiplatform/miniapp-sdk/sdk';
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
  Badge,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  H1,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  MiniAppStatusBar,
  NativeSelect,
  Progress,
  Textarea,
} from '@theaiplatform/miniapp-sdk/ui';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  FileSearch,
  Gauge,
  History,
  LayoutDashboard,
  Link2,
  ListChecks,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Unplug,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import {
  addAnalysis,
  attachCaseChannel,
  attachWorkflowRun,
  canCoordinate,
  configureWebhookApi,
  createCase,
  createSettings,
  emptyState,
  mergeWebhookEvents,
  recordIdempotentReceipt,
  transitionCase,
  withReceipt,
  type AnalysisKind,
  type CaseStatus,
  type CompanionState,
  type RemediationCase,
  type Role,
  type VantaObjectType,
  type VantaRegion,
} from './domain';
import {
  analysisTitle,
  installSpecialist,
  runSpecialistAnalysis,
} from './specialist';
import { loadState, saveState } from './storage';
import {
  VANTA_API_FAMILIES,
  VANTA_AUDITOR_SDK_METHODS,
  VANTA_AUDITOR_SDK_VERSION,
  VANTA_CAPABILITY_DOMAINS,
  VANTA_MCP_PACKAGE_VERSION,
  VANTA_MCP_TOOLS,
  VANTA_WEBHOOK_BOUNDARY,
  type CapabilitySupport,
} from './vanta-capabilities';
import {
  fetchWebhookEvents,
  normalizeWebhookApiUrl,
} from './webhook-client';
import {
  VANTA_API_SURFACES,
  buildVantaApiRequest,
  formatVantaApiResponse,
  isSuccessfulVantaResponse,
  isVantaApiWrite,
  normalizeVantaApiUrl,
  type VantaApiDisplayResult,
  type VantaApiDraft,
  type VantaApiMethod,
  type VantaApiSurface,
} from './vanta-api';

type View =
  | 'overview'
  | 'capabilities'
  | 'cases'
  | 'evidence'
  | 'audit'
  | 'workflows'
  | 'activity';

export interface VantaCompanionProps {
  readonly preview?: boolean;
  readonly hostWorkspaceId?: string;
  readonly hostChannelId?: string;
}

const navItems: readonly [View, string, typeof LayoutDashboard][] = [
  ['overview', 'Overview', LayoutDashboard],
  ['capabilities', 'Vanta coverage', Gauge],
  ['cases', 'Remediation', ListChecks],
  ['evidence', 'Evidence', FileCheck2],
  ['audit', 'Vanta API', ClipboardCheck],
  ['workflows', 'Workflows', Workflow],
  ['activity', 'Activity', History],
];

const statusLabel: Record<CaseStatus, string> = {
  open: 'Open',
  planning: 'Planning',
  'in-progress': 'In progress',
  'awaiting-verification': 'Awaiting verification',
  verified: 'Verified',
};

const nextStatus: Partial<Record<CaseStatus, CaseStatus>> = {
  open: 'planning',
  planning: 'in-progress',
  'in-progress': 'awaiting-verification',
  'awaiting-verification': 'verified',
};

const emptyCaseForm = {
  title: '',
  objectType: 'test' as VantaObjectType,
  vantaObjectId: '',
  vantaUrl: '',
  criterion: '',
  owner: '',
  dueAt: '',
  notes: '',
};

const emptyVantaApiDraft: VantaApiDraft = {
  surface: 'auditor',
  credentialRef: '',
  method: 'GET',
  path: VANTA_API_SURFACES[0].examplePath,
  body: '',
};

export function VantaCompanionApp({
  preview = false,
  hostWorkspaceId = '',
  hostChannelId = '',
}: VantaCompanionProps) {
  const [state, setState] = useState<CompanionState>(emptyState());
  const [revision, setRevision] = useState<number | null>(null);
  const [view, setView] = useState<View>('overview');
  const [status, setStatus] = useState('Opening workspace…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [caseDialog, setCaseDialog] = useState(false);
  const [analysisDialog, setAnalysisDialog] = useState<AnalysisKind | null>(
    null,
  );
  const [analysisContext, setAnalysisContext] = useState('');
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(
    null,
  );
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [confirmTransition, setConfirmTransition] = useState<{
    item: RemediationCase;
    status: CaseStatus;
  } | null>(null);
  const [caseForm, setCaseForm] = useState(emptyCaseForm);
  const [workspaceId, setWorkspaceId] = useState(hostWorkspaceId);
  const [channelId, setChannelId] = useState(hostChannelId);
  const [projectId, setProjectId] = useState('');
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const [role, setRole] = useState<Role>('viewer');
  const [region, setRegion] = useState<VantaRegion>('us');
  const [webhookApiDraft, setWebhookApiDraft] = useState('');
  const [pendingWebhookApiUrl, setPendingWebhookApiUrl] = useState<
    string | null
  >(null);
  const [apiCredentials, setApiCredentials] = useState<
    readonly MiniAppHttpCredentialMetadata[]
  >([]);
  const [apiCredentialsLoaded, setApiCredentialsLoaded] = useState(false);
  const [apiDraft, setApiDraft] = useState<VantaApiDraft>(emptyVantaApiDraft);
  const [apiResult, setApiResult] = useState<VantaApiDisplayResult | null>(null);
  const [pendingVantaWrite, setPendingVantaWrite] =
    useState<VantaApiDraft | null>(null);

  useEffect(() => {
    void loadState(preview)
      .then(result => {
        setState(result.state);
        setRevision(result.revision);
        setWebhookApiDraft(result.state.settings?.webhookApiUrl ?? '');
        setStatus('Workspace ready');
      })
      .catch(cause => {
        setError(message(cause));
        setStatus('Storage unavailable');
      });
  }, [preview]);

  const selectedAnalysis =
    state.analyses.find(item => item.id === selectedAnalysisId) ??
    state.analyses[0] ??
    null;
  const selectedCase =
    state.cases.find(item => item.id === selectedCaseId) ?? null;
  const openCases = state.cases.filter(item => item.status !== 'verified');
  const dueSoon = openCases.filter(
    item => item.dueAt && Date.parse(item.dueAt) <= Date.now() + 7 * 86_400_000,
  ).length;
  const connected = Boolean(
    state.settings?.specialistId && state.settings.channelId,
  );
  const coordinating = state.settings
    ? canCoordinate(state.settings.role)
    : false;

  async function persist(next: CompanionState, success: string): Promise<void> {
    setError('');
    const nextRevision = await saveState(next, revision, preview);
    setState(next);
    setRevision(nextRevision);
    setStatus(success);
  }

  async function perform(
    key: string,
    action: () => Promise<void>,
  ): Promise<void> {
    setBusy(key);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(message(cause));
      setStatus('Action failed');
    } finally {
      setBusy('');
    }
  }

  async function onboard(): Promise<void> {
    await perform('onboard', async () => {
      const settings = createSettings({
        role,
        workspaceId,
        channelId,
        projectId,
        region,
        timezone,
      });
      await persist({ ...state, settings }, 'Workspace preferences saved');
    });
  }

  async function connectSpecialist(): Promise<void> {
    if (!state.settings) return;
    await perform('connect', async () => {
      if (preview)
        throw new Error(
          'Vanta MCP connection is available only inside the packaged TAP host.',
        );
      const specialistId = await installSpecialist(state.settings!.region);
      let activeChannelId = state.settings!.channelId;
      if (!activeChannelId) {
        const created = await sdk.channels.create({
          workspaceId: state.settings!.workspaceId,
          name: 'Vanta SOC 2 operations',
          description:
            'Private operating channel for Vanta-backed SOC 2 analysis, remediation, evidence, and approvals.',
          projectId: state.settings!.projectId,
          visibility: 'private',
        });
        activeChannelId = created.roomId;
      }
      if (!sdk.specialist)
        throw new Error('This TAP host does not expose specialist operations.');
      await sdk.specialist.joinToChannel(activeChannelId, specialistId);
      const settings = {
        ...state.settings!,
        specialistId,
        channelId: activeChannelId,
        updatedAt: new Date().toISOString(),
      };
      const next = withReceipt(
        { ...state, settings },
        {
          kind: 'specialist',
          sourceId: specialistId,
          summary:
            'Installed the Vanta SOC 2 specialist and joined its private operations channel',
          actor: settings.role,
        },
      );
      await persist(
        next,
        'Specialist installed — authorize Vanta when the MCP prompt opens',
      );
    });
  }

  async function runAnalysis(kind: AnalysisKind, context = ''): Promise<void> {
    if (!state.settings?.specialistId || !state.settings.channelId) {
      setError('Connect the Vanta specialist before running analysis.');
      return;
    }
    await perform(`analysis:${kind}`, async () => {
      const result = await runSpecialistAnalysis({
        workspaceId: state.settings!.workspaceId,
        channelId: state.settings!.channelId!,
        specialistId: state.settings!.specialistId!,
        kind,
        context,
      });
      const next = addAnalysis(
        state,
        {
          kind,
          title: analysisTitle[kind],
          content: result.content,
          modelUsed: result.modelUsed,
          sourceChannelId: state.settings!.channelId!,
        },
        state.settings!.role,
      );
      await persist(next, `${analysisTitle[kind]} completed`);
      setSelectedAnalysisId(next.analyses[0]!.id);
      setAnalysisDialog(null);
      setAnalysisContext('');
    });
  }

  function openAnalysis(id: string): void {
    setSelectedAnalysisId(id);
    setView('overview');
  }

  async function submitCase(): Promise<void> {
    if (!state.settings) return;
    await perform('case', async () => {
      const next = createCase(state, caseForm, state.settings!.role);
      await persist(next, 'Remediation case created');
      setCaseForm(emptyCaseForm);
      setCaseDialog(false);
      setView('cases');
    });
  }

  async function applyTransition(
    item: RemediationCase,
    next: CaseStatus,
  ): Promise<void> {
    if (!state.settings) return;
    await perform(`transition:${item.id}`, async () => {
      const updated = transitionCase(
        state,
        item.id,
        next,
        state.settings!.role,
      );
      await persist(
        updated,
        `Case moved to ${statusLabel[next].toLocaleLowerCase()}`,
      );
      setConfirmTransition(null);
    });
  }

  async function createCaseChannel(item: RemediationCase): Promise<void> {
    if (!state.settings) return;
    await perform(`channel:${item.id}`, async () => {
      const result = await sdk.channels.create({
        workspaceId: state.settings!.workspaceId,
        name: `SOC 2 · ${item.title}`,
        description: `${item.criterion} remediation for Vanta ${item.objectType} ${item.vantaObjectId}`,
        projectId: state.settings!.projectId,
        visibility: 'private',
      });
      await sdk.channels.sendMessage({
        workspaceId: state.settings!.workspaceId,
        channelId: result.roomId,
        clientMessageId: `vanta-case-${item.id}`,
        name: 'Vanta remediation case',
        body: `## ${item.title}\n\n**Vanta source:** ${item.vantaUrl}\n**Object:** ${item.objectType} · ${item.vantaObjectId}\n**SOC 2:** ${item.criterion}\n**Owner:** ${item.owner}\n**Due:** ${item.dueAt ?? 'Not set'}\n\n${item.notes || 'No additional context provided.'}\n\nClosing this channel does not close the Vanta record. Verify the source state before archival.`,
        content: item.title,
      });
      if (state.settings!.specialistId && sdk.specialist)
        await sdk.specialist.joinToChannel(
          result.roomId,
          state.settings!.specialistId,
        );
      let next = attachCaseChannel(state, item.id, result.roomId);
      next = recordIdempotentReceipt(next, {
        kind: 'channel',
        sourceId: result.roomId,
        summary: `Created private remediation channel for ${item.vantaObjectId}`,
        actor: state.settings!.role,
        idempotencyKey: `case-channel:${item.id}:${result.roomId}`,
      });
      await persist(next, 'Private remediation channel created and seeded');
    });
  }

  async function invokeCaseWorkflow(item: RemediationCase): Promise<void> {
    if (!state.settings) return;
    await perform(`workflow:${item.id}`, async () => {
      const available = await sdk.workflows.list({
        workspaceId: state.settings!.workspaceId,
      });
      const workflow = available.workflows[0];
      if (!workflow)
        throw new Error(
          'No saved workflow is available in this workspace. Create an approved workflow in TAP first.',
        );
      const result = await sdk.workflows.invokeSaved({
        workflowId: workflow.id,
        payload: {
          source: 'vanta-companion',
          caseId: item.id,
          vantaObjectId: item.vantaObjectId,
          vantaUrl: item.vantaUrl,
          criterion: item.criterion,
          owner: item.owner,
          dueAt: item.dueAt,
        },
      });
      if (!result.success)
        throw new Error(
          result.error || result.message || 'Workflow invocation failed.',
        );
      const runId = result.runId ?? `${workflow.id}:${result.status}`;
      let next = attachWorkflowRun(state, item.id, runId);
      next = recordIdempotentReceipt(next, {
        kind: 'workflow',
        sourceId: runId,
        summary: `Invoked ${workflow.name} for ${item.vantaObjectId}`,
        actor: state.settings!.role,
        idempotencyKey: `workflow:${runId}`,
      });
      await persist(next, `${workflow.name} started`);
    });
  }

  async function persistWebhookEndpoint(apiUrl: string): Promise<void> {
    if (!state.settings) return;
    const next = configureWebhookApi(
      state,
      apiUrl,
      state.settings.role,
    );
    await persist(next, 'Webhook API endpoint saved');
    setWebhookApiDraft(apiUrl);
    setPendingWebhookApiUrl(null);
  }

  async function saveWebhookEndpoint(): Promise<void> {
    if (!state.settings) return;
    await perform('webhook-config', async () => {
      const normalized = normalizeWebhookApiUrl(webhookApiDraft);
      if (
        state.settings?.webhookApiUrl &&
        state.settings.webhookApiUrl !== normalized &&
        state.webhookEvents.length > 0
      ) {
        setPendingWebhookApiUrl(normalized);
        setStatus('Confirm the webhook endpoint replacement');
        return;
      }
      await persistWebhookEndpoint(normalized);
    });
  }

  function openWebhookAccess(): void {
    try {
      const baseUrl = normalizeWebhookApiUrl(webhookApiDraft);
      const opened = globalThis.open(
        new URL('/v1/session', baseUrl),
        '_blank',
        'noopener,noreferrer',
      );
      if (!opened)
        throw new Error(
          'The Access sign-in window was blocked. Allow pop-ups for this TAP host and retry.',
        );
      setError('');
      setStatus('Cloudflare Access opened in a new window');
    } catch (cause) {
      setError(message(cause));
      setStatus('Action failed');
    }
  }

  async function syncWebhookFeed(): Promise<void> {
    if (!state.settings?.webhookApiUrl) {
      setError('Configure the webhook API before syncing events.');
      return;
    }
    await perform('webhook-sync', async () => {
      const page = await fetchWebhookEvents({
        apiUrl: state.settings!.webhookApiUrl!,
        workspaceId: state.settings!.workspaceId,
        cursor: state.settings!.webhookCursor,
      });
      const next = mergeWebhookEvents(
        state,
        { events: page.events, cursor: page.nextCursor },
        state.settings!.role,
      );
      const added = next.webhookEvents.length - state.webhookEvents.length;
      await persist(
        next,
        page.hasMore
          ? `Imported ${added} events — sync again to continue`
          : added > 0
            ? `Imported ${added} verified webhook ${added === 1 ? 'event' : 'events'}`
            : 'Webhook feed is current',
      );
    });
  }

  async function loadVantaCredentials(): Promise<void> {
    await perform('vanta-credentials', async () => {
      if (preview) {
        throw new Error(
          'Host-managed credentials are available only inside the packaged TAP host.',
        );
      }
      if (!sdk.credentials) {
        throw new Error(
          'This TAP host does not expose HTTP credential discovery.',
        );
      }
      const credentials = await sdk.credentials.listHttp();
      setApiCredentials(credentials);
      setApiCredentialsLoaded(true);
      setApiDraft(current => ({
        ...current,
        credentialRef: credentials.some(
          credential => credential.id === current.credentialRef,
        )
          ? current.credentialRef
          : (credentials[0]?.id ?? ''),
      }));
      setStatus(
        credentials.length > 0
          ? `Found ${credentials.length} host-managed HTTP ${credentials.length === 1 ? 'credential' : 'credentials'}`
          : 'No host-managed HTTP credentials are available in this workspace',
      );
    });
  }

  function requestVantaApi(draft: VantaApiDraft): void {
    try {
      buildVantaApiRequest(draft);
      if (isVantaApiWrite(draft.method)) {
        if (state.settings?.role !== 'lead') {
          throw new Error(
            'Only a compliance lead can approve a direct Vanta API write.',
          );
        }
        setPendingVantaWrite(draft);
        setError('');
        setStatus('Review and confirm the direct Vanta write');
        return;
      }
      void executeVantaApi(draft);
    } catch (cause) {
      setError(message(cause));
      setStatus('Action failed');
    }
  }

  async function executeVantaApi(draft: VantaApiDraft): Promise<void> {
    await perform(`vanta-api:${draft.method}`, async () => {
      if (preview) {
        throw new Error(
          'Host-mediated Vanta API requests are available only inside the packaged TAP host.',
        );
      }
      if (!sdk.http) {
        throw new Error('This TAP host does not expose bounded HTTP requests.');
      }
      const request = buildVantaApiRequest(draft);
      const write = isVantaApiWrite(draft.method);
      if (write) setPendingVantaWrite(null);
      let response: MiniAppHttpResponse;
      try {
        response = await sdk.http.request(request, {
          credentialRef: draft.credentialRef,
        });
      } catch (cause) {
        if (write) {
          throw new Error(
            `The Vanta write did not return a response, so its outcome is unknown. Verify the source before retrying. ${message(cause)}`,
          );
        }
        throw cause;
      }
      setApiResult(formatVantaApiResponse(response));

      const surface = VANTA_API_SURFACES.find(
        item => item.id === draft.surface,
      )!;
      const endpoint = new URL(request.url);
      if (
        isSuccessfulVantaResponse(response) &&
        write
      ) {
        const next = withReceipt(state, {
          kind: 'vanta-api',
          sourceId: `${draft.method} ${endpoint.pathname}`,
          summary: `${surface.label} ${draft.method} ${endpoint.pathname} completed with ${response.status}`,
          actor: state.settings!.role,
        });
        try {
          await persist(next, `${surface.label} write completed`);
        } catch (cause) {
          setError(
            `Vanta completed the write with ${response.status}, but TAP could not save its receipt. Do not retry the write; reconcile the receipt after checking Vanta. ${message(cause)}`,
          );
          setStatus('Vanta write completed; receipt save failed');
        }
        return;
      }
      setStatus(
        `${surface.label} returned ${response.status} ${response.statusText}`,
      );
    });
  }

  if (!state.settings) {
    return (
      <main className="setup-shell">
        <section className="setup-story" aria-labelledby="setup-title">
          <div className="setup-brand">
            <span className="logo-mark">
              <ShieldCheck />
            </span>
            <span>Vanta Companion</span>
          </div>
          <div className="story-copy">
            <Badge variant="secondary">SOC 2 operations</Badge>
            <H1 id="setup-title">
              Compliance work,
              <br />
              connected to the source.
            </H1>
            <p>
              Bring Vanta evidence, TAP specialists, code context, owners,
              channels, and workflows into one governed operating surface.
            </p>
          </div>
          <div className="story-proof">
            <div>
              <Search />
              <span>
                <strong>Traceable by default</strong>
                <small>Every material claim cites its Vanta source.</small>
              </span>
            </div>
            <div>
              <Bot />
              <span>
                <strong>Agentic, with boundaries</strong>
                <small>
                  Read and draft freely. Consequential writes need approval.
                </small>
              </span>
            </div>
            <div>
              <Link2 />
              <span>
                <strong>Vanta stays canonical</strong>
                <small>
                  TAP coordinates the work without copying the system of record.
                </small>
              </span>
            </div>
          </div>
        </section>
        <section className="setup-panel" aria-label="Workspace setup">
          <Card className="setup-card">
            <CardHeader className="setup-card-header">
              <CardTitle>Open your workspace</CardTitle>
              <CardDescription>
                Configure scope first. Vanta authorization happens through the
                host-managed MCP connection.
              </CardDescription>
            </CardHeader>
            <CardContent className="setup-card-content">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="workspace">TAP workspace ID</FieldLabel>
                  <Input
                    id="workspace"
                    value={workspaceId}
                    onChange={event => setWorkspaceId(event.target.value)}
                    placeholder="Current workspace ID"
                    disabled={Boolean(hostWorkspaceId)}
                  />
                  <FieldDescription>
                    Packaged surfaces use the workspace supplied by TAP.
                  </FieldDescription>
                </Field>
                <div className="field-pair">
                  <Field>
                    <FieldLabel htmlFor="region">Vanta region</FieldLabel>
                    <NativeSelect
                      id="region"
                      value={region}
                      onChange={event =>
                        setRegion(event.target.value as VantaRegion)
                      }
                    >
                      <option value="us">United States</option>
                      <option value="eu">Europe</option>
                      <option value="aus">Australia</option>
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="role">Operating role</FieldLabel>
                    <NativeSelect
                      id="role"
                      value={role}
                      onChange={event => setRole(event.target.value as Role)}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="operator">Operator</option>
                      <option value="lead">Compliance lead</option>
                    </NativeSelect>
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="channel">
                    Existing operations channel{' '}
                    <span className="optional">Optional</span>
                  </FieldLabel>
                  <Input
                    id="channel"
                    value={channelId}
                    onChange={event => setChannelId(event.target.value)}
                    placeholder="A private channel will be created if omitted"
                    disabled={Boolean(hostChannelId)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="project">
                    Project scope <span className="optional">Optional</span>
                  </FieldLabel>
                  <Input
                    id="project"
                    value={projectId}
                    onChange={event => setProjectId(event.target.value)}
                    placeholder="Project ID for scoped CKG context"
                  />
                </Field>
                <input
                  type="hidden"
                  value={timezone}
                  onChange={event => setTimezone(event.target.value)}
                />
                {error && (
                  <Alert variant="destructive">
                    <AlertTriangle />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button
                  size="lg"
                  onClick={() => void onboard()}
                  disabled={busy === 'onboard'}
                >
                  {busy === 'onboard' ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <ArrowRight />
                  )}{' '}
                  Enter workspace
                </Button>
                <p className="setup-fineprint">
                  <ShieldCheck /> Credentials stay in TAP and Vanta OAuth. This
                  miniapp never stores tokens.
                </p>
              </FieldGroup>
            </CardContent>
          </Card>
        </section>
        <MiniAppStatusBar
          className="app-status setup-status"
          tone={error ? 'error' : 'neutral'}
        >
          {status}
        </MiniAppStatusBar>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <span className="logo-mark">
            <ShieldCheck />
          </span>
          <div>
            <strong>Vanta</strong>
            <span>Companion</span>
          </div>
          <button
            className="sidebar-close"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
          >
            <X />
          </button>
        </div>
        <nav aria-label="Vanta Companion views">
          {navItems.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              className={view === id ? 'nav-active' : ''}
              aria-current={view === id ? 'page' : undefined}
              onClick={() => {
                setView(id);
                setSidebarOpen(false);
              }}
            >
              <Icon />
              <span>{label}</span>
              {id === 'cases' && openCases.length > 0 && (
                <em>{openCases.length}</em>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-context">
          <span className={`connection-dot ${connected ? 'connected' : ''}`} />
          <div>
            <strong>
              {connected ? 'Specialist installed' : 'Vanta not connected'}
            </strong>
            <small>
              {connected
                ? 'OAuth verified on first query'
                : `${state.settings.region.toUpperCase()} region`}
            </small>
          </div>
        </div>
        <button
          type="button"
          className="settings-button"
          onClick={() => setView('activity')}
        >
          <Settings2 /> Workspace settings
        </button>
      </aside>
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <section className="main-pane">
        <header className="topbar">
          <button
            type="button"
            className="menu-button"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu />
          </button>
          <div className="breadcrumbs">
            <span>SOC 2</span>
            <ChevronRight />
            <strong>{navItems.find(([id]) => id === view)?.[1]}</strong>
          </div>
          <div className="top-actions">
            <Button
              className="top-refresh"
              variant="ghost"
              size="sm"
              onClick={() => globalThis.location.reload()}
            >
              <RefreshCw /> Refresh
            </Button>
            <Badge variant="outline" className="role-badge">
              {state.settings.role}
            </Badge>
            <Button
              className="top-new-case"
              size="sm"
              aria-label="Create remediation case"
              onClick={() => setCaseDialog(true)}
              disabled={!coordinating}
            >
              <Plus /> <span className="top-new-case-label">New case</span>
            </Button>
          </div>
        </header>

        <div className="page-scroll" id="main-content" tabIndex={-1}>
          {error && (
            <Alert variant="destructive" className="global-alert">
              <AlertTriangle />
              <AlertDescription>
                <strong>Couldn’t complete that action.</strong> {error}
              </AlertDescription>
            </Alert>
          )}
          {!connected && (
            <section className="connection-banner">
              <div className="connection-icon">
                <Unplug />
              </div>
              <div>
                <strong>Connect the Vanta SOC 2 specialist</strong>
                <p>
                  Installs an official Vanta MCP connection in this workspace.
                  OAuth and credentials stay with TAP and Vanta.
                </p>
              </div>
              <Button
                className="connection-action"
                onClick={() => void connectSpecialist()}
                disabled={!coordinating || busy === 'connect'}
              >
                {busy === 'connect' ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <Sparkles />
                )}{' '}
                Install & connect
              </Button>
            </section>
          )}
          {view === 'overview' && (
            <Overview
              state={state}
              connected={connected}
              openCount={openCases.length}
              dueSoon={dueSoon}
              selectedAnalysis={selectedAnalysis}
              onRun={kind => void runAnalysis(kind)}
              onOpenAnalysis={kind => setAnalysisDialog(kind)}
              onCapabilities={() => setView('capabilities')}
              onSelectAnalysis={setSelectedAnalysisId}
              busy={busy}
            />
          )}
          {view === 'capabilities' && (
            <CapabilitiesView
              connected={connected}
              busy={busy}
              analyses={state.analyses}
              onRun={kind => void runAnalysis(kind)}
              onSelect={openAnalysis}
              onOpenApi={() => setView('audit')}
              webhookConfigured={Boolean(state.settings.webhookApiUrl)}
              webhookLastSyncedAt={state.settings.webhookLastSyncedAt}
            />
          )}
          {view === 'cases' && (
            <CasesView
              cases={state.cases}
              role={state.settings.role}
              busy={busy}
              onCreate={() => setCaseDialog(true)}
              onSelect={setSelectedCaseId}
              onTransition={(item, next) =>
                setConfirmTransition({ item, status: next })
              }
              onChannel={item => void createCaseChannel(item)}
              onWorkflow={item => void invokeCaseWorkflow(item)}
            />
          )}
          {view === 'evidence' && (
            <FocusedView
              icon={FileSearch}
              eyebrow="Evidence workspace"
              title="Prepare evidence without losing provenance"
              description="Search authorized Vanta documents, control mappings, and attached organizational knowledge for existing evidence. The specialist checks period, freshness, completeness, and confidentiality before drafting a packet."
              action="Scan evidence needs"
              disabled={!connected}
              busy={busy === 'analysis:evidence'}
              onAction={() => void runAnalysis('evidence')}
              analyses={state.analyses.filter(item => item.kind === 'evidence')}
              onSelect={openAnalysis}
            />
          )}
          {view === 'audit' && (
            <VantaApiView
              preview={preview}
              role={state.settings.role}
              credentials={apiCredentials}
              credentialsLoaded={apiCredentialsLoaded}
              draft={apiDraft}
              result={apiResult}
              busy={busy}
              onLoadCredentials={() => void loadVantaCredentials()}
              onDraftChange={setApiDraft}
              onExecute={requestVantaApi}
            />
          )}
          {view === 'workflows' && (
            <WorkflowsView
              state={state}
              connected={connected}
              onDesign={() => setAnalysisDialog('recurring-workflow')}
            />
          )}
          {view === 'activity' && (
            <ActivityView
              state={state}
              apiUrlDraft={webhookApiDraft}
              onApiUrlChange={setWebhookApiDraft}
              onSaveEndpoint={() => void saveWebhookEndpoint()}
              onOpenAccess={openWebhookAccess}
              onSync={() => void syncWebhookFeed()}
              busy={busy}
            />
          )}
        </div>
      </section>

      <Dialog open={caseDialog} onOpenChange={setCaseDialog}>
        <DialogContent className="case-dialog">
          <DialogHeader>
            <DialogTitle>Create remediation case</DialogTitle>
            <DialogDescription>
              Reference a real Vanta object. This creates TAP coordination
              state; it does not modify the source record.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="case-title">Case title</FieldLabel>
              <Input
                id="case-title"
                value={caseForm.title}
                onChange={event =>
                  setCaseForm({ ...caseForm, title: event.target.value })
                }
                placeholder="Describe the observed gap"
              />
            </Field>
            <div className="field-pair">
              <Field>
                <FieldLabel htmlFor="object-type">Vanta object type</FieldLabel>
                <NativeSelect
                  id="object-type"
                  value={caseForm.objectType}
                  onChange={event =>
                    setCaseForm({
                      ...caseForm,
                      objectType: event.target.value as VantaObjectType,
                    })
                  }
                >
                  {[
                    'test',
                    'issue',
                    'control',
                    'audit-request',
                    'vendor',
                    'risk',
                    'vulnerability',
                  ].map(item => (
                    <option key={item} value={item}>
                      {item.replace('-', ' ')}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="object-id">Vanta object ID</FieldLabel>
                <Input
                  id="object-id"
                  value={caseForm.vantaObjectId}
                  onChange={event =>
                    setCaseForm({
                      ...caseForm,
                      vantaObjectId: event.target.value,
                    })
                  }
                  placeholder="Source-system ID"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="vanta-url">Vanta deep link</FieldLabel>
              <Input
                id="vanta-url"
                type="url"
                value={caseForm.vantaUrl}
                onChange={event =>
                  setCaseForm({ ...caseForm, vantaUrl: event.target.value })
                }
                placeholder="https://app.vanta.com/..."
              />
            </Field>
            <div className="field-pair">
              <Field>
                <FieldLabel htmlFor="criterion">SOC 2 criterion</FieldLabel>
                <Input
                  id="criterion"
                  value={caseForm.criterion}
                  onChange={event =>
                    setCaseForm({ ...caseForm, criterion: event.target.value })
                  }
                  placeholder="CC6.1"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="owner">Human owner</FieldLabel>
                <Input
                  id="owner"
                  value={caseForm.owner}
                  onChange={event =>
                    setCaseForm({ ...caseForm, owner: event.target.value })
                  }
                  placeholder="Name or team"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="due">
                Due date <span className="optional">Optional</span>
              </FieldLabel>
              <Input
                id="due"
                type="date"
                value={caseForm.dueAt}
                onChange={event =>
                  setCaseForm({ ...caseForm, dueAt: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="notes">
                Observed state and acceptance criteria
              </FieldLabel>
              <Textarea
                id="notes"
                rows={4}
                value={caseForm.notes}
                onChange={event =>
                  setCaseForm({ ...caseForm, notes: event.target.value })
                }
                placeholder="What is observed, what must change, and what evidence will verify it?"
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCaseDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitCase()}
              disabled={busy === 'case'}
            >
              {busy === 'case' ? <LoaderCircle className="spin" /> : <Plus />}{' '}
              Create case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={analysisDialog !== null}
        onOpenChange={open => !open && setAnalysisDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {analysisDialog
                ? analysisTitle[analysisDialog]
                : 'Specialist analysis'}
            </DialogTitle>
            <DialogDescription>
              The specialist retrieves current authorized sources. Vanta writes
              and external communication are out of scope for this action.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="analysis-context">
              Context or exact request
            </FieldLabel>
            <Textarea
              id="analysis-context"
              rows={7}
              value={analysisContext}
              onChange={event => setAnalysisContext(event.target.value)}
              placeholder={
                analysisDialog === 'auditor-response'
                  ? 'Paste the exact auditor request and requested period…'
                  : 'Add a Vanta object ID, scope, or question…'
              }
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAnalysisDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                analysisDialog &&
                void runAnalysis(analysisDialog, analysisContext)
              }
              disabled={!analysisDialog || busy.startsWith('analysis:')}
            >
              <Sparkles /> Run with Vanta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={selectedCase !== null}
        onOpenChange={open => !open && setSelectedCaseId(null)}
      >
        {selectedCase && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{selectedCase.title}</DialogTitle>
              <DialogDescription>
                {selectedCase.objectType} · {selectedCase.vantaObjectId}
              </DialogDescription>
            </DialogHeader>
            <div className="case-detail-grid">
              <div>
                <span>Status</span>
                <strong>{statusLabel[selectedCase.status]}</strong>
              </div>
              <div>
                <span>Criterion</span>
                <strong>{selectedCase.criterion}</strong>
              </div>
              <div>
                <span>Owner</span>
                <strong>{selectedCase.owner}</strong>
              </div>
              <div>
                <span>Due</span>
                <strong>{selectedCase.dueAt || 'Not set'}</strong>
              </div>
            </div>
            <div className="case-notes">
              <span>Observed state & acceptance criteria</span>
              <p>{selectedCase.notes || 'No notes provided.'}</p>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                sdk.navigation.open({ path: selectedCase.vantaUrl })
              }
            >
              <ExternalLink /> Open Vanta source
            </Button>
          </DialogContent>
        )}
      </Dialog>

      <AlertDialog
        open={confirmTransition !== null}
        onOpenChange={open => !open && setConfirmTransition(null)}
      >
        {confirmTransition && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirmTransition.status === 'verified'
                  ? 'Verify source completion?'
                  : `Move to ${statusLabel[confirmTransition.status]}?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmTransition.status === 'verified'
                  ? 'Confirm that you refreshed Vanta and verified the source item is resolved. This does not change Vanta.'
                  : `This updates the TAP coordination case from ${statusLabel[confirmTransition.item.status]} to ${statusLabel[confirmTransition.status]}.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  void applyTransition(
                    confirmTransition.item,
                    confirmTransition.status,
                  )
                }
              >
                Confirm transition
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      <AlertDialog
        open={pendingWebhookApiUrl !== null}
        onOpenChange={open => !open && setPendingWebhookApiUrl(null)}
      >
        {pendingWebhookApiUrl && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Replace the webhook endpoint?</AlertDialogTitle>
              <AlertDialogDescription>
                Existing webhook event metadata and its cursor belong to the
                current endpoint. Replacing it clears that local feed before
                the first sync from the new API. Vanta and the Worker are not
                modified.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep current endpoint</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  void perform('webhook-config', () =>
                    persistWebhookEndpoint(pendingWebhookApiUrl),
                  )
                }
              >
                Replace endpoint
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      <AlertDialog
        open={pendingVantaWrite !== null}
        onOpenChange={open => !open && setPendingVantaWrite(null)}
      >
        {pendingVantaWrite && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Execute this Vanta write?</AlertDialogTitle>
              <AlertDialogDescription>
                This is a fresh decision to modify Vanta through a host-managed
                credential. TAP will send the request exactly once and retain a
                receipt without storing the credential, request body, or
                response body.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="vanta-write-review">
              <code>
                {pendingVantaWrite.method}{' '}
                {normalizeVantaApiUrl(pendingVantaWrite.path)}
              </code>
              {pendingVantaWrite.body.trim() && (
                <pre>{pendingVantaWrite.body.slice(0, 4_000)}</pre>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void executeVantaApi(pendingVantaWrite)}
              >
                Execute Vanta write
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      <MiniAppStatusBar
        className="app-status workspace-status"
        tone={error ? 'error' : 'success'}
      >
        {busy ? 'Working with the authoritative source…' : status}
      </MiniAppStatusBar>
    </main>
  );
}

function Overview({
  state,
  connected,
  openCount,
  dueSoon,
  selectedAnalysis,
  onRun,
  onOpenAnalysis,
  onCapabilities,
  onSelectAnalysis,
  busy,
}: {
  state: CompanionState;
  connected: boolean;
  openCount: number;
  dueSoon: number;
  selectedAnalysis: CompanionState['analyses'][number] | null;
  onRun: (kind: AnalysisKind) => void;
  onOpenAnalysis: (kind: AnalysisKind) => void;
  onCapabilities: () => void;
  onSelectAnalysis: (id: string) => void;
  busy: string;
}) {
  return (
    <div className="page overview-page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">SOC 2 command center</span>
          <H1>Good {dayPeriod()}.</H1>
          <p>Turn live compliance signals into owned, verifiable work.</p>
        </div>
        <Button
          onClick={() => onRun('readiness')}
          disabled={!connected || busy.startsWith('analysis:')}
        >
          <Sparkles /> Run weekly briefing
        </Button>
      </section>
      <section className="metric-grid">
        <Metric
          icon={CircleDot}
          label="Active cases"
          value={String(openCount)}
          detail={openCount ? 'Requires coordination' : 'No active remediation'}
          tone="violet"
        />
        <Metric
          icon={CalendarClock}
          label="Due within 7 days"
          value={String(dueSoon)}
          detail={
            dueSoon ? 'Review owners and blockers' : 'No near-term deadlines'
          }
          tone="amber"
        />
        <Metric
          icon={FileCheck2}
          label="Verified cases"
          value={String(state.cases.length - openCount)}
          detail="Confirmed against source"
          tone="green"
        />
        <Metric
          icon={Activity}
          label="Specialist runs"
          value={String(state.analyses.length)}
          detail={
            state.analyses[0]
              ? `Latest ${relativeDate(state.analyses[0].createdAt)}`
              : 'No analysis yet'
          }
          tone="blue"
        />
      </section>
      <section className="overview-grid">
        <Card className="briefing-card">
          <CardHeader className="section-card-header">
            <div>
              <CardTitle>Readiness briefing</CardTitle>
              <CardDescription>
                Observed facts and prioritized action from current allowlisted
                sources.
              </CardDescription>
            </div>
            {selectedAnalysis && (
              <Badge variant="outline">
                {relativeDate(selectedAnalysis.createdAt)}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="metric-content">
            {selectedAnalysis ? (
              <article className="analysis-content">
                <div className="analysis-meta">
                  <Badge variant="secondary">
                    {analysisTitle[selectedAnalysis.kind]}
                  </Badge>
                  <span>{selectedAnalysis.modelUsed || 'TAP specialist'}</span>
                </div>
                <div className="analysis-text">{selectedAnalysis.content}</div>
              </article>
            ) : (
              <Empty>
                <EmptyHeader>
                  <Gauge />
                  <EmptyTitle>No readiness briefing yet</EmptyTitle>
                  <EmptyDescription>
                    Run the specialist after authorizing Vanta. It retrieves
                    only data returned by the explicit official MCP tool
                    allowlist and labels specialist API-only blind spots.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    variant="outline"
                    disabled={!connected}
                    onClick={() => onRun('readiness')}
                  >
                    Run first briefing
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </CardContent>
        </Card>
        <Card className="action-card">
          <CardHeader>
            <CardTitle>Action center</CardTitle>
            <CardDescription>
              Focused, source-backed specialist routes.
            </CardDescription>
          </CardHeader>
          <CardContent className="action-list">
            <Action
              icon={AlertTriangle}
              title="Triage failing tests"
              description="Classify real gaps, stale data, integrations, exceptions, and scope."
              onClick={() => onRun('failed-tests')}
              disabled={!connected}
            />
            <Action
              icon={FileSearch}
              title="Prepare evidence"
              description="Find existing documents and check period, freshness, and provenance."
              onClick={() => onRun('evidence')}
              disabled={!connected}
            />
            <Action
              icon={Gauge}
              title="Review Vanta coverage"
              description="See every API family, SDK boundary, and allowlisted MCP tool."
              onClick={onCapabilities}
              disabled={false}
            />
            <Action
              icon={Bot}
              title="Ask a compliance question"
              description="Query authorized Vanta and organizational sources."
              onClick={() => onOpenAnalysis('custom')}
              disabled={!connected}
            />
          </CardContent>
        </Card>
      </section>
      {state.analyses.length > 1 && (
        <section>
          <div className="section-title">
            <div>
              <h2>Recent intelligence</h2>
              <p>Durable, traceable specialist outputs.</p>
            </div>
          </div>
          <div className="analysis-strip">
            {state.analyses.slice(0, 4).map(item => (
              <button key={item.id} onClick={() => onSelectAnalysis(item.id)}>
                <span>{analysisTitle[item.kind]}</span>
                <small>{relativeDate(item.createdAt)}</small>
                <ChevronRight />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const capabilityIcons: Record<string, typeof Gauge> = {
  'controls-monitoring': Gauge,
  'documents-evidence': FileSearch,
  'audit-operations': ClipboardCheck,
  'people-devices': Users,
  'vendor-risk': ShieldCheck,
  'vulnerability-management': AlertTriangle,
  'trust-customer': MessageSquareText,
  'integrations-resources': Link2,
};

const supportLabel: Record<CapabilitySupport, string> = {
  'mcp-read': 'MCP read',
  'mcp-partial': 'MCP + host API',
  'host-api': 'Host API',
};

function CapabilitiesView({
  connected,
  busy,
  analyses,
  onRun,
  onSelect,
  onOpenApi,
  webhookConfigured,
  webhookLastSyncedAt,
}: {
  connected: boolean;
  busy: string;
  analyses: CompanionState['analyses'];
  onRun: (kind: AnalysisKind) => void;
  onSelect: (id: string) => void;
  onOpenApi: () => void;
  webhookConfigured: boolean;
  webhookLastSyncedAt: string | null;
}) {
  return (
    <div className="page capability-page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Verified integration inventory</span>
          <H1>Vanta coverage</H1>
          <p>
            Every current API family is mapped. Only the named MCP tools below
            are executable by the specialist.
          </p>
        </div>
        <Button variant="outline" onClick={onOpenApi}>
          <ShieldCheck /> Open API bridge
        </Button>
      </section>
      <section className="coverage-metrics">
        <Card>
          <CardContent className="coverage-stat">
            <strong>{VANTA_MCP_TOOLS.length}</strong>
            <span>allowlisted MCP tools</span>
            <small>
              @vantasdk/vanta-mcp-server {VANTA_MCP_PACKAGE_VERSION}
            </small>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="coverage-stat">
            <strong>{VANTA_API_FAMILIES.length}</strong>
            <span>API reference families</span>
            <small>Manage, Build Integrations & Auditor</small>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="coverage-stat">
            <strong>{VANTA_AUDITOR_SDK_METHODS.length}</strong>
            <span>Auditor SDK methods</span>
            <small>vanta-auditor-api-sdk {VANTA_AUDITOR_SDK_VERSION}</small>
          </CardContent>
        </Card>
      </section>
      <Alert variant="info" className="coverage-notice">
        <ShieldCheck />
        <AlertDescription>
          <strong>Two governed execution paths.</strong> The specialist can use
          only the named read tools. Human-operated REST requests use a separate
          host credential, and every write requires a fresh compliance-lead
          decision.
        </AlertDescription>
      </Alert>
      <section className="capability-grid">
        {VANTA_CAPABILITY_DOMAINS.map(domain => {
          const Icon = capabilityIcons[domain.id] ?? Gauge;
          const latest = domain.analysisKind
            ? analyses.find(item => item.kind === domain.analysisKind)
            : null;
          return (
            <Card
              key={domain.id}
              className={`capability-card support-${domain.support}`}
            >
              <CardHeader className="capability-card-header">
                <div className="capability-heading">
                  <span className="capability-icon">
                    <Icon />
                  </span>
                  <div>
                    <CardTitle className="capability-title">
                      {domain.title}
                    </CardTitle>
                    <CardDescription className="capability-description">
                      {domain.description}
                    </CardDescription>
                  </div>
                </div>
                <Badge className="capability-support" variant="outline">
                  {supportLabel[domain.support]}
                </Badge>
              </CardHeader>
              <CardContent className="capability-card-content">
                <div className="capability-counts">
                  <span>
                    {domain.apiFamilies.length} API{' '}
                    {domain.apiFamilies.length === 1 ? 'family' : 'families'}
                  </span>
                  <span>
                    {domain.mcpTools.length} MCP{' '}
                    {domain.mcpTools.length === 1 ? 'tool' : 'tools'}
                  </span>
                </div>
                <div
                  className="family-list"
                  aria-label={`${domain.title} API families`}
                >
                  {domain.apiFamilies.map(family => (
                    <code key={family}>{family}</code>
                  ))}
                </div>
                <p className="capability-boundary">{domain.boundary}</p>
                <details>
                  <summary>Tool and source detail</summary>
                  <div className="tool-list">
                    {domain.mcpTools.length > 0 ? (
                      domain.mcpTools.map(tool => (
                        <code key={tool}>{tool}</code>
                      ))
                    ) : (
                      <span>No MCP tool is claimed for this domain.</span>
                    )}
                  </div>
                </details>
                <div className="capability-actions">
                  {latest ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onSelect(latest.id)}
                    >
                      Open latest <ArrowRight />
                    </Button>
                  ) : (
                    <span>
                      {domain.analysisKind
                        ? 'No specialist run yet'
                        : 'Human-operated API route ready'}
                    </span>
                  )}
                  {domain.analysisKind && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!connected || busy.startsWith('analysis:')}
                      onClick={() => onRun(domain.analysisKind!)}
                    >
                      {busy === `analysis:${domain.analysisKind}` ? (
                        <LoaderCircle className="spin" />
                      ) : (
                        <Sparkles />
                      )}{' '}
                      Analyze live scope
                    </Button>
                  )}
                  {domain.support === 'host-api' && (
                    <Button variant="outline" size="sm" onClick={onOpenApi}>
                      <ShieldCheck /> Open API bridge
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>
      <Card className="webhook-boundary">
        <CardHeader>
          <CardTitle>Webhook event layer</CardTitle>
          <CardDescription>
            {webhookLastSyncedAt
              ? `Last verified sync ${new Date(webhookLastSyncedAt).toLocaleString()}`
              : webhookConfigured
                ? 'Endpoint configured; sign in and sync from Activity'
                : 'Cloudflare Worker receiver included; deployment required'}
          </CardDescription>
        </CardHeader>
        <CardContent className="webhook-content">
          <p>{VANTA_WEBHOOK_BOUNDARY}</p>
          <div className="webhook-rules">
            <span>Svix signature verification</span>
            <span>Raw request body</span>
            <span>
              <code>svix-id</code> replay protection
            </span>
            <span>Async 2xx acknowledgement</span>
            <span>D1 durable event feed</span>
            <span>Cloudflare Access reads</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function VantaApiView({
  preview,
  role,
  credentials,
  credentialsLoaded,
  draft,
  result,
  busy,
  onLoadCredentials,
  onDraftChange,
  onExecute,
}: {
  preview: boolean;
  role: Role;
  credentials: readonly MiniAppHttpCredentialMetadata[];
  credentialsLoaded: boolean;
  draft: VantaApiDraft;
  result: VantaApiDisplayResult | null;
  busy: string;
  onLoadCredentials: () => void;
  onDraftChange: (draft: VantaApiDraft) => void;
  onExecute: (draft: VantaApiDraft) => void;
}) {
  const surface = VANTA_API_SURFACES.find(item => item.id === draft.surface)!;
  const write = isVantaApiWrite(draft.method);
  const working = busy.startsWith('vanta-api:');

  function changeSurface(next: VantaApiSurface): void {
    const preset = VANTA_API_SURFACES.find(item => item.id === next)!;
    onDraftChange({
      ...draft,
      surface: next,
      method: 'GET',
      path: preset.examplePath,
      body: '',
    });
  }

  function changeMethod(method: VantaApiMethod): void {
    onDraftChange({
      ...draft,
      method,
      body: isVantaApiWrite(method) ? draft.body : '',
    });
  }

  return (
    <div className="page vanta-api-page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Host-mediated Vanta API</span>
          <H1>Direct API bridge</H1>
          <p>
            Execute documented Auditor, Manage, and Build Integrations API
            endpoints without exposing a credential to miniapp JavaScript.
          </p>
        </div>
        <Badge variant={credentials.length > 0 ? 'success' : 'outline'}>
          {credentials.length > 0
            ? 'Credential available'
            : credentialsLoaded
              ? 'Credential required'
              : 'Not inspected'}
        </Badge>
      </section>
      {preview && (
        <Alert variant="info">
          <ShieldCheck />
          <AlertDescription>
            Browser preview cannot inspect host credentials or send privileged
            requests. Open the packaged miniapp in TAP to use this bridge.
          </AlertDescription>
        </Alert>
      )}
      <section className="api-surface-grid" aria-label="Vanta API surfaces">
        {VANTA_API_SURFACES.map(item => (
          <Card
            key={item.id}
            className={draft.surface === item.id ? 'api-surface-active' : ''}
          >
            <CardContent>
              <strong>{item.label}</strong>
              <p>{item.description}</p>
              <code>{item.examplePath}</code>
            </CardContent>
          </Card>
        ))}
      </section>
      <div className="api-console-grid">
        <Card>
          <CardHeader className="section-card-header">
            <div>
              <CardTitle>Request</CardTitle>
              <CardDescription>
                Restricted to <code>https://api.vanta.com/v1</code>. The host
                injects the selected credential after consent.
              </CardDescription>
            </div>
            <Badge variant={write ? 'warning' : 'secondary'}>
              {write ? 'Fresh decision' : 'Read'}
            </Badge>
          </CardHeader>
          <CardContent className="api-request-content">
            <FieldGroup>
              <div className="field-pair">
                <Field>
                  <FieldLabel htmlFor="vanta-api-surface">
                    API surface
                  </FieldLabel>
                  <NativeSelect
                    id="vanta-api-surface"
                    value={draft.surface}
                    onChange={event =>
                      changeSurface(event.target.value as VantaApiSurface)
                    }
                  >
                    {VANTA_API_SURFACES.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="vanta-api-credential">
                    Host credential
                  </FieldLabel>
                  <NativeSelect
                    id="vanta-api-credential"
                    value={draft.credentialRef}
                    onChange={event =>
                      onDraftChange({
                        ...draft,
                        credentialRef: event.target.value,
                      })
                    }
                    disabled={credentials.length === 0}
                  >
                    <option value="">
                      {credentialsLoaded
                        ? 'Select a Vanta credential'
                        : 'Load workspace credentials'}
                    </option>
                    {credentials.map(credential => (
                      <option key={credential.id} value={credential.id}>
                        {credential.displayName} · {credential.credentialType}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <Button
                variant="outline"
                onClick={onLoadCredentials}
                disabled={preview || busy === 'vanta-credentials'}
              >
                {busy === 'vanta-credentials' ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <RefreshCw />
                )}{' '}
                {credentialsLoaded ? 'Reload credentials' : 'Load credentials'}
              </Button>
              <div className="api-request-line">
                <Field>
                  <FieldLabel htmlFor="vanta-api-method">Method</FieldLabel>
                  <NativeSelect
                    id="vanta-api-method"
                    value={draft.method}
                    onChange={event =>
                      changeMethod(event.target.value as VantaApiMethod)
                    }
                  >
                    {['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].map(
                      method => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ),
                    )}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="vanta-api-path">
                    Endpoint path
                  </FieldLabel>
                  <Input
                    id="vanta-api-path"
                    value={draft.path}
                    onChange={event =>
                      onDraftChange({ ...draft, path: event.target.value })
                    }
                    placeholder={surface.examplePath}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
              </div>
              {write && (
                <Field>
                  <FieldLabel htmlFor="vanta-api-body">
                    JSON request body <span className="optional">Optional</span>
                  </FieldLabel>
                  <Textarea
                    id="vanta-api-body"
                    rows={9}
                    value={draft.body}
                    onChange={event =>
                      onDraftChange({ ...draft, body: event.target.value })
                    }
                    placeholder={'{\n  "field": "value"\n}'}
                    spellCheck={false}
                  />
                  <FieldDescription>
                    The body is reviewed again before execution and is never
                    persisted by this companion.
                  </FieldDescription>
                </Field>
              )}
              {write && role !== 'lead' && (
                <Alert variant="info">
                  <ShieldCheck />
                  <AlertDescription>
                    Direct Vanta writes require the compliance-lead role. Reads
                    remain available subject to the credential&apos;s scopes.
                  </AlertDescription>
                </Alert>
              )}
              <Button
                onClick={() => onExecute(draft)}
                disabled={
                  preview ||
                  !draft.credentialRef ||
                  !draft.path.trim() ||
                  Boolean(busy) ||
                  (write && role !== 'lead')
                }
              >
                {working ? (
                  <LoaderCircle className="spin" />
                ) : write ? (
                  <ShieldCheck />
                ) : (
                  <ArrowRight />
                )}{' '}
                {write ? 'Review write' : 'Execute request'}
              </Button>
            </FieldGroup>
          </CardContent>
        </Card>
        <Card className="api-response-card">
          <CardHeader className="section-card-header">
            <div>
              <CardTitle>Response</CardTitle>
              <CardDescription>
                Kept in memory only; reload clears source data.
              </CardDescription>
            </div>
            {result && (
              <Badge
                variant={
                  isSuccessfulVantaResponse(result.response)
                    ? 'success'
                    : 'warning'
                }
              >
                {result.response.status} {result.response.statusText}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="api-response-content" aria-live="polite">
            {result ? (
              <>
                <div className="api-response-meta">
                  <span>{result.response.elapsedMs} ms</span>
                  <span>{result.response.sizeBytes.toLocaleString()} bytes</span>
                  <span>{result.response.contentType ?? 'unknown type'}</span>
                </div>
                {result.response.bodyTruncated && (
                  <Alert variant="warning">
                    <AlertTriangle />
                    <AlertDescription>
                      The host truncated this response at the configured size
                      limit.
                    </AlertDescription>
                  </Alert>
                )}
                <pre tabIndex={0}>{result.body}</pre>
              </>
            ) : (
              <Empty>
                <EmptyHeader>
                  <ClipboardCheck />
                  <EmptyTitle>No API response</EmptyTitle>
                  <EmptyDescription>
                    Load a host-managed credential, choose a documented Vanta
                    endpoint, and execute a request.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>
      </div>
      <Card className="sdk-method-card">
        <CardContent>
          <div className="sdk-method-summary">
            <strong>
              {VANTA_AUDITOR_SDK_METHODS.length} verified Auditor SDK methods
            </strong>
            <p>
              The direct bridge can execute the corresponding documented REST
              endpoints. Manage and Build Integrations calls use the same
              credential-bound transport because Vanta does not publish SDKs
              for those surfaces.
            </p>
            <details className="sdk-method-list">
              <summary>Show all verified Auditor SDK methods</summary>
              <div className="tool-list">
                {VANTA_AUDITOR_SDK_METHODS.map(method => (
                  <code key={method}>{method}</code>
                ))}
              </div>
            </details>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CasesView({
  cases,
  role,
  busy,
  onCreate,
  onSelect,
  onTransition,
  onChannel,
  onWorkflow,
}: {
  cases: readonly RemediationCase[];
  role: Role;
  busy: string;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onTransition: (item: RemediationCase, status: CaseStatus) => void;
  onChannel: (item: RemediationCase) => void;
  onWorkflow: (item: RemediationCase) => void;
}) {
  const allowed = canCoordinate(role);
  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Remediation portfolio</span>
          <H1>Cases</H1>
          <p>Durable TAP coordination linked to canonical Vanta objects.</p>
        </div>
        <Button
          className="page-primary-action"
          onClick={onCreate}
          disabled={!allowed}
        >
          <Plus /> New case
        </Button>
      </section>
      {cases.length === 0 ? (
        <Card>
          <Empty>
            <EmptyHeader>
              <ListChecks />
              <EmptyTitle>No remediation cases</EmptyTitle>
              <EmptyDescription>
                Create a case from a real Vanta test, issue, control, request,
                vendor, risk, or vulnerability. Nothing is seeded.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={onCreate} disabled={!allowed}>
                Create first case
              </Button>
            </EmptyContent>
          </Empty>
        </Card>
      ) : (
        <div className="case-table">
          <div className="case-table-head">
            <span>Case</span>
            <span>Owner</span>
            <span>Due</span>
            <span>Status</span>
            <span>Coordination</span>
          </div>
          {cases.map(item => (
            <div className="case-row" key={item.id}>
              <button className="case-main" onClick={() => onSelect(item.id)}>
                <span className="object-icon">
                  {item.objectType.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.criterion} · {item.vantaObjectId}
                  </small>
                </span>
              </button>
              <span className="owner-cell">
                <span className="avatar">{initials(item.owner)}</span>
                {item.owner}
              </span>
              <span className="due-cell">{item.dueAt || '—'}</span>
              <Badge
                className="case-status-badge"
                variant={
                  item.status === 'verified'
                    ? 'success'
                    : item.status === 'awaiting-verification'
                      ? 'warning'
                      : 'secondary'
                }
              >
                {statusLabel[item.status]}
              </Badge>
              <div className="row-actions">
                {!item.channelId && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Create issue channel"
                    aria-label={`Create channel for ${item.title}`}
                    disabled={!allowed || Boolean(busy)}
                    onClick={() => onChannel(item)}
                  >
                    <Users />
                  </Button>
                )}
                {!item.workflowRunId && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Invoke saved workflow"
                    aria-label={`Invoke workflow for ${item.title}`}
                    disabled={!allowed || Boolean(busy)}
                    onClick={() => onWorkflow(item)}
                  >
                    <Workflow />
                  </Button>
                )}
                {nextStatus[item.status] && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !allowed ||
                      (nextStatus[item.status] === 'verified' &&
                        role !== 'lead') ||
                      Boolean(busy)
                    }
                    onClick={() => onTransition(item, nextStatus[item.status]!)}
                  >
                    {statusLabel[nextStatus[item.status]!]} <ArrowRight />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {!allowed && (
        <Alert variant="info">
          <ShieldCheck />
          <AlertDescription>
            Viewer access is read-only. TAP authorization still governs every
            platform operation.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function FocusedView({
  icon: Icon,
  eyebrow,
  title,
  description,
  action,
  disabled,
  busy,
  onAction,
  analyses,
  onSelect,
}: {
  icon: typeof FileSearch;
  eyebrow: string;
  title: string;
  description: string;
  action: string;
  disabled: boolean;
  busy: boolean;
  onAction: () => void;
  analyses: CompanionState['analyses'];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="page">
      <section className="focus-hero">
        <div className="focus-icon">
          <Icon />
        </div>
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <H1>{title}</H1>
          <p>{description}</p>
          <Button onClick={onAction} disabled={disabled || busy}>
            {busy ? <LoaderCircle className="spin" /> : <Sparkles />} {action}
          </Button>
        </div>
      </section>
      <section>
        <div className="section-title">
          <div>
            <h2>Recent outputs</h2>
            <p>
              Each output is retained with its source channel and model receipt.
            </p>
          </div>
        </div>
        {analyses.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <Icon />
              <EmptyTitle>No completed analysis</EmptyTitle>
              <EmptyDescription>
                Run the source-backed specialist to create the first durable
                output.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="output-grid">
            {analyses.map(item => (
              <Card key={item.id} onClick={() => onSelect(item.id)}>
                <CardHeader>
                  <CardTitle>{item.title}</CardTitle>
                  <CardDescription>
                    {new Date(item.createdAt).toLocaleString()}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="output-preview">
                    {item.content.slice(0, 220)}
                    {item.content.length > 220 ? '…' : ''}
                  </p>
                  <Button variant="ghost">
                    Open output <ArrowRight />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function WorkflowsView({
  state,
  connected,
  onDesign,
}: {
  state: CompanionState;
  connected: boolean;
  onDesign: () => void;
}) {
  const attached = state.cases.filter(item => item.workflowRunId);
  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Reusable execution</span>
          <H1>Workflows</H1>
          <p>
            Case-linked runs use approved workspace workflows and pass Vanta
            provenance in their payload.
          </p>
        </div>
        <Button variant="outline" disabled={!connected} onClick={onDesign}>
          <Sparkles /> Design recurring workflow
        </Button>
      </section>
      <div className="workflow-principles">
        <Card>
          <CardContent>
            <RefreshCw />
            <div>
              <strong>Idempotent</strong>
              <p>Run receipts prevent replay from appearing as new work.</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <CheckCircle2 />
            <div>
              <strong>Approval-safe</strong>
              <p>Consequential Vanta writes remain fresh human decisions.</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Link2 />
            <div>
              <strong>Traceable</strong>
              <p>Every run carries case and Vanta source identifiers.</p>
            </div>
          </CardContent>
        </Card>
      </div>
      {attached.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <Workflow />
            <EmptyTitle>No case-linked workflow runs</EmptyTitle>
            <EmptyDescription>
              Invoke an existing approved workspace workflow from a remediation
              case.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup>
          {attached.map(item => (
            <Item key={item.id}>
              <ItemMedia variant="icon">
                <Workflow />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{item.title}</ItemTitle>
                <ItemDescription>{item.workflowRunId}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant="success">Started</Badge>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
    </div>
  );
}

function ActivityView({
  state,
  apiUrlDraft,
  onApiUrlChange,
  onSaveEndpoint,
  onOpenAccess,
  onSync,
  busy,
}: {
  state: CompanionState;
  apiUrlDraft: string;
  onApiUrlChange: (value: string) => void;
  onSaveEndpoint: () => void;
  onOpenAccess: () => void;
  onSync: () => void;
  busy: string;
}) {
  const canConfigure = state.settings
    ? canCoordinate(state.settings.role)
    : false;
  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Audit trail</span>
          <H1>Activity</H1>
          <p>
            Host-confirmed actions and local case transitions, newest first.
          </p>
        </div>
      </section>
      <Card className="webhook-panel">
        <CardHeader className="section-card-header">
          <div>
            <CardTitle>Vanta webhook feed</CardTitle>
            <CardDescription>
              Verified by the Cloudflare Worker, scoped to this workspace, and
              imported as metadata only.
            </CardDescription>
          </div>
          <Badge
            variant={
              state.settings?.webhookLastSyncedAt ? 'success' : 'outline'
            }
          >
            {state.settings?.webhookLastSyncedAt
              ? 'Verified'
              : state.settings?.webhookApiUrl
                ? 'Configured'
                : 'Not configured'}
          </Badge>
        </CardHeader>
        <CardContent className="webhook-panel-content">
          <Field>
            <FieldLabel htmlFor="webhook-api-url">
              Cloudflare Worker API URL
            </FieldLabel>
            <Input
              id="webhook-api-url"
              name="webhook-api-url"
              type="url"
              autoComplete="off"
              spellCheck={false}
              value={apiUrlDraft}
              onChange={event => onApiUrlChange(event.target.value)}
              placeholder="https://vanta-companion-api.example.com…"
              disabled={!canConfigure || busy === 'webhook-config'}
            />
            <FieldDescription>
              Store only the origin. Access handles user authentication; no API
              token is stored by this miniapp.
            </FieldDescription>
          </Field>
          <ButtonGroup className="webhook-actions">
            <Button
              variant="outline"
              onClick={onSaveEndpoint}
              disabled={!canConfigure || !apiUrlDraft || Boolean(busy)}
            >
              {busy === 'webhook-config' ? (
                <LoaderCircle className="spin" />
              ) : (
                <Settings2 />
              )}{' '}
              Save endpoint
            </Button>
            <Button
              variant="outline"
              onClick={onOpenAccess}
              disabled={!apiUrlDraft || Boolean(busy)}
            >
              <ExternalLink /> Open Access sign-in
            </Button>
            <Button
              onClick={onSync}
              disabled={!state.settings?.webhookApiUrl || Boolean(busy)}
            >
              {busy === 'webhook-sync' ? (
                <LoaderCircle className="spin" />
              ) : (
                <RefreshCw />
              )}{' '}
              Sync verified events
            </Button>
          </ButtonGroup>
          {!canConfigure && (
            <Alert variant="info">
              <ShieldCheck />
              <AlertDescription>
                Viewer access can inspect imported events but cannot replace the
                workspace endpoint.
              </AlertDescription>
            </Alert>
          )}
          <div className="webhook-event-list" aria-live="polite">
            {state.webhookEvents.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <Activity />
                  <EmptyTitle>No imported webhook events</EmptyTitle>
                  <EmptyDescription>
                    Deploy the Worker, register its signed endpoint in Vanta,
                    authenticate through Access, then sync. No events are
                    generated locally.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ItemGroup>
                {state.webhookEvents.slice(0, 50).map(event => (
                  <Item key={event.id}>
                    <ItemMedia variant="icon">
                      <Activity />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{event.eventType}</ItemTitle>
                      <ItemDescription>
                        Received {new Date(event.receivedAt).toLocaleString()}
                        {event.occurredAt
                          ? ` · Occurred ${new Date(event.occurredAt).toLocaleString()}`
                          : ''}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <code>{event.id}</code>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          {state.receipts.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <History />
                <EmptyTitle>No completed actions</EmptyTitle>
                <EmptyDescription>
                  Receipts appear only after an operation succeeds.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="timeline">
              {state.receipts.map(receipt => (
                <div key={receipt.id}>
                  <span className="timeline-dot">
                    <Check />
                  </span>
                  <div>
                    <strong>{receipt.summary}</strong>
                    <p>
                      {receipt.kind} · {receipt.actor} ·{' '}
                      {new Date(receipt.createdAt).toLocaleString()}
                    </p>
                    <code>{receipt.sourceId}</code>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="scope-card">
        <CardHeader>
          <CardTitle>Scope & connection</CardTitle>
        </CardHeader>
        <CardContent className="scope-grid">
          <div>
            <span>Workspace</span>
            <strong>{state.settings?.workspaceId}</strong>
          </div>
          <div>
            <span>Project</span>
            <strong>{state.settings?.projectId || 'Workspace-wide'}</strong>
          </div>
          <div>
            <span>Operations channel</span>
            <strong>{state.settings?.channelId || 'Not created'}</strong>
          </div>
          <div>
            <span>Vanta region</span>
            <strong>{state.settings?.region.toUpperCase()}</strong>
          </div>
          <div>
            <span>Timezone</span>
            <strong>{state.settings?.timezone}</strong>
          </div>
          <div>
            <span>Storage schema</span>
            <strong>Version 3</strong>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <Card className={`metric metric-${tone}`}>
      <CardContent>
        <div className="metric-top">
          <span className="metric-icon">
            <Icon />
          </span>
          <span>{label}</span>
        </div>
        <strong>{value}</strong>
        <p>{detail}</p>
      </CardContent>
    </Card>
  );
}
function Action({
  icon: Icon,
  title,
  description,
  onClick,
  disabled,
}: {
  icon: typeof Activity;
  title: string;
  description: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}>
      <span className="action-icon">
        <Icon />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <ChevronRight />
    </button>
  );
}
const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
const initials = (value: string): string =>
  value
    .split(/\s+/u)
    .slice(0, 2)
    .map(item => item.slice(0, 1).toLocaleUpperCase())
    .join('');
const dayPeriod = (): string => {
  const hour = new Date().getHours();
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
};
const relativeDate = (value: string): string => {
  const delta = Date.now() - Date.parse(value);
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(value).toLocaleDateString();
};
