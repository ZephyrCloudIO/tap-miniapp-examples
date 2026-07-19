import { describe, expect, it } from '@rstest/core';
import {
  createAdministrationDraft,
  parseAdministrationDraftToolResult,
} from './administration-draft';
import { mcpServer } from './mcp/administration';

const validInput = {
  itemId: 'item-1',
  lotId: 'lot-1',
  plannedAt: '2026-07-18T08:00:00-04:00',
  actualAt: '2026-07-18T08:05:00-04:00',
  dose: 1,
  unit: 'capsule',
  route: 'oral',
  site: '',
  status: 'taken' as const,
  reason: '',
  reaction: '',
  instructionSource: 'label',
};

describe('administration draft MCP tool', () => {
  it('returns a structured draft without committing ledger data', () => {
    const result = createAdministrationDraft(validInput);
    expect(result.valid).toBe(true);
    expect(result.draft).toEqual(validInput);
    expect(parseAdministrationDraftToolResult(result)).toEqual(validInput);
  });

  it('rejects incomplete or unsafe draft values', () => {
    const result = createAdministrationDraft({
      ...validInput,
      dose: 0,
      actualAt: '',
    });
    expect(result.valid).toBe(false);
    expect(result.draft).toBeNull();
    expect(result.errors).toContain(
      'Dose must be a finite number greater than zero.',
    );
  });

  it('exports the descriptor-declared runtime tool name', () => {
    expect(Object.keys(mcpServer.tools)).toEqual(['draft_administration']);
    expect(
      mcpServer.tools.draft_administration?.execute(validInput),
    ).toMatchObject({ valid: true, kind: 'administration-draft' });
  });
});
