import { describe, expect, it } from '@rstest/core';
import { analysisPrompt, specialistManifest } from './specialist';
import {
  VANTA_API_FAMILIES,
  VANTA_AUDITOR_SDK_METHODS,
  VANTA_CAPABILITY_DOMAINS,
  VANTA_MCP_TOOLS,
} from './vanta-capabilities';

const sorted = (values: readonly string[]) => [...values].sort();

describe('Vanta capability inventory', () => {
  it('maps every published API family exactly once', () => {
    const mapped = VANTA_CAPABILITY_DOMAINS.flatMap(
      domain => domain.apiFamilies,
    );
    expect(VANTA_API_FAMILIES).toHaveLength(43);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect(sorted(mapped)).toEqual(sorted(VANTA_API_FAMILIES));
  });

  it('maps every verified MCP tool exactly once', () => {
    const mapped = VANTA_CAPABILITY_DOMAINS.flatMap(domain => domain.mcpTools);
    expect(VANTA_MCP_TOOLS).toHaveLength(45);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect(sorted(mapped)).toEqual(sorted(VANTA_MCP_TOOLS));
  });

  it('routes the consequential Auditor SDK surface through the host API', () => {
    const audit = VANTA_CAPABILITY_DOMAINS.find(
      domain => domain.id === 'audit-operations',
    );
    expect(VANTA_AUDITOR_SDK_METHODS).toHaveLength(52);
    expect(new Set(VANTA_AUDITOR_SDK_METHODS).size).toBe(
      VANTA_AUDITOR_SDK_METHODS.length,
    );
    expect(VANTA_AUDITOR_SDK_METHODS).toContain(
      'audits.listInformationRequests',
    );
    expect(VANTA_AUDITOR_SDK_METHODS).toContain('audits.updateEvidence');
    expect(audit).toMatchObject({
      support: 'host-api',
      analysisKind: null,
      mcpTools: [],
    });
  });

  it('installs an exact read-only Vanta MCP allowlist for every region', () => {
    for (const [region, url] of [
      ['us', 'https://mcp.vanta.com/mcp'],
      ['eu', 'https://mcp.eu.vanta.com/mcp'],
      ['aus', 'https://mcp.aus.vanta.com/mcp'],
    ] as const) {
      const manifest = specialistManifest(region);
      const tooling = manifest.tooling as Record<string, unknown>;
      const templates = tooling.mcpTemplates as Array<Record<string, unknown>>;
      const template = templates[0]!;
      const policy = template.toolPolicy as Record<string, unknown>;
      expect(template.tools).toEqual(VANTA_MCP_TOOLS);
      expect(policy.default).toBe('allowlistOnly');
      expect(policy.allowedTools).toEqual(VANTA_MCP_TOOLS);
      expect(policy.writeToolPatterns).toEqual([]);
      expect(template.transport).toEqual({ type: 'streamableHttp', url });
    }
  });

  it('routes API gaps without implying unavailable audit access', () => {
    const prompt = analysisPrompt(
      'auditor-response',
      'Request access review evidence for Q3.',
    );
    expect(prompt).toContain(
      'does not expose Auditor API information requests',
    );
    expect(prompt).toContain('Do not imply it does');
    expect(prompt).toContain('host API bridge');
    expect(prompt).toContain('Request access review evidence for Q3.');
  });
});
