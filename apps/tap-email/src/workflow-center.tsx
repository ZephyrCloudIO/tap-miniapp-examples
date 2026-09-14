import {
  sdk,
  type MiniAppPlatformApi,
} from '@theaiplatform/miniapp-sdk/sdk';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Textarea,
} from '@theaiplatform/miniapp-sdk/ui';
import { Play, Rows3, Sparkles } from 'lucide-react';
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { MailCommand, MailDraftPayload } from '@tap-examples/tap-email-protocol';
import type { EmailActivityProjection } from './activity';
import {
  commandsForReviewedMailMerge,
  createEmailActivityWorkflowPayload,
  createMailMergePlan,
  createMailboxRollupPayload,
  emailWorkflowDefinitions,
  grantMailMergeReview,
  isMailboxRollupResource,
  invokeSavedEmailWorkflow,
  MAILBOX_ROLLUP_RESOURCES,
  MAXIMUM_MAIL_MERGE_RECIPIENTS,
  MAXIMUM_ROLLUP_ITEMS,
  type EmailWorkflowDefinition,
  type EmailWorkflowKind,
  type EmailWorkflowRunState,
  type MailboxRollupPayload,
  type MailMergePlan,
  type MailMergeRecipientInput,
} from './email-workflows';
import { mailViewDefinition } from './mail-navigation';
import type { MailState } from './domain';
import './workflow-center.css';

type WorkflowPlatform = Pick<MiniAppPlatformApi, 'workflows'>;

export interface WorkflowCenterProps {
  readonly idFactory: () => string;
  readonly loadActivityProjection: () => Promise<EmailActivityProjection>;
  readonly mailState: MailState;
  readonly onClose: () => void;
  readonly persistMailMergeDrafts: (
    commands: readonly MailCommand<MailDraftPayload>[],
  ) => Promise<unknown>;
  readonly platform?: WorkflowPlatform;
  readonly workspaceId: string | null;
}

const runnableSavedWorkflows = emailWorkflowDefinitions.filter(
  definition => definition.source === 'saved-workflow',
);

function localDateTimeValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isoFromLocalDateTime(value: string, field: string): string {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) {
    throw new Error(`${field} must be a valid date and time.`);
  }
  return date.toISOString();
}

function defaultRange(state: MailState): { start: string; end: string } {
  const selectedAccounts = state.accounts.filter(account =>
    state.selectedAccountId === 'all' || account.accountId === state.selectedAccountId);
  const observedThrough = selectedAccounts
    .map(account => Date.parse(account.coverage.observedAt))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0] ?? Date.now();
  return {
    start: localDateTimeValue(new Date(observedThrough - 24 * 60 * 60 * 1_000)),
    end: localDateTimeValue(new Date(observedThrough)),
  };
}

export function parseMailMergeRecipients(value: string): readonly MailMergeRecipientInput[] {
  return value
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const angle = /^(.*?)\s*<([^<>]+)>$/u.exec(line);
      if (angle) return { name: angle[1]!.trim(), email: angle[2]!.trim() };
      const comma = /^([^,]+),(.+)$/u.exec(line);
      if (comma) return { name: comma[1]!.trim(), email: comma[2]!.trim() };
      return { name: '', email: line };
    });
}

function runStatusLabel(state: EmailWorkflowRunState | undefined): string {
  if (!state) return 'Ready';
  return state.phase[0]!.toLocaleUpperCase('en-US') + state.phase.slice(1);
}

function WorkflowRunStatus({ state }: { readonly state: EmailWorkflowRunState | undefined }) {
  if (!state) return null;
  return (
    <div
      aria-live="polite"
      className={`workflow-run-status is-${state.phase}`}
      role={state.phase === 'failed' ? 'alert' : 'status'}
    >
      <strong>{runStatusLabel(state)}</strong>
      <span>{state.message}</span>
      {state.runId ? <small>Run {state.runId}</small> : null}
    </div>
  );
}

