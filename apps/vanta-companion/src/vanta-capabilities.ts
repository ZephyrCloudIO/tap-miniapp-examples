import type { AnalysisKind } from './domain';

export const VANTA_AUDITOR_SDK_VERSION = '0.9.10';
export const VANTA_MCP_PACKAGE_VERSION = '1.2.0';

/**
 * Tool names published by @vantasdk/vanta-mcp-server 1.2.0. Keeping this
 * explicit makes the installed specialist an allowlist rather than an open
 * pass-through to tools Vanta may add later.
 */
export const VANTA_MCP_TOOLS = [
  'controls',
  'document_resources',
  'documents',
  'download_document_file',
  'frameworks',
  'get_trust_center',
  'get_trust_center_document',
  'get_trust_center_resource_media',
  'get_trust_center_subscriber',
  'get_vendor_security_review',
  'groups',
  'integration_resources',
  'integrations',
  'list_control_documents',
  'list_control_tests',
  'list_discovered_vendor_accounts',
  'list_discovered_vendors',
  'list_framework_controls',
  'list_group_people',
  'list_library_controls',
  'list_test_entities',
  'list_trust_center_historical_access_requests',
  'list_trust_center_resources',
  'list_trust_center_subscribers',
  'list_trust_center_viewer_activity_events',
  'list_vendor_risk_attributes',
  'list_vendor_security_review_documents',
  'list_vulnerability_remediations',
  'monitored_computers',
  'people',
  'policies',
  'risks',
  'tests',
  'trust_center_access_requests',
  'trust_center_control_categories',
  'trust_center_controls',
  'trust_center_faqs',
  'trust_center_subprocessors',
  'trust_center_subscriber_groups',
  'trust_center_updates',
  'trust_center_viewers',
  'vendor_compliance',
  'vendors',
  'vulnerabilities',
  'vulnerable_assets',
] as const;

/** Current top-level API reference families from Vanta's published llms.txt. */
export const VANTA_API_FAMILIES = [
  'api-endpoint-vulnerabilities',
  'auditors',
  'audits',
  'background-checks',
  'contracts',
  'control',
  'controls',
  'custom-resources',
  'customer-trust',
  'discovered-vendors',
  'documents',
  'event-logs',
  'evidence',
  'frameworks',
  'groups',
  'information-request',
  'integrations',
  'issues',
  'knowledge-base',
  'macos-user-computers',
  'monitored-computers',
  'package-vulnerabilities',
  'people',
  'policies',
  'questionnaire',
  'risk-scenarios',
  'secrets',
  'security-tasks',
  'static-code-analysis-vulnerabilities',
  'tests',
  'trust-center',
  'trust-centers',
  'user-accounts',
  'user-security-training-statuses',
  'users',
  'vendor',
  'vendor-risk-attributes',
  'vendors',
  'vulnerabilities',
  'vulnerability-remediations',
  'vulnerable-assets',
  'vulnerable-components',
  'windows-user-computers',
] as const;

