/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import { RichMessageBody } from './rich-message';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('rich-message late layout measurement', () => {
  it('resizes the frame after a late image load changes document height', async () => {
    const container = document.createElement('div');
    container.className = 'message-body';
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(<RichMessageBody html="<p>Late image</p>" title="Rich email" />);
      });
      const frame = container.querySelector<HTMLIFrameElement>('iframe')!;
      const frameDocument = frame.contentDocument!;
      const lateImage = frameDocument.createElement('img');
      frameDocument.body.append(lateImage);
      let contentHeight = 220;
      Object.defineProperty(frameDocument.body, 'scrollHeight', {
        configurable: true,
        get: () => contentHeight,
      });
      Object.defineProperty(frameDocument.documentElement, 'scrollHeight', {
        configurable: true,
        get: () => contentHeight,
      });

      await act(async () => {
        frame.dispatchEvent(new Event('load'));
      });
      expect(frame.style.height).toBe('220px');

      contentHeight = 860;
      await act(async () => {
        lateImage.dispatchEvent(new Event('load'));
        await new Promise(resolve => window.setTimeout(resolve, 1));
      });
      expect(frame.style.height).toBe('860px');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('announces a partial image result instead of hiding failed batches', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const firstUrl = 'https://cdn.example.com/first.png';
    const secondUrl = 'https://cdn.example.com/second.png';

    try {
      await act(async () => {
        root.render(
          <RichMessageBody
            html={`
              <img src="${firstUrl}" width="640" height="320">
              <img src="${secondUrl}" width="640" height="320">
            `}
            imagesEnabled
            loadRemoteImages={async () => ({
              [firstUrl]: 'data:image/png;base64,iVBORw0KGgo=',
            })}
            title="Rich email"
          />,
        );
        await Promise.resolve();
      });

      expect(container.querySelector('.remote-image-status')?.textContent)
        .toBe('Some message images were blocked.');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
