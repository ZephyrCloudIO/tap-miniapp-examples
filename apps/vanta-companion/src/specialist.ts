import {
  sdk,
  type MiniAppSpecialistTurnResult,
} from '@theaiplatform/miniapp-sdk/sdk';
import type { AnalysisKind, CompanionState, VantaRegion } from './domain';

export const VANTA_SPECIALIST_SLUGS: Readonly<Record<VantaRegion, string>> = {
  us: 'vanta-soc2-companion-us',
  eu: 'vanta-soc2-companion-eu',
  aus: 'vanta-soc2-companion-aus',
};
const LEGACY_MANAGED_SPECIALIST_ID = 'vanta-soc2-companion';

export function clearLegacyManagedSpecialist(
  state: CompanionState,
): CompanionState {
  if (state.settings?.specialistId !== LEGACY_MANAGED_SPECIALIST_ID) {
    return state;
  }
  return {
    ...state,
    settings: {
      ...state.settings,
      specialistId: null,
    },
  };
}

export const analysisTitle: Record<AnalysisKind, string> = {
  readiness: 'SOC 2 readiness briefing',
  'failed-tests': 'Failed-test triage',
  evidence: 'Evidence preparation',
  'auditor-response': 'Auditor response draft',
  remediation: 'Remediation plan',
  'controls-monitoring': 'Controls & monitoring analysis',
  'documents-evidence': 'Documents & evidence analysis',
  'people-devices': 'People & device analysis',
  'vendor-risk': 'Vendor & risk analysis',
  'vulnerability-management': 'Vulnerability analysis',
  'trust-customer': 'Trust Center analysis',
  'integrations-resources': 'Integration resource analysis',
  'recurring-workflow': 'Recurring compliance workflow',
  custom: 'Specialist analysis',
};

export function analysisPrompt(kind: AnalysisKind, context: string): string {
  const shared =
    'Use allowlisted Vanta MCP tools for every Vanta fact. Cite object IDs and deep links. Clearly label facts, inferences, recommendations, actions, unavailable data, and unknowns. Do not perform a Vanta write.';
  const prompts: Record<AnalysisKind, string> = {
    readiness:
      'Prepare a current SOC 2 readiness briefing from allowlisted Vanta MCP data. Cover frameworks, controls, tests, tested entities, documents, policies, people, risks, vendors, vulnerabilities, and integrations when retrieved. Separate newly failing or regressing items only when history exists. List specialist API-only blind spots. Do not invent percentages or audit-request state.',
    'failed-tests':
      'Triage the highest-priority current failing SOC 2 tests. For each, retrieve affected entities, integration state, related controls, and available evidence; classify the cause and recommend the smallest safe next step.',
    evidence:
      'Review current control evidence needs using allowlisted Vanta documents and control mappings. Find existing authorized evidence and assess freshness, period coverage, completeness, confidentiality, and provenance. Prepare candidates only; do not upload or submit.',
    'auditor-response':
      'The allowlisted MCP does not expose Auditor API information requests. Do not imply it does. Direct the user to the miniapp host API bridge for retrieval, then structure only the exact request supplied below and independently retrieved authorized evidence as an incomplete human-review draft. Do not send or submit anything.',
    remediation:
      'Create a verifiable remediation plan for the referenced Vanta object. Include scope, owner, tasks, acceptance criteria, required evidence, rollback, approval gates, and refreshed-Vanta verification.',
    'controls-monitoring':
      'Analyze controls, frameworks, tests, tested entities, policies, and control documents in the requested scope. Call out issues and security tasks as unavailable API families unless a tool returned them.',
    'documents-evidence':
      'Analyze authorized Vanta documents, control mappings, links, uploads, and downloadable evidence for freshness, period, completeness, confidentiality, and provenance. Do not mutate Vanta.',
    'people-devices':
      'Analyze authorized people, groups, membership, and monitored-computer state with minimum necessary PII. Call out background checks, training, and account data as unavailable when not returned.',
    'vendor-risk':
      'Analyze retrieved risk scenarios, discovered vendors, managed vendors, risk attributes, compliance material, findings, assessments, and security reviews. Make no risk or approval decision.',
    'vulnerability-management':
      'Analyze retrieved vulnerabilities, vulnerable assets, and remediations. Rank only from observed severity, deadline, ownership, exposure, and status; identify scanner-specific blind spots.',
    'trust-customer':
      'Analyze retrieved Trust Center controls, resources, documents, access requests, viewer activity, FAQs, subprocessors, updates, and subscribers. Do not approve access, modify answers, complete questionnaires, or publish.',
    'integrations-resources':
      'Analyze connected integrations, resource kinds, schemas, resources, and connection health. Do not execute custom-resource or test-outcome writes; direct a compliance lead to the human-operated host API bridge for a fresh decision.',
    'recurring-workflow':
      'Draft a reusable recurring compliance workflow. Identify the control objective, cadence, trigger, human owner, approver, allowlisted evidence source, completion condition, idempotency key, checkpoints, safe retry behavior, reminders, escalation, and fresh decision gates. Reuse existing TAP or Vanta work and never perform an external write.',
    custom:
      'Answer the compliance question below using current authorized Vanta data and only relevant scoped organizational sources.',
  };
  return `${prompts[kind]}\n\n${shared}${context.trim() ? `\n\nUser context:\n${context.trim()}` : ''}`;
}

export async function findPackageSpecialist(
  workspaceId: string,
  region: VantaRegion,
): Promise<string> {
  if (!workspaceId.trim())
    throw new Error('This TAP surface has no workspace context.');
  if (!sdk.specialist)
    throw new Error('This TAP host does not support package specialists.');
  const slug = VANTA_SPECIALIST_SLUGS[region];
  const projected = (await sdk.specialist.listWorkspace(workspaceId)).find(
    specialist => specialist.slug === slug,
  );
  if (!projected)
    throw new Error(
      `The package-owned Vanta specialist for region ${region.toUpperCase()} is not projected into this workspace.`,
    );
  return projected.id;
}

export async function runSpecialistAnalysis(options: {
  workspaceId: string;
  channelId: string;
  specialistId: string;
  kind: AnalysisKind;
  context: string;
}): Promise<{ content: string; modelUsed: string | null }> {
  if (!sdk.specialist?.runTurnWithTools)
    throw new Error(
      'This TAP host does not support tool-backed specialist turns.',
    );
  const result: MiniAppSpecialistTurnResult =
    await sdk.specialist.runTurnWithTools({
      workspaceId: options.workspaceId,
      channelId: options.channelId,
      specialistId: options.specialistId,
      content: analysisPrompt(options.kind, options.context),
      modelOverride: 'auto',
      messageId: null,
      interactionMode: 'agentic',
      timeoutMs: 90_000,
    });
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
      'The specialist completed without a readable response. Review the Vanta MCP connection and try again.',
    );
  return { content, modelUsed: result.completionEvent.modelUsed ?? null };
}