/** Public methods verified from vanta-auditor-api-sdk 0.9.10 declarations. */
export const VANTA_AUDITOR_SDK_METHODS = [
  'auditors.create',
  'audits.acceptInformationRequestEvidence',
  'audits.createCommentForControl',
  'audits.createCommentForEvidence',
  'audits.createCommentForInformationRequest',
  'audits.createCustomControl',
  'audits.createCustomEvidenceRequest',
  'audits.createInformationRequest',
  'audits.deleteCommentForControl',
  'audits.deleteCommentForInformationRequest',
  'audits.deleteInformationRequest',
  'audits.duplicate',
  'audits.flagInformationRequestEvidence',
  'audits.getAudit',
  'audits.getEvidenceUrls',
  'audits.getFrameworkCodes',
  'audits.getInformationRequest',
  'audits.getInformationRequestTestSnapshotEvidenceDetail',
  'audits.getOrganizationInformation',
  'audits.getOrganizationNotifications',
  'audits.getVulnerableAssets',
  'audits.list',
  'audits.listAccountAccessServices',
  'audits.listAuditIssues',
  'audits.listAuditRisks',
  'audits.listAuditSnapshots',
  'audits.listCodeChanges',
  'audits.listComments',
  'audits.listCommentsForControl',
  'audits.listCommentsForInformationRequest',
  'audits.listControls',
  'audits.listEvidence',
  'audits.listInformationRequestActivity',
  'audits.listInformationRequestEvidence',
  'audits.listInformationRequests',
  'audits.listInformationRequestsForControl',
  'audits.listIntegrations',
  'audits.listMonitoredComputersInAuditScope',
  'audits.listPeopleInAuditScope',
  'audits.listPersonnelAccountAccess',
  'audits.listPersonnelGroups',
  'audits.listPersonnelPeople',
  'audits.listRiskSnapshots',
  'audits.listVendors',
  'audits.listVendorsInAuditScope',
  'audits.listVulnerabilities',
  'audits.listVulnerabilityRemediationsInAuditScope',
  'audits.shareInformationRequestList',
  'audits.updateCommentForControl',
  'audits.updateCommentForInformationRequest',
  'audits.updateEvidence',
  'audits.updateInformationRequest',
] as const;

export type CapabilitySupport = 'mcp-read' | 'mcp-partial' | 'api-only';

export interface VantaCapabilityDomain {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly support: CapabilitySupport;
  readonly analysisKind: AnalysisKind | null;
  readonly apiFamilies: readonly (typeof VANTA_API_FAMILIES)[number][];
  readonly mcpTools: readonly (typeof VANTA_MCP_TOOLS)[number][];
  readonly boundary: string;
}

