import {
  sdk,
  type MiniAppSpecialistTurnResult,
} from '@theaiplatform/miniapp-sdk/sdk';
import type {
  LedgerState,
  SpecialistTask,
  SpecialistToolReceipt,
} from './domain';
import {
  parseAdministrationDraftToolResult,
  type AdministrationDraft,
} from './administration-draft';

export const HEALTH_SPECIALIST_ID = 'personal-health-researcher';
export const GROK_MODEL_PREFERENCE = 'xai/grok-latest';
export const HEALTH_SPECIALIST_TOOLS = [
  'web_search',
  'web_fetch',
  'draft_administration',
] as const;

const taskInstructions: Record<SpecialistTask, string> = {
  'research-update':
    'Prepare a current research update. Search and fetch authoritative sources. Cover regulatory status, human evidence, preclinical evidence only when relevant, material safety signals, and active trials. Cite URLs and state the search date. Do not translate preclinical exposure into a human dose.',
  'anecdotal-pulse':
    'Prepare an anecdotal pulse using indexed web discovery. Use site:x.com queries and other public forums when useful. Keep anecdotes separate from scientific evidence, describe selection bias, cite public URLs, and explicitly state that native X Search was not available.',
  'log-administration':
    'Prepare one administration draft from the user message and supplied IDs. Call draft_administration exactly once with itemId, lotId when identifiable, plannedAt when provided, actualAt, dose, unit, route, site, status, reason, reaction, and instructionSource. Do not calculate, recommend, or infer a dose. Never claim the administration was recorded or inventory changed; tell the user the surface must validate and confirm the draft.',
  'record-audit':
    'Audit the supplied minimum-necessary ledger excerpt. Identify missing provenance, contradictory units or dates, stale or unclear schedules, inventory mismatches, and unresolved safety follow-up. Do not infer facts that are absent and do not provide medical advice.',
  'results-review':
    'Review the supplied outcome period, contemporaneous administrations, schedule context, and confounders. State data completeness, describe only temporal associations, preserve counterexamples, and identify useful clinician questions. Never assign causality.',
  'appointment-summary':
    'Prepare a concise factual appointment brief and prioritized questions for a licensed clinician from the supplied minimum-necessary ledger excerpt. Preserve uncertainty and do not diagnose, prescribe, or recommend a dose.',
};

function selectedItemContext(state: LedgerState, itemId: string) {
  const item = state.items.find(candidate => candidate.id === itemId);
  if (!item) throw new Error('Choose a tracked item for this specialist task.');
  return {
    canonicalName: item.canonicalName || item.name,
    category: item.category,
    jurisdiction: item.jurisdiction || state.jurisdiction,
    regulatoryStatus: item.regulatoryStatus || 'not recorded',
  };
}

function selectedResearchScope(state: LedgerState, viewId: string) {
  const view = state.savedViews.find(candidate => candidate.id === viewId);
  if (!view)
    throw new Error('Choose a saved research view for this specialist task.');
  return {
    name: view.name,
    regulatoryScope: view.scope,
    includedEvidenceTypes: view.evidenceTypes,
  };
}

function privateLedgerExcerpt(state: LedgerState) {
  return {
    jurisdiction: state.jurisdiction,
    regimen: state.items
      .filter(item => item.status === 'active')
      .slice(0, 20)
      .map(item => ({
        itemId: item.id,
        name: item.canonicalName || item.name,
        category: item.category,
        route: item.route,
        regulatoryStatus: item.regulatoryStatus,
        currentSchedule: item.schedules.at(-1) ?? null,
        sourceRecord: item.sourceRecord,
        clinicianQuestions: item.clinicianQuestions,
      })),
    recentAdministrations: state.administrations.slice(-20).map(entry => ({
      itemId: entry.itemId,
      plannedAt: entry.plannedAt,
      actualAt: entry.actualAt,
      dose: entry.dose,
      unit: entry.unit,
      route: entry.route,
      status: entry.status,
      reaction: entry.reaction,
      instructionSource: entry.instructionSource,
    })),
    recentOutcomes: state.outcomes.slice(-20).map(outcome => ({
      kind: outcome.kind,
      name: outcome.name,
      value: outcome.value,
      unit: outcome.unit,
      occurredAt: outcome.occurredAt,
      source: outcome.source,
    })),
    recentConfounders: state.confounders.slice(-20).map(confounder => ({
      kind: confounder.kind,
      occurredAt: confounder.occurredAt,
      note: confounder.note,
    })),
    adverseEvents: state.adverseEvents.slice(-20).map(event => ({
      itemId: event.itemId,
      severity: event.severity,
      occurredAt: event.occurredAt,
      description: event.description,
      actionTaken: event.actionTaken,
    })),
  };
}

function administrationDraftContext(state: LedgerState) {
  const activeItemIds = new Set(
    state.items.filter(item => item.status === 'active').map(item => item.id),
  );
  return {
    activeItems: state.items
      .filter(item => activeItemIds.has(item.id))
      .slice(0, 20)
      .map(item => ({
        itemId: item.id,
        name: item.canonicalName || item.name,
        route: item.route,
        currentSchedule: item.schedules.at(-1) ?? null,
        instructionSource: item.sourceRecord,
      })),
    inventoryLots: state.lots
      .filter(lot => activeItemIds.has(lot.itemId) && lot.currentQuantity > 0)
      .slice(0, 30)
      .map(lot => ({
        lotId: lot.id,
        itemId: lot.itemId,
        lotNumber: lot.lotNumber,
        currentQuantity: lot.currentQuantity,
        unit: lot.unit,
        expiresOn: lot.expiresOn,
      })),
    recentAdministrations: state.administrations.slice(-10).map(entry => ({
      itemId: entry.itemId,
      lotId: entry.lotId,
      actualAt: entry.actualAt,
      dose: entry.dose,
      unit: entry.unit,
      route: entry.route,
      status: entry.status,
    })),
  };
}

