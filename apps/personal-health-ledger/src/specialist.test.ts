import { describe, expect, it } from '@rstest/core';
import { addItem, addSavedView, createLedger } from './domain';
import {
  buildSpecialistPrompt,
  extractHealthSpecialistResult,
  GROK_MODEL_PREFERENCE,
  HEALTH_SPECIALIST_TOOLS,
  managedSpecialistManifest,
  specialistDefinition,
} from './specialist';

const runtimeState = () =>
  addSavedView(
    addItem(createLedger('Private runtime ledger', 'US'), {
      name: 'Runtime selected item',
      canonicalName: 'Runtime canonical term',
      category: 'supplement',
      status: 'active',
      jurisdiction: 'US',
      regulatoryStatus: 'Runtime user entry',
      form: 'capsule',
      route: 'oral',
      concentration: '',
      purpose: 'Private purpose that must not enter research prompts',
      clinician: 'Private clinician that must not enter research prompts',
      sourceRecord: 'Runtime label',
      startedOn: '2026-01-01',
      notes: 'Private notes that must not enter research prompts',
      clinicianQuestions: '',
      cadence: 'Runtime cadence',
      dose: 1,
      unit: 'capsule',
      instructionSource: 'Runtime label',
    }),
    {
      name: 'Runtime evidence scope',
      scope: 'approved-only',
      evidenceTypes: ['human-clinical'],
    },
  );

describe('health specialist contract', () => {
  it('prefers Grok while allowlisting only host-supported research tools', () => {
    const managed = managedSpecialistManifest();
    expect(managed.preferredModel).toBe(GROK_MODEL_PREFERENCE);
    expect(managed.tooling).toEqual({ tools: [...HEALTH_SPECIALIST_TOOLS] });
    expect(HEALTH_SPECIALIST_TOOLS).not.toContain('x_search');
    expect(specialistDefinition.preferredModels).toEqual([
      { model: GROK_MODEL_PREFERENCE },
    ]);
  });

  it('requires explicit approval before including private ledger context', () => {
    const state = runtimeState();
    expect(() =>
      buildSpecialistPrompt({
        task: 'research-update',
        state,
        itemId: state.items[0]!.id,
        viewId: state.savedViews[0]!.id,
        question: '',
        privateContextApproved: false,
      }),
    ).toThrow('Approve the minimum-necessary private context');
  });

  it('minimizes item research prompts and excludes identity and unrelated fields', () => {
    const state = runtimeState();
    const prompt = buildSpecialistPrompt({
      task: 'research-update',
      state,
      itemId: state.items[0]!.id,
      viewId: state.savedViews[0]!.id,
      question: 'Runtime research question',
      privateContextApproved: true,
    });
    expect(prompt).toContain('Runtime canonical term');
    expect(prompt).toContain('approved-only');
    expect(prompt).toContain('human-clinical');
    expect(prompt).toContain('Runtime research question');
    expect(prompt).not.toContain('Private runtime ledger');
    expect(prompt).not.toContain('Private clinician');
    expect(prompt).not.toContain('Private notes');
    expect(prompt).not.toContain('Private purpose');
  });

  it('rejects research output without a successful host web-search receipt', () => {
    const result = {
      completionEvent: {
        modelUsed: 'runtime-model',
        parts: [{ type: 'text' as const, content: 'Runtime response' }],
      },
    };
    expect(() =>
      extractHealthSpecialistResult('research-update', result),
    ).toThrow('did not return a successful web_search receipt');
    expect(extractHealthSpecialistResult('record-audit', result).content).toBe(
      'Runtime response',
    );
  });

  it('persists only allowlisted host tool receipts', () => {
    const result = {
      completionEvent: {
        modelUsed: 'runtime-model',
        parts: [
          {
            type: 'tool' as const,
            toolCallId: crypto.randomUUID(),
            toolName: 'web_search',
            arguments: {},
            toolIntent: 'Runtime search',
            success: true,
            content: {},
            executionTimeMs: 1,
          },
          { type: 'text' as const, content: 'Runtime response' },
        ],
      },
    };
    expect(
      extractHealthSpecialistResult('research-update', result).toolReceipts,
    ).toEqual([{ toolName: 'web_search', success: true }]);
  });
});
