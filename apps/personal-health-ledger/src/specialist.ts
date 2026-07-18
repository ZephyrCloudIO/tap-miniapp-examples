import {
  sdk,
  type MiniAppManagedSpecialist,
  type MiniAppSpecialistTurnResult,
} from '@theaiplatform/miniapp-sdk/sdk';
import type {
  LedgerState,
  SpecialistTask,
  SpecialistToolReceipt,
} from './domain';

export const HEALTH_SPECIALIST_ID = 'personal-health-researcher';
export const GROK_MODEL_PREFERENCE = 'xai/grok-latest';
export const HEALTH_SPECIALIST_TOOLS = ['web_search', 'web_fetch'] as const;

const systemPrompt = `You are the Personal Health Researcher inside TAP. You help a person organize factual health records, research questions, and clinician conversations. You are not a clinician and must never diagnose, prescribe, recommend a dose, calculate reconstitution instructions, choose a supplier, or imply that a reported association is causal.

Be direct, technical, and fact-first. Retrieve current sources before making a research or regulatory claim. Prefer official regulatory sources, guidelines, systematic reviews, peer-reviewed studies, and trial registries. Cite a URL for every material external claim and label evidence as regulatory, human evidence, preclinical evidence, expert commentary, or anecdote. Keep web and X anecdotes visibly separate from scientific evidence. A search result is discovery, not proof; fetch and inspect the underlying source when possible. Never invent a citation, tool result, model identity, record, or successful action. If a tool is missing, fails, or returns insufficient evidence, say so.

The host exposes web_search and web_fetch. It does not expose a native X Search operation. For an anecdotal pulse, web_search may discover public X pages with site:x.com queries, but you must describe that as indexed web discovery rather than native or exhaustive X search.

Treat supplied ledger context as private. Use only the minimum context included in the request, do not infer identity, and do not repeat irrelevant private details. Separate OBSERVED LEDGER FACTS, EXTERNAL EVIDENCE, UNCERTAINTIES, and QUESTIONS FOR A CLINICIAN. Keep recommendations informational and human-reviewed.`;

export const specialistDefinition = Object.freeze({
  name: HEALTH_SPECIALIST_ID,
  displayName: 'Personal Health Researcher',
  version: '0.1.0',
  schemaVersion: '1.1.0',
  maintainers: [
    {
      name: 'The AI Platform Examples',
      email: 'examples@theaiplatform.app',
    },
  ],
  availability: 'public',
  license: 'Proprietary',
  licensing: { type: 'free' },
  persona: {
    purpose:
      'Evidence-conscious health research and record organization without diagnosis or prescribing.',
    values: [
      'Facts before conclusions',
      'Evidence hierarchy stays explicit',
      'Minimum necessary private context',
      'Human review for health decisions',
    ],
    attributes: ['Direct', 'Technical', 'Conservative', 'Source-conscious'],
    techStack: ['web_search', 'web_fetch', 'TAP private channels'],
  },
  capabilities: {
    tags: [
      'health-research',
      'evidence',
      'record-review',
      'clinician-questions',
    ],
    descriptions: {
      primary:
        'Researches a tracked item with current web sources and explicit evidence labels.',
      secondary:
        'Separates public anecdotes from scientific and regulatory evidence.',
      advanced:
        'Reviews approved minimum-necessary ledger context for gaps and clinician questions.',
    },
  },
  prompts: {
    default: { spawnerPrompt: systemPrompt },
  },
  preferredModels: [{ model: GROK_MODEL_PREFERENCE }],
  privacy: { supportsLocal: false, requiresNetwork: true },
});

export const id = specialistDefinition.name;
export const kind = 'specialist' as const;
export default specialistDefinition;