function RollupReceipt({ payload }: { readonly payload: MailboxRollupPayload }) {
  const receipt = payload.coverageReceipt;
  return (
    <div className={`workflow-coverage-receipt${receipt.complete ? '' : ' is-partial'}`}>
      <strong>{receipt.complete ? 'Coverage complete' : 'Partial coverage'}</strong>
      <span>
        {payload.scope.accountIds.length} account{payload.scope.accountIds.length === 1 ? '' : 's'} ·{' '}
        {payload.scope.resources.map(resource => mailViewDefinition(resource).label).join(', ')}
      </span>
      <small>{payload.scope.startAt} → {payload.scope.endAtExclusive}</small>
      <small>Available through {receipt.availableThrough ?? 'unknown'} · receipt checked {receipt.observedAt}</small>
      <small>{payload.counts.total} conversations · {payload.counts.needsResponse} need a reply · {payload.counts.waitingOnOthers} waiting</small>
      {payload.resultTruncated ? (
        <small>Result list limited to the newest {MAXIMUM_ROLLUP_ITEMS} matching conversations; aggregate counts cover the full local match.</small>
      ) : null}
      {receipt.warnings.length > 0 ? (
        <ul>{receipt.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
      ) : null}
    </div>
  );
}

export function WorkflowCenter({
  idFactory,
  loadActivityProjection,
  mailState,
  onClose,
  persistMailMergeDrafts,
  platform = sdk,
  workspaceId,
}: WorkflowCenterProps) {
  const initialRange = useMemo(() => defaultRange(mailState), [mailState]);
  const [accountScope, setAccountScope] = useState(mailState.selectedAccountId);
  const [resource, setResource] = useState(() =>
    isMailboxRollupResource(mailState.selectedSplit)
      ? mailState.selectedSplit
      : MAILBOX_ROLLUP_RESOURCES[0],
  );
  const [startLocal, setStartLocal] = useState(initialRange.start);
  const [endLocal, setEndLocal] = useState(initialRange.end);
  const [launching, setLaunching] = useState<EmailWorkflowKind | null>(null);
  const [runStates, setRunStates] = useState<Partial<Record<EmailWorkflowKind, EmailWorkflowRunState>>>({});
  const [rollups, setRollups] = useState<Partial<Record<EmailWorkflowKind, MailboxRollupPayload>>>({});
  const cleanupByKind = useRef(new Map<EmailWorkflowKind, () => void>());

  const [mergeAccountId, setMergeAccountId] = useState(
    mailState.selectedAccountId === 'all'
      ? mailState.accounts[0]?.accountId ?? ''
      : mailState.selectedAccountId,
  );
  const [recipientText, setRecipientText] = useState('');
  const [subjectTemplate, setSubjectTemplate] = useState('');
  const [bodyTemplate, setBodyTemplate] = useState('');
  const [mergePlan, setMergePlan] = useState<MailMergePlan | null>(null);
  const [mergeReviewed, setMergeReviewed] = useState(false);
  const [mergeError, setMergeError] = useState('');

  useEffect(() => () => {
    for (const cleanup of cleanupByKind.current.values()) cleanup();
    cleanupByKind.current.clear();
  }, []);

  const accountIds = accountScope === 'all'
    ? mailState.accounts.map(account => account.accountId)
    : [accountScope];

  const scope = () => ({
    accountIds,
    resources: [resource],
    startAt: isoFromLocalDateTime(startLocal, 'The workflow start'),
    endAtExclusive: isoFromLocalDateTime(endLocal, 'The workflow end'),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  });

  const updateRunState = (state: EmailWorkflowRunState) => {
    setRunStates(current => ({ ...current, [state.kind]: state }));
  };

  const runSavedWorkflow = async (definition: EmailWorkflowDefinition) => {
    if (!workspaceId || launching) return;
    setLaunching(definition.kind);
    cleanupByKind.current.get(definition.kind)?.();
    cleanupByKind.current.delete(definition.kind);
    try {
      const requestedScope = scope();
      const payload = definition.kind === 'email-activity-summary'
        ? createEmailActivityWorkflowPayload(
            await loadActivityProjection(),
            {
              startAt: requestedScope.startAt,
              endAtExclusive: requestedScope.endAtExclusive,
              timeZone: requestedScope.timeZone,
            },
          )
        : createMailboxRollupPayload(
            mailState,
            definition.kind as Exclude<EmailWorkflowKind, 'mail-merge' | 'email-activity-summary'>,
            requestedScope,
            new Date().toISOString(),
          );
      if ('coverageReceipt' in payload) {
        setRollups(current => ({ ...current, [definition.kind]: payload }));
      }
      const cleanup = await invokeSavedEmailWorkflow({
        platform,
        workspaceId,
        definition,
        payload,
        onState: updateRunState,
      });
      cleanupByKind.current.set(definition.kind, cleanup);
    } catch (error) {
      updateRunState({
        kind: definition.kind,
        phase: 'failed',
        message: error instanceof Error ? error.message : 'The workflow could not start.',
        runId: null,
        hostStatus: null,
        result: null,
      });
    } finally {
      setLaunching(null);
    }
  };

  const invalidateMergePreview = () => {
    setMergePlan(null);
    setMergeReviewed(false);
    setMergeError('');
    setRunStates(current => {
      const { ['mail-merge']: _removed, ...rest } = current;
      return rest;
    });
  };

  const previewMailMerge = async () => {
    setMergeError('');
    setMergeReviewed(false);
    try {
      setMergePlan(await createMailMergePlan({
        accountId: mergeAccountId,
        recipients: parseMailMergeRecipients(recipientText),
        subjectTemplate,
        bodyTemplate,
        now: new Date().toISOString(),
        idFactory,
      }));
    } catch (error) {
      setMergePlan(null);
      setMergeError(error instanceof Error ? error.message : 'The mail merge preview failed.');
    }
  };

  const createProviderDrafts = async () => {
    if (!mergePlan || !mergeReviewed || launching) return;
    setLaunching('mail-merge');
    setMergeError('');
    const now = new Date().toISOString();
    updateRunState({
      kind: 'mail-merge',
      phase: 'accepted',
      message: 'The reviewed recipient plan was accepted. No messages will be sent.',
      runId: mergePlan.planId,
      hostStatus: null,
      result: null,
    });
    try {
      const grant = grantMailMergeReview(mergePlan, {
        reviewedDraftDigests: mergePlan.drafts.map(draft => draft.digest),
        grantedAt: now,
        grantId: idFactory(),
      });
      const commands = commandsForReviewedMailMerge(mergePlan, grant, now);
      updateRunState({
        kind: 'mail-merge',
        phase: 'running',
        message: `Creating ${commands.length} provider-visible draft${commands.length === 1 ? '' : 's'} sequentially…`,
        runId: mergePlan.planId,
        hostStatus: null,
        result: null,
      });
      await persistMailMergeDrafts(commands);
      updateRunState({
        kind: 'mail-merge',
        phase: 'succeeded',
        message: `${commands.length} provider draft${commands.length === 1 ? ' is' : 's are'} ready for individual review. Nothing was sent.`,
        runId: mergePlan.planId,
        hostStatus: null,
        result: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider draft creation failed.';
      setMergeError(message);
      updateRunState({
        kind: 'mail-merge',
        phase: 'failed',
        message,
        runId: mergePlan.planId,
        hostStatus: null,
        result: null,
      });
    } finally {
      setLaunching(null);
    }
  };

  const parsedStart = Date.parse(startLocal);
  const parsedEnd = Date.parse(endLocal);
  const rangeInvalid = !Number.isFinite(parsedStart) ||
    !Number.isFinite(parsedEnd) ||
    parsedStart >= parsedEnd;

  return (
    <Dialog open onOpenChange={open => { if (!open && !launching) onClose(); }}>
      <DialogContent className="workflow-center-dialog" hideCloseButton>
        <header className="workflow-center-header">
          <div className="workflow-center-glyph"><Rows3 aria-hidden="true" /></div>
          <div>
            <DialogTitle>Email Workflows</DialogTitle>
            <DialogDescription>
              Launch a covered mailbox report, a content-free activity summary, or a review-only mail merge.
            </DialogDescription>
          </div>
          <Button variant="ghost" size="icon-sm" type="button" onClick={onClose} disabled={Boolean(launching)} aria-label="Close Email Workflows">×</Button>
        </header>

        <section className="workflow-scope" aria-labelledby="workflow-scope-title">
          <div>
            <h3 id="workflow-scope-title">Report scope</h3>
            <p>Every mailbox workflow carries these exact accounts, resources, dates, and its coverage receipt.</p>
          </div>
          <label>
            <span>Accounts</span>
            <select value={accountScope} onChange={event => setAccountScope(event.target.value)}>
              <option value="all">All connected accounts</option>
              {mailState.accounts.map(account => (
                <option key={account.accountId} value={account.accountId}>{account.displayName}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Mailbox resource</span>
            <select
              value={resource}
              onChange={event => {
                if (isMailboxRollupResource(event.target.value)) {
                  setResource(event.target.value);
                }
              }}
            >
              {MAILBOX_ROLLUP_RESOURCES.map(resourceId => (
                <option key={resourceId} value={resourceId}>
                  {mailViewDefinition(resourceId).label}
                </option>
              ))}
            </select>
            <small>
              Auto Archived, Scheduled, Outbox, and Snippets are unavailable for mailbox reports because they do not have thread-history coverage receipts yet.
            </small>
          </label>
          <label>
            <span>From</span>
            <Input type="datetime-local" value={startLocal} onChange={event => setStartLocal(event.target.value)} />
          </label>
          <label>
            <span>Through</span>
            <Input type="datetime-local" value={endLocal} onChange={event => setEndLocal(event.target.value)} />
          </label>
          {rangeInvalid ? <div className="workflow-inline-error" role="alert">Choose an end after the start.</div> : null}
        </section>

        <div className="workflow-list">
          {runnableSavedWorkflows.map(definition => {
            const state = runStates[definition.kind];
            const rollup = rollups[definition.kind];
            return (
              <section className="workflow-card" key={definition.kind}>
                <div className="workflow-card-copy">
                  <div className="workflow-card-title">
                    <h3>{definition.name}</h3>
                    <span className={`workflow-state-chip${state ? ` is-${state.phase}` : ''}`}>
                      {runStatusLabel(state)}
                    </span>
                  </div>
                  <p>{definition.description}</p>
                  {definition.kind === 'email-activity-summary' ? (
                    <small>Uses the installation-local committed-action aggregate; no subjects, bodies, recipients, or per-thread timeline.</small>
                  ) : null}
                </div>
                <Button
                  variant="outline"
                  type="button"
                  disabled={!workspaceId || rangeInvalid || Boolean(launching)}
                  onClick={() => { void runSavedWorkflow(definition); }}
                >
                  <Play aria-hidden="true" /> Run
                </Button>
                {rollup ? <RollupReceipt payload={rollup} /> : null}
                <WorkflowRunStatus state={state} />
              </section>
            );
          })}

          <section className="workflow-card workflow-mail-merge">
            <div className="workflow-card-copy">
              <div className="workflow-card-title">
                <h3>Mail Merge</h3>
                <span className={`workflow-state-chip${runStates['mail-merge'] ? ` is-${runStates['mail-merge']!.phase}` : ''}`}>
                  {runStatusLabel(runStates['mail-merge'])}
                </span>
              </div>
              <p>Create provider-visible personalized drafts only. Direct send is not available here.</p>
            </div>
            <div className="mail-merge-form">
              <label>
                <span>From account</span>
                <select
                  disabled={Boolean(launching)}
                  value={mergeAccountId}
                  onChange={event => {
                    setMergeAccountId(event.target.value);
                    invalidateMergePreview();
                  }}
                >
                  {mailState.accounts.map(account => (
                    <option key={account.accountId} value={account.accountId}>
                      {account.displayName} · {account.address}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Recipients · one per line, “Name &lt;email&gt;”</span>
                <Textarea
                  disabled={Boolean(launching)}
                  value={recipientText}
                  placeholder={`Avery Rivera <avery@example.com>\nBlake Chen <blake@example.com>`}
                  onChange={event => {
                    setRecipientText(event.target.value);
                    invalidateMergePreview();
                  }}
                />
                <small>Maximum {MAXIMUM_MAIL_MERGE_RECIPIENTS} unique recipients per reviewed run.</small>
              </label>
              <label>
                <span>Subject template</span>
                <Input
                  disabled={Boolean(launching)}
                  value={subjectTemplate}
                  placeholder="Hello {{name}}"
                  onChange={event => {
                    setSubjectTemplate(event.target.value);
                    invalidateMergePreview();
                  }}
                />
              </label>
              <label>
                <span>Message template</span>
                <Textarea
                  disabled={Boolean(launching)}
                  value={bodyTemplate}
                  placeholder="Hi {{name}}, …"
                  onChange={event => {
                    setBodyTemplate(event.target.value);
                    invalidateMergePreview();
                  }}
                />
                <small>Supported fields: {'{{name}}'} and {'{{email}}'}.</small>
              </label>
              <Button type="button" variant="outline" disabled={!workspaceId || Boolean(launching)} onClick={() => { void previewMailMerge(); }}>
                <Sparkles aria-hidden="true" /> Preview recipient drafts
              </Button>
            </div>

            {mergePlan ? (
              <div className="mail-merge-review">
                <h4>Review all {mergePlan.drafts.length} drafts</h4>
                <div className="mail-merge-preview-list">
                  {mergePlan.drafts.map(draft => (
                    <article key={draft.recipientId}>
                      <strong>To {draft.payload.to}</strong>
                      <span>{draft.payload.subject}</span>
                      <pre className="mail-merge-preview-body">{draft.payload.bodyText}</pre>
                    </article>
                  ))}
                </div>
                <label className="mail-merge-review-grant">
                  <Checkbox
                    checked={mergeReviewed}
                    disabled={Boolean(launching)}
                    onCheckedChange={checked => setMergeReviewed(checked === true)}
                  />
                  <span>I reviewed every recipient and personalized draft in this immutable plan.</span>
                </label>
                <Button
                  type="button"
                  disabled={!workspaceId || !mergeReviewed || Boolean(launching)}
                  onClick={() => { void createProviderDrafts(); }}
                >
                  Create provider drafts
                </Button>
              </div>
            ) : null}
            {mergeError ? <div className="workflow-inline-error" role="alert">{mergeError}</div> : null}
            <WorkflowRunStatus state={runStates['mail-merge']} />
          </section>
        </div>

        {!workspaceId ? (
          <div className="workflow-inline-error" role="alert">
            Saved workflows require a mounted TAP workspace. Mail merge draft creation remains unavailable until the mailbox is mounted.
          </div>
        ) : null}
        <footer className="workflow-boundary-note">
          TAP SDK 0.15 can list, invoke, and observe saved runs. It cannot create recurring schedules; notifications are not used as a scheduler.
        </footer>
      </DialogContent>
    </Dialog>
  );
}