export const VANTA_CAPABILITY_DOMAINS: readonly VantaCapabilityDomain[] = [
  {
    id: 'controls-monitoring',
    title: 'Controls & continuous monitoring',
    description:
      'Framework adoption, control mappings, automated tests, tested entities, issues, policies, and security tasks.',
    support: 'mcp-partial',
    analysisKind: 'controls-monitoring',
    apiFamilies: [
      'control',
      'controls',
      'frameworks',
      'issues',
      'policies',
      'security-tasks',
      'tests',
    ],
    mcpTools: [
      'controls',
      'list_control_tests',
      'list_library_controls',
      'frameworks',
      'list_framework_controls',
      'policies',
      'tests',
      'list_test_entities',
    ],
    boundary:
      'MCP reads controls, frameworks, policies, tests, and entities. Issues and security tasks need a separately authenticated Manage or Build Integrations API transport.',
  },
  {
    id: 'documents-evidence',
    title: 'Documents & evidence',
    description:
      'Control evidence, document links and uploads, evidence freshness, event history, and custom resources.',
    support: 'mcp-partial',
    analysisKind: 'documents-evidence',
    apiFamilies: ['custom-resources', 'documents', 'event-logs', 'evidence'],
    mcpTools: [
      'documents',
      'document_resources',
      'download_document_file',
      'list_control_documents',
    ],
    boundary:
      'MCP can inspect and download authorized documents. Upload, submit, link, and evidence mutation endpoints are intentionally not exposed by this specialist.',
  },
  {
    id: 'audit-operations',
    title: 'Audits & information requests',
    description:
      'Audits, controls, evidence, comments, activity, people, vendors, risks, vulnerabilities, and information-request workflows.',
    support: 'api-only',
    analysisKind: null,
    apiFamilies: ['auditors', 'audits', 'information-request'],
    mcpTools: [],
    boundary: `Covered by the official Auditor SDK ${VANTA_AUDITOR_SDK_VERSION}; unavailable here until a host-managed Vanta bearer credential and per-method execution adapter are configured. No audit result is simulated.`,
  },
  {
    id: 'people-devices',
    title: 'People, identity & devices',
    description:
      'Personnel, groups, background checks, security training, account access, and managed macOS and Windows computers.',
    support: 'mcp-partial',
    analysisKind: 'people-devices',
    apiFamilies: [
      'background-checks',
      'groups',
      'macos-user-computers',
      'monitored-computers',
      'people',
      'user-accounts',
      'user-security-training-statuses',
      'users',
      'windows-user-computers',
    ],
    mcpTools: ['groups', 'list_group_people', 'monitored_computers', 'people'],
    boundary:
      'MCP reads people, group membership, and monitored computers. Background checks, training, and account-specific endpoints require direct API scopes.',
  },
  {
    id: 'vendor-risk',
    title: 'Risk & third-party assurance',
    description:
      'Risk scenarios, contracts, discovered vendors, managed vendors, findings, assessments, security reviews, and risk attributes.',
    support: 'mcp-read',
    analysisKind: 'vendor-risk',
    apiFamilies: [
      'contracts',
      'discovered-vendors',
      'risk-scenarios',
      'vendor',
      'vendor-risk-attributes',
      'vendors',
    ],
    mcpTools: [
      'list_discovered_vendor_accounts',
      'list_discovered_vendors',
      'list_vendor_risk_attributes',
      'risks',
      'vendors',
      'vendor_compliance',
      'get_vendor_security_review',
      'list_vendor_security_review_documents',
    ],
    boundary:
      'The allowlist is read-only. Vendor decisions, assignments, status changes, and risk acceptance remain unavailable consequential writes.',
  },
  {
    id: 'vulnerability-management',
    title: 'Vulnerability management',
    description:
      'API, package, SCA, secret, asset, and component findings with remediation status and deadlines.',
    support: 'mcp-partial',
    analysisKind: 'vulnerability-management',
    apiFamilies: [
      'api-endpoint-vulnerabilities',
      'package-vulnerabilities',
      'secrets',
      'static-code-analysis-vulnerabilities',
      'vulnerabilities',
      'vulnerability-remediations',
      'vulnerable-assets',
      'vulnerable-components',
    ],
    mcpTools: [
      'vulnerabilities',
      'list_vulnerability_remediations',
      'vulnerable_assets',
    ],
    boundary:
      'MCP reads normalized vulnerabilities, remediations, and vulnerable assets. Scanner-specific API families may require direct endpoint access.',
  },
  {
    id: 'trust-customer',
    title: 'Trust Center & customer assurance',
    description:
      'Public controls, resources, access requests, viewer activity, subscribers, subprocessors, updates, questionnaires, and approved answers.',
    support: 'mcp-partial',
    analysisKind: 'trust-customer',
    apiFamilies: [
      'customer-trust',
      'knowledge-base',
      'questionnaire',
      'trust-center',
      'trust-centers',
    ],
    mcpTools: [
      'get_trust_center',
      'trust_center_access_requests',
      'list_trust_center_viewer_activity_events',
      'trust_center_control_categories',
      'trust_center_controls',
      'trust_center_faqs',
      'list_trust_center_resources',
      'get_trust_center_document',
      'get_trust_center_resource_media',
      'trust_center_subprocessors',
      'trust_center_updates',
      'trust_center_viewers',
      'get_trust_center_subscriber',
      'trust_center_subscriber_groups',
      'list_trust_center_historical_access_requests',
      'list_trust_center_subscribers',
    ],
    boundary:
      'MCP reads Trust Center state. Questionnaire completion, answer-library verification, access approval, and publication are not in the allowlist.',
  },
  {
    id: 'integrations-resources',
    title: 'Integrations & monitored resources',
    description:
      'Connected integration health, resource kinds, schemas, monitored resources, and the Build Integrations resource surface.',
    support: 'mcp-read',
    analysisKind: 'integrations-resources',
    apiFamilies: ['integrations'],
    mcpTools: ['integrations', 'integration_resources'],
    boundary:
      'MCP reads connected integrations and their resources. Pushing custom resources or test outcomes requires a host-managed Build Integrations API credential and an execution adapter that this companion does not configure.',
  },
] as const;

export const VANTA_WEBHOOK_BOUNDARY =
  'The companion Worker receives Vanta webhooks, verifies the raw Svix-signed body within a five-minute window, and stores each svix-id once in D1. This miniapp reads only event metadata through a Cloudflare Access-protected workspace feed; raw payloads stay server-side.';