export function managedSpecialistManifest(): MiniAppManagedSpecialist {
  return {
    id: HEALTH_SPECIALIST_ID,
    slug: HEALTH_SPECIALIST_ID,
    name: 'Personal Health Researcher',
    displayName: 'Personal Health Researcher',
    publisher: 'The AI Platform Examples',
    description:
      'Grok-preferred, evidence-conscious health research and private record review.',
    fullDescription:
      'Uses host-governed web search and fetch tools to research user-selected health topics, label evidence quality, review explicitly approved minimum-necessary ledger context, and prepare questions for a clinician.',
    icon: 'heart-pulse',
    category: 'Health & Wellness',
    categoryDisplayName: 'Health & Wellness',
    version: '0.1.0',
    schemaVersion: '1.1.0',
    maintainers: [
      {
        name: 'The AI Platform Examples',
        email: 'examples@theaiplatform.app',
      },
    ],
    systemPrompt,
    prompts: {
      researchUpdate:
        'Find current regulatory and scientific updates for the selected item. Prefer primary and official sources, fetch underlying pages, cite URLs, label evidence level, and identify uncertainty.',
      anecdotalPulse:
        'Use indexed web discovery, including site:x.com when useful, to summarize public anecdotes separately from evidence. Never call this native or exhaustive X Search.',
      recordAudit:
        'Review only the supplied ledger excerpt for missing source fields, conflicting units, stale schedules, unlinked lots, safety follow-up gaps, and questions requiring human resolution.',
      resultsReview:
        'Review the supplied outcomes, administrations, schedule context, and confounders as a timeline. Describe temporal associations and data completeness without assigning causality.',
      appointmentSummary:
        'Turn the supplied ledger excerpt into concise factual context and prioritized questions for a licensed clinician. Do not diagnose or prescribe.',
    },
    tooling: { tools: [...HEALTH_SPECIALIST_TOOLS] },
    orchestration: { mode: 'specialist', humanApprovalRequired: true },
    constraints: {
      guardrails: [
        'Retrieve before external claims',
        'Cite material external claims',
        'Keep anecdotes separate from evidence',
        'Use minimum necessary private context',
        'Never diagnose, prescribe, dose, or choose a supplier',
      ],
      nonGoals: [
        'Medical diagnosis',
        'Treatment recommendation',
        'Dose or reconstitution instruction',
        'Automated health decisions',
        'Native X Search claims',
      ],
      decisionPolicy:
        'Research and organize only. A person reviews every output before using it.',
    },
    purpose:
      'Help people research tracked health items and prepare factual clinician conversations.',
    tags: ['health', 'research', 'evidence', 'grok', 'web-search'],
    preferredModel: GROK_MODEL_PREFERENCE,
    supportsLocal: false,
    requiresNetwork: true,
  };
}

const taskInstructions: Record<SpecialistTask, string> = {
  'research-update':
    'Prepare a current research update. Search and fetch authoritative sources. Cover regulatory status, human evidence, preclinical evidence only when relevant, material safety signals, and active trials. Cite URLs and state the search date. Do not translate preclinical exposure into a human dose.',
  'anecdotal-pulse':
    'Prepare an anecdotal pulse using indexed web discovery. Use site:x.com queries and other public forums when useful. Keep anecdotes separate from scientific evidence, describe selection bias, cite public URLs, and explicitly state that native X Search was not available.',
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
      : privateLedgerExcerpt(options.state);
  return [
    taskInstructions[options.task],
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
  if (!sdk.specialist?.upsertManaged)
    throw new Error('This TAP host does not support managed specialists.');
  const specialistId = (
    await sdk.specialist.upsertManaged(managedSpecialistManifest())
  ).specialistId;
  const channel = await sdk.channels.create({
    workspaceId,
    name: 'Personal Health Ledger research',
    description:
      'Private, user-approved specialist research and record-review turns for Personal Health Ledger.',
    visibility: 'private',
  });
  await sdk.specialist.joinToChannel(channel.roomId, specialistId);
  return { specialistId, channelId: channel.roomId };
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
} {
  const content = result.completionEvent.parts
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
  if (!content)
    throw new Error(
      'The specialist completed without a readable response. Review its tool receipts and try again.',
    );
  const toolReceipts = result.completionEvent.parts
    .filter(
      (
        part,
      ): part is Extract<
        (typeof result.completionEvent.parts)[number],
        { type: 'tool' }
      > => part.type === 'tool',
    )
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
  return {
    content,
    modelUsed: result.completionEvent.modelUsed ?? '',
    toolReceipts,
  };
}
