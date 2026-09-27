/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rs } from '@rstest/core';
import { AiWriter } from './ai-writer';
import type { ComposerServices } from './composer-services';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AI draft review', () => {
  it('does not apply a proposal over edits made during generation, and never auto-applies', async () => {
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    let resolve!: (value: unknown) => void;
    const send = rs.fn(() => new Promise(done => { resolve = done; }));
    const onApply = rs.fn();
    const services = { conversationId: 'conversation_1', workspaceId: 'workspace_1', platform: {
      authorization: { check: async () => ({ allowed: true }) },
      inference: { listModels: async () => [{ canonicalName: 'test-model', displayName: 'Test model' }], send },
    } } as unknown as ComposerServices;
    const render = (body: string) => <AiWriter services={services} subject="Subject" bodyText={body} onApply={onApply} onClose={() => {}} />;
    try {
      await act(async () => root.render(render('Original')));
      const prompt = container.querySelector<HTMLTextAreaElement>('[aria-label="AI writing instructions"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt, 'Make it shorter');
        prompt.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Generate draft"]')!.click());
      await act(async () => root.render(render('Edited while generating')));
      await act(async () => resolve({ text: 'Proposal', finishReason: 'stop' }));
      expect(container.textContent).toContain('Your draft changed');
      const apply = [...container.querySelectorAll('button')].find(button => button.textContent === 'Use draft')!;
      expect(apply.disabled).toBe(true); expect(onApply).not.toHaveBeenCalled();
      await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Try again')!.click());
      await act(async () => resolve({ text: 'Updated proposal', finishReason: 'stop' }));
      await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Use draft')!.click());
      expect(onApply).toHaveBeenCalledWith('Updated proposal');
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