export function buildSpecialistPrompt(options: {
  task: SpecialistTask;
  state: LedgerState;
  itemId: string;
  viewId: string;
  question: string;
  privateContextApproved: boolean;
}): string {
  if (!options.privateContextApproved)
    throw new Error(
      'Approve the minimum-necessary private context before running the specialist.',
    );
  const context =
    options.task === 'research-update' || options.task === 'anecdotal-pulse'
      ? {
          selectedItem: selectedItemContext(options.state, options.itemId),
          researchScope: selectedResearchScope(options.state, options.viewId),
        }
      : options.task === 'log-administration'
        ? administrationDraftContext(options.state)
      : privateLedgerExcerpt(options.state);
  return [
    taskInstructions[options.task],
    `Request timestamp: ${new Date().toISOString()}`,
    '',
    'The following JSON is private, user-approved context. Use only these fields and do not infer identity:',
    JSON.stringify(context, null, 2),
    ...(options.question.trim()
      ? ['', 'User question:', options.question.trim()]
      : []),
  ].join('\n');
}

export async function installHealthSpecialist(workspaceId: string): Promise<{
  specialistId: string;
  channelId: string;
}> {
  if (!workspaceId.trim())
    throw new Error('This TAP surface has no workspace context.');
  if (!sdk.specialist)
    throw new Error('This TAP host does not support package specialists.');
  const projected = (await sdk.specialist.listWorkspace(workspaceId)).find(
    specialist => specialist.slug === HEALTH_SPECIALIST_ID,
  );
  if (!projected)
    throw new Error(
      'The package-owned Personal Health Researcher is not projected into this workspace.',
    );
  const channel = await sdk.channels.create({
    workspaceId,
    name: 'Personal Health Ledger research',
    description:
      'Private, user-approved specialist research and record-review turns for Personal Health Ledger.',
    visibility: 'private',
  });
  await sdk.specialist.joinToChannel(channel.roomId, projected.id);
  return { specialistId: projected.id, channelId: channel.roomId };
}

export async function runHealthSpecialist(options: {
  workspaceId: string;
  channelId: string;
  specialistId: string;
  task: SpecialistTask;
  content: string;
}): Promise<{
  content: string;
  modelUsed: string;
  toolReceipts: readonly SpecialistToolReceipt[];
  administrationDraft: AdministrationDraft | null;
}> {
  if (!sdk.specialist?.runTurnWithTools)
    throw new Error(
      'This TAP host does not support tool-backed specialist turns.',
    );
  const result: MiniAppSpecialistTurnResult =
    await sdk.specialist.runTurnWithTools({
      workspaceId: options.workspaceId,
      channelId: options.channelId,
      specialistId: options.specialistId,
      content: options.content,
      modelOverride: 'auto',
      messageId: null,
      interactionMode: 'agentic',
      timeoutMs: 90_000,
    });
  return extractHealthSpecialistResult(options.task, result);
}

export function extractHealthSpecialistResult(
  task: SpecialistTask,
  result: MiniAppSpecialistTurnResult,
): {
  content: string;
  modelUsed: string;
  toolReceipts: readonly SpecialistToolReceipt[];
  administrationDraft: AdministrationDraft | null;
} {
  const textContent = result.completionEvent.parts
    .filter(
      (
        part,
      ): part is Extract<
        (typeof result.completionEvent.parts)[number],
        { type: 'text' }
      > => part.type === 'text',
    )
    .map(part => part.content)
    .join('\n\n')
    .trim();
  const toolParts = result.completionEvent.parts.filter(
    (
      part,
    ): part is Extract<
      (typeof result.completionEvent.parts)[number],
      { type: 'tool' }
    > => part.type === 'tool',
  );
  const administrationDraft =
    toolParts
      .filter(part => part.success)
      .map(part => parseAdministrationDraftToolResult(part.content))
      .find((draft): draft is AdministrationDraft => draft !== null) ?? null;
  const content =
    textContent ||
    (administrationDraft
      ? 'An administration draft is ready for your review and confirmation.'
      : '');
  if (!content)
    throw new Error(
      'The specialist completed without a readable response. Review its tool receipts and try again.',
    );
  const toolReceipts = toolParts
    .map(part => ({ toolName: part.toolName, success: part.success }))
    .filter(
      (receipt, index, receipts) =>
        receipts.findIndex(
          candidate =>
            candidate.toolName === receipt.toolName &&
            candidate.success === receipt.success,
        ) === index,
    );
  const unexpectedTool = toolReceipts.find(
    receipt =>
      !HEALTH_SPECIALIST_TOOLS.includes(
        receipt.toolName as (typeof HEALTH_SPECIALIST_TOOLS)[number],
      ) &&
      !toolParts.some(
        part =>
          part.toolName === receipt.toolName &&
          parseAdministrationDraftToolResult(part.content) !== null,
      ),
  );
  if (unexpectedTool)
    throw new Error(
      `The host reported an unexpected specialist tool: ${unexpectedTool.toolName}. The response was not saved.`,
    );
  if (
    (task === 'research-update' || task === 'anecdotal-pulse') &&
    !toolReceipts.some(
      receipt => receipt.toolName === 'web_search' && receipt.success,
    )
  )
    throw new Error(
      'The specialist did not return a successful web_search receipt, so this research response was not saved.',
    );
  if (task === 'log-administration' && !administrationDraft)
    throw new Error(
      'The specialist did not return a valid administration draft, so no ledger change was offered.',
    );
  return {
    content,
    modelUsed: result.completionEvent.modelUsed ?? '',
    toolReceipts,
    administrationDraft,
  };
}
