/** @rstest-environment jsdom */

import React, { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import { EMAIL_SIGNATURE } from './email-signature';
import { MessageEditor } from './message-editor';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MessageEditor', () => {
  it('collapses the signature by default and lets it expand without changing the editable body', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    function Harness() {
      const ref = useRef<HTMLTextAreaElement>(null);
      const [value, setValue] = useState('My message');
      return <MessageEditor inputRef={ref} label="Message body" name="body" placeholder="Write your message…" value={value} onValueChange={setValue} variant="compose" />;
    }
    try {
      await act(async () => root.render(<Harness />));
      const body = container.querySelector('textarea')!;
      expect(container.querySelector('.message-signature-content p')).toBeNull();
      expect(body.value).toBe('My message');
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Show signature"]')!.click());
      expect(container.querySelector('.message-signature-content p')?.textContent).toBe(EMAIL_SIGNATURE);
      expect(body.value).toBe('My message');
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(body, 'Edited message');
        body.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hide signature"]')!.click());
      expect(container.querySelector('.message-signature-content p')).toBeNull();
      expect(body.value).toBe('Edited message');
      expect(body.value).not.toContain(EMAIL_SIGNATURE);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
