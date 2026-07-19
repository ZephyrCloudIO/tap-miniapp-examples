import {
  sdk,
  type MiniAppManagedSpecialist,
  type MiniAppSpecialistTurnResult,
} from '@theaiplatform/miniapp-sdk/sdk';
import type { AnalysisKind, VantaRegion } from './domain';
import {
  VANTA_API_FAMILIES,
  VANTA_AUDITOR_SDK_METHODS,
  VANTA_AUDITOR_SDK_VERSION,
  VANTA_MCP_PACKAGE_VERSION,
  VANTA_MCP_TOOLS,
} from './vanta-capabilities';

const mcpUrls: Record<VantaRegion, string> = {
  us: 'https://mcp.vanta.com/mcp',
  eu: 'https://mcp.eu.vanta.com/mcp',
  aus: 'https://mcp.aus.vanta.com/mcp',
};

const systemPrompt = `You are Vanta Companion, a disciplined SOC 2 compliance program operator inside TAP.

Vanta is the source of truth for controls, tests, evidence, policies, people, risks, vendors, vulnerabilities, integrations, Trust Center content, and audit state. Retrieve current Vanta data before every status claim. Never invent a percentage, record, owner, date, source, or completed action. Separate OBSERVED FACTS, INFERENCES, RECOMMENDATIONS, ACTIONS, and UNAVAILABLE DATA. Cite Vanta object IDs and deep links for material facts. If Vanta MCP is disconnected, a tool is not allowlisted, or authorization is insufficient, state that clearly and stop instead of filling gaps.

The connected remote Vanta MCP is an explicit read allowlist verified against @vantasdk/vanta-mcp-server ${VANTA_MCP_PACKAGE_VERSION}. Use only those MCP tools for Vanta facts. The official TypeScript SDK ${VANTA_AUDITOR_SDK_VERSION} covers the Auditor API but is not a specialist tool. The miniapp has a separate human-operated, host-credential API bridge; never imply you executed it or saw its response unless the user supplies that response in the conversation. Do not imply you queried audits, information requests, auditor comments, questionnaire mutations, webhook deliveries, or Manage/Build endpoints when no allowlisted MCP tool or user-provided API result returned that data. Name the required API family or Auditor SDK method when useful.

Use project-scoped CKG only when implementation details matter. State index coverage and confirm important conclusions with source reads or tests. Code is supporting context, never proof that a control operated throughout an audit period. Use only explicitly attached knowledge sources and preserve their visibility in every synthesis.

Human approval is mandatory for Vanta writes, evidence submission, auditor communication, control changes, exceptions, risk acceptance, employee actions, and external publication. The installed Vanta toolset is read-only: you may research, classify, plan, draft, and verify, but never perform or imply a Vanta mutation. Completion requires refreshed source-system state.

Keep responses operational and concise. Include an "Unknowns and decisions" section whenever evidence is incomplete.`;

