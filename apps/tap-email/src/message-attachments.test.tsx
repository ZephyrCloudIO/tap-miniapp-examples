/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, rstest as rs } from '@rstest/core';
import type { EmailAttachment } from './domain';
import { MessageAttachments } from './message-attachments';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const tinyPngBytes = Uint8Array.from(
  atob(tinyPngBase64),
  character => character.charCodeAt(0),
);

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
      onLoadAttachment={null}
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
    expect(container.querySelector('[aria-label^="Preview"]')).toBeNull();

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

  it('shows a specific retry state when the host cannot confirm the save click', async () => {
    let attempt = 0;
    const onSaveAttachment = rs.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw Object.assign(new Error('A fresh gesture is required.'), {
          name: 'MiniAppHostActionError',
          code: 'user-gesture-required',
        });
      }
      return 'saved' as const;
    });
    const { container, root } = await mount({ onSaveAttachment });
    const button = container.querySelector<HTMLButtonElement>('.message-attachment-save')!;

    await act(async () => button.click());

    expect(button.textContent).toContain('Retry');
    expect(button.getAttribute('aria-label')).toBe('Retry launch-brief.pdf');
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe('Select Retry to open the Save dialog.');

    await act(async () => button.click());

    expect(button.textContent).toContain('Saved');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(onSaveAttachment).toHaveBeenCalledTimes(2);
    await unmount(root, container);
  });

  it('loads and previews a safe image only after the preview button is clicked', async () => {
    const imageAttachment: EmailAttachment = {
      ...attachment,
      resourceId: 'image_1',
      fileName: 'image.png',
      mimeType: 'image/png',
      sizeBytes: tinyPngBytes.byteLength,
      disposition: 'inline',
      contentId: 'image@example.com',
    };
    const onLoadAttachment = rs.fn(async () => tinyPngBytes);
    const { container, root } = await mount({
      attachments: [imageAttachment],
      exportSupported: false,
      onLoadAttachment,
    });
    const previewButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Preview image.png"]',
    )!;

    expect(previewButton.getAttribute('aria-haspopup')).toBe('dialog');
    expect(container.querySelector<HTMLButtonElement>('.message-attachment-save')?.disabled)
      .toBe(true);
    expect(onLoadAttachment).not.toHaveBeenCalled();

    await act(async () => previewButton.click());

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    const image = dialog.querySelector<HTMLImageElement>('img')!;
    expect(onLoadAttachment).toHaveBeenCalledWith(
      imageAttachment,
      { cacheMode: 'read-only' },
    );
    expect(dialog.textContent).toContain('image.png');
    expect(dialog.textContent).toContain(`${tinyPngBytes.byteLength} B · PNG`);
    expect(image.alt).toBe('Preview of image.png');
    expect(image.src).toBe(`data:image/png;base64,${tinyPngBase64}`);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close attachment preview');

    await act(async () => {
      dialog.querySelector<HTMLButtonElement>('[aria-label="Close attachment preview"]')?.click();
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(previewButton);
    await unmount(root, container);
  });

  it('shows a bounded preview error and retries only after an explicit click', async () => {
    const imageAttachment: EmailAttachment = {
      ...attachment,
      fileName: 'image.png',
      mimeType: 'image/png',
      sizeBytes: tinyPngBytes.byteLength,
    };
    let attempt = 0;
    const onLoadAttachment = rs.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('private provider detail');
      return tinyPngBytes;
    });
    const { container, root } = await mount({
      attachments: [imageAttachment],
      onLoadAttachment,
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Preview image.png"]')?.click();
    });

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelector('[role="alert"]')?.textContent)
      .toContain('Could not preview this attachment. Try again.');
    expect(onLoadAttachment).toHaveBeenCalledTimes(1);

    const retryButton = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === 'Try again')!;
    retryButton.focus();
    await act(async () => retryButton.click());

    expect(onLoadAttachment).toHaveBeenCalledTimes(2);
    expect(onLoadAttachment).toHaveBeenLastCalledWith(
      imageAttachment,
      { cacheMode: 'read-only' },
    );
    expect(document.body.querySelector('[role="dialog"] img')).not.toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close attachment preview');
    await unmount(root, container);
  });

  it('reports an image decode failure without automatically reloading it', async () => {
    const brokenPngBytes = tinyPngBytes.slice();
    brokenPngBytes.fill(0, 8);
    const imageAttachment: EmailAttachment = {
      ...attachment,
      fileName: 'broken.png',
      mimeType: 'image/png',
      sizeBytes: brokenPngBytes.byteLength,
    };
    const onLoadAttachment = rs.fn(async () => brokenPngBytes);
    const { container, root } = await mount({
      attachments: [imageAttachment],
      onLoadAttachment,
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Preview broken.png"]')?.click();
    });
    const image = document.body.querySelector<HTMLImageElement>('[role="dialog"] img')!;

    await act(async () => image.dispatchEvent(new Event('error')));

    expect(document.body.querySelector('[role="dialog"] [role="alert"]')?.textContent)
      .toContain('This image could not be displayed.');
    expect(onLoadAttachment).toHaveBeenCalledTimes(1);

    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
        .find(button => button.textContent === 'Try again')?.click();
    });
    expect(onLoadAttachment).toHaveBeenLastCalledWith(
      imageAttachment,
      { cacheMode: 'bypass' },
    );
    await unmount(root, container);
  });

  it('does not advertise a preview for empty or animated image formats', async () => {
    const { container, root } = await mount({
      attachments: [
        {
          ...attachment,
          resourceId: 'empty',
          fileName: 'empty.png',
          mimeType: 'image/png',
          sizeBytes: 0,
        },
        {
          ...attachment,
          resourceId: 'motion',
          fileName: 'motion.gif',
          mimeType: 'image/gif',
          sizeBytes: 42,
        },
      ],
      onLoadAttachment: async () => new Uint8Array(),
    });

    expect(container.querySelector('[aria-label="Preview empty.png"]')).toBeNull();
    expect(container.querySelector('[aria-label="Preview motion.gif"]')).toBeNull();
    expect(container.textContent).not.toContain(' · Preview');
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
