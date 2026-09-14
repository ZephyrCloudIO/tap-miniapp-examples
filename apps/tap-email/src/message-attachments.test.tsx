/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, rstest as rs } from '@rstest/core';
import type { EmailAttachment } from './domain';
import { MessageAttachments } from './message-attachments';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const attachment: EmailAttachment = {
  resourceId: 'attachment_1',
  fileName: 'launch-brief.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 42_000,
  disposition: 'attachment',
  contentId: null,
};

async function mount(
  overrides: Partial<React.ComponentProps<typeof MessageAttachments>> = {},
): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MessageAttachments
      attachments={[attachment]}
      exportSupported
      onSaveAttachment={async () => 'saved'}
      {...overrides}
    />);
  });
  return { container, root };
}

async function unmount(root: Root, container: HTMLElement): Promise<void> {
  await act(async () => root.unmount());
  container.remove();
}

describe('message attachments', () => {
  it('renders compact metadata without loading attachment bytes', async () => {
    const onSaveAttachment = rs.fn(async () => 'saved' as const);
    const { container, root } = await mount({ onSaveAttachment });

    expect(container.textContent).toContain('launch-brief.pdf');
    expect(container.textContent).toContain('41 KB');
    expect(container.textContent).toContain('PDF');
    expect(onSaveAttachment).not.toHaveBeenCalled();
    expect(container.querySelector('button')?.type).toBe('button');

    await unmount(root, container);
  });

  it('identifies inline resources without changing the save interaction', async () => {
    const { container, root } = await mount({
      attachments: [{ ...attachment, disposition: 'inline' }],
    });
    expect(container.textContent).toContain('Inline');
    await unmount(root, container);
  });

  it('shows save progress and a completed state only after a user click', async () => {
    const phases: string[] = [];
    const onSaveAttachment = rs.fn(async (_attachment, onPhase) => {
      onPhase('loading');
      phases.push('loaded');
      onPhase('saving');
      return 'saved' as const;
    });
    const { container, root } = await mount({ onSaveAttachment });
    const button = container.querySelector<HTMLButtonElement>('button')!;

    await act(async () => button.click());

    expect(onSaveAttachment).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(['loaded']);
    expect(button.textContent).toContain('Saved');
    expect(button.getAttribute('aria-label')).toBe('Saved launch-brief.pdf');

    await unmount(root, container);
  });

  it('isolates save-key activation from reader-wide shortcuts', async () => {
    const onDocumentKeyDown = rs.fn();
    document.addEventListener('keydown', onDocumentKeyDown);
    const { container, root } = await mount();
    const button = container.querySelector<HTMLButtonElement>('button')!;

    await act(async () => {
      button.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(onDocumentKeyDown).not.toHaveBeenCalled();
    document.removeEventListener('keydown', onDocumentKeyDown);
    await unmount(root, container);
  });

  it('returns to the idle state without an error when the picker is cancelled', async () => {
    const { container, root } = await mount({
      onSaveAttachment: async () => 'cancelled',
    });
    const button = container.querySelector<HTMLButtonElement>('button')!;

    await act(async () => button.click());

    expect(button.textContent).toContain('Save');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await unmount(root, container);
  });

  it('clearly disables unsupported and oversized saves', async () => {
    const { container, root } = await mount({ exportSupported: false });
    expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
    expect(container.textContent).toContain('not supported by this host');
    await unmount(root, container);

    const oversized = await mount({
      attachments: [{ ...attachment, sizeBytes: 8 * 1_024 * 1_024 + 1 }],
    });
    expect(oversized.container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
    expect(oversized.container.textContent).toContain('Over the 8 MB download limit');
    await unmount(oversized.root, oversized.container);
  });
});