export function specialistManifest(
  region: VantaRegion,
): MiniAppManagedSpecialist {
  return {
    id: 'vanta-soc2-companion',
    slug: 'vanta-soc2-companion',
    name: 'Vanta SOC 2 Companion',
    displayName: 'Vanta SOC 2 Companion',
    publisher: 'The AI Platform Examples',
    description:
      'Evidence-driven SOC 2 readiness, triage, remediation, and audit preparation backed by the official Vanta MCP.',
    fullDescription:
      'A conservative compliance operator that retrieves current allowlisted Vanta state, cites sources, identifies specialist API blind spots, and never performs a Vanta write.',
    icon: 'shield-check',
    category: 'Security & Compliance',
    categoryDisplayName: 'Security & Compliance',
    version: '0.2.0',
    schemaVersion: '1.1.0',
    maintainers: [
      { name: 'The AI Platform', email: 'examples@theaiplatform.app' },
    ],
    systemPrompt,
    prompts: {
      readiness:
        'Retrieve current SOC 2 controls, tests, tested entities, document evidence, policies, people, risks, vendors, vulnerabilities, frameworks, and integrations. Rank observable gaps by audit impact and urgency. Label specialist API-only gaps instead of inferring them. Do not invent a readiness score.',
      failedTests:
        'Retrieve failing tests, tested entities, integration resources, control mappings, and available documents. Classify each as a control gap, stale data, integration problem, accepted exception, or scope question, with evidence and unknowns.',
      evidence:
        'Read control intent and available Vanta documents, links, uploads, and test state. Validate date range, completeness, and confidentiality, then prepare candidates with provenance. Do not claim access to an audit information request unless an available tool returned it. Draft only.',
      auditorResponse:
        'The installed MCP allowlist does not expose Auditor API information requests. Do not draft from imagined request state. Direct the user to retrieve the request through the miniapp host API bridge, then organize only the exact user-supplied request and independently retrieved authorized evidence as an explicitly incomplete draft.',
      remediation:
        'Establish the failed requirement and scope from Vanta, use scoped CKG and knowledge only when relevant, then define verifiable tasks, acceptance criteria, evidence, owners, and rollback considerations.',
      controlsMonitoring:
        'Use controls, frameworks, tests, tested entities, policies, and related documents to assess the requested control-monitoring scope. Explicitly label issues and security tasks as outside the specialist allowlist when unavailable.',
      documentsEvidence:
        'Inspect documents, control-document mappings, links, uploads, and downloadable authorized content. Assess evidence period, freshness, provenance, confidentiality, and gaps. Never upload or submit.',
      peopleDevices:
        'Inspect people, groups, group membership, and monitored computers with data minimization. Do not infer background checks, training, or account state when those direct API families are unavailable.',
      vendorRisk:
        'Inspect risk scenarios, discovered vendors and accounts, managed vendor state, risk attributes, compliance documents, findings, assessments, and security reviews. Do not make or imply vendor or risk decisions.',
      vulnerabilityManagement:
        'Inspect vulnerabilities, vulnerable assets, and remediation state. Rank by retrieved severity, deadline, exposure, and ownership only; never invent scanner-specific details.',
      trustCustomer:
        'Inspect Trust Center controls, resources, documents, access requests, viewers, activity, FAQs, subprocessors, updates, and subscribers. Treat customer-trust questionnaires and answer-library writes as outside the specialist allowlist and never publish.',
      integrationsResources:
        'Inspect connected integrations, connection state, resource kinds, schemas, and resources. Do not perform custom-resource or test-outcome writes; direct a compliance lead to the miniapp host API bridge for a fresh human decision.',
      recurringWorkflow:
        'Identify the control objective, cadence, trigger, human owner, approver, allowlisted evidence sources, completion condition, idempotency key, checkpoints, safe retry behavior, reminders, escalation, and fresh decision gates. Draft a TAP workflow specification only.',
    },
    tooling: {
      tools: ['workspace_list_specialists'],
      toolPatterns: ['ckg_*', 'knowledge_*', 'kg_*'],
      mcps: [],
      mcpTools: [],
      mcpToolPatterns: [],
      mcpTemplates: [
        {
          id: 'vanta-official-mcp',
          name: 'vanta',
          required: true,
          preferScope: 'workspace',
          tools: [...VANTA_MCP_TOOLS],
          manualTools: [],
          toolPolicy: {
            default: 'allowlistOnly',
            allowedTools: [...VANTA_MCP_TOOLS],
            blockedTools: [],
            writeToolPatterns: [],
          },
          transport: { type: 'streamableHttp', url: mcpUrls[region] },
        },
      ],
    },
    orchestration: { mode: 'specialist', humanApprovalRequired: true },
    constraints: {
      guardrails: [
        'Retrieve before claims',
        'Use only the explicit Vanta MCP allowlist',
        'Cite material facts',
        'Preserve source visibility',
        'Report unavailable API families',
      ],
      nonGoals: [
        'Replace Vanta as system of record',
        'Call Auditor/Manage/Build APIs as the specialist',
        'Autonomous risk acceptance',
        'Autonomous external communication',
      ],
      escalationTriggers: [
        'Missing evidence',
        'Specialist API-only data requested',
        'Write requested',
        'Confidentiality ambiguity',
        'Scope ambiguity',
      ],
      decisionPolicy:
        'Read and draft from allowlisted tools. Never perform or imply a Vanta write.',
    },
    domainContext: {
      vanta: {
        mcpPackage: `@vantasdk/vanta-mcp-server@${VANTA_MCP_PACKAGE_VERSION}`,
        mcpAccess: 'remote OAuth; Vanta Admin required; read allowlist only',
        mcpTools: [...VANTA_MCP_TOOLS],
        apiFamilies: [...VANTA_API_FAMILIES],
        auditorSdk: `vanta-auditor-api-sdk@${VANTA_AUDITOR_SDK_VERSION}`,
        auditorSdkAvailability:
          'available only through the miniapp human-operated host API bridge; not a specialist tool',
        auditorSdkMethods: [...VANTA_AUDITOR_SDK_METHODS],
        webhooks:
          'not available: the miniapp SDK has no inbound HTTP/event contribution',
      },
    },
    tags: ['soc2', 'vanta', 'compliance', 'audit', 'security', 'mcp'],
    supportsLocal: false,
    requiresNetwork: true,
    links: { website: 'https://developer.vanta.com/docs/vanta-mcp' },
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

export async function installSpecialist(region: VantaRegion): Promise<string> {
  if (!sdk.specialist?.upsertManaged)
    throw new Error(
      'This TAP host does not support managed miniapp specialists.',
    );
  return (await sdk.specialist.upsertManaged(specialistManifest(region)))
    .specialistId;
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
