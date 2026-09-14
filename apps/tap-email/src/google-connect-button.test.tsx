/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import {
  GoogleConnectButton,
  type GoogleConnectButtonProps,
} from './google-connect-button';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  readonly button: HTMLButtonElement;
  readonly render: (props: GoogleConnectButtonProps) => Promise<void>;
  readonly unmount: () => Promise<void>;
}

async function renderButton(props: GoogleConnectButtonProps): Promise<Harness> {
  const container = document.createElement('div');
  document.body.append(container);
  const root: Root = createRoot(container);

  const render = async (nextProps: GoogleConnectButtonProps) => {
    await act(async () => {
      root.render(<GoogleConnectButton {...nextProps} />);
    });
  };
  await render(props);

  return {
    button: container.querySelector('button')!,
    render,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function pointerEvent(
  type: 'pointerdown' | 'pointerup' | 'pointerover',
  {
    pointerType,
    button = 0,
    isPrimary = true,
  }: {
    readonly pointerType: 'mouse' | 'pen' | 'touch';
    readonly button?: number;
    readonly isPrimary?: boolean;
  },
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    button,
    cancelable: true,
  });
  Object.defineProperties(event, {
    isPrimary: { value: isPrimary },
    pointerType: { value: pointerType },
  });
  return event;
}

function clickEvent(detail: number): MouseEvent {
  return new MouseEvent('click', {
    bubbles: true,
    button: 0,
    cancelable: true,
    detail,
  });
}

describe('GoogleConnectButton', () => {
  it('keeps its visible and accessible label stable while exposing busy state', async () => {
    const noOp = () => {};
    const harness = await renderButton({
      busy: false,
      prepared: false,
      onLaunch: noOp,
      onPrepare: noOp,
    });

    try {
      expect(harness.button.textContent).toBe('Add account');
      expect(harness.button.getAttribute('aria-label')).toBe('Add account');
      expect(harness.button.getAttribute('aria-busy')).toBe('false');
      expect(harness.button.disabled).toBe(false);

      await harness.render({
        busy: true,
        prepared: true,
        onLaunch: noOp,
        onPrepare: noOp,
      });

      expect(harness.button.textContent).toBe('Add account');
      expect(harness.button.getAttribute('aria-label')).toBe('Add account');
      expect(harness.button.getAttribute('aria-busy')).toBe('true');
      expect(harness.button.disabled).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

  it('launches a prepared flow on primary mouse pointerdown without duplicating on click', async () => {
    let launches = 0;
    const harness = await renderButton({
      busy: false,
      prepared: true,
      onLaunch: () => { launches += 1; },
      onPrepare: () => {},
    });

    try {
      await act(async () => {
        harness.button.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' }));
        harness.button.dispatchEvent(pointerEvent('pointerup', { pointerType: 'mouse' }));
        harness.button.dispatchEvent(clickEvent(1));
      });
      expect(launches).toBe(1);
    } finally {
      await harness.unmount();
    }
  });

  it('ignores right-click and non-primary pointer activation', async () => {
    let launches = 0;
    const harness = await renderButton({
      busy: false,
      prepared: true,
      onLaunch: () => { launches += 1; },
      onPrepare: () => {},
    });

    try {
      await act(async () => {
        harness.button.dispatchEvent(pointerEvent('pointerdown', {
          button: 2,
          pointerType: 'mouse',
        }));
        harness.button.dispatchEvent(pointerEvent('pointerdown', {
          isPrimary: false,
          pointerType: 'mouse',
        }));
        harness.button.dispatchEvent(pointerEvent('pointerup', {
          isPrimary: false,
          pointerType: 'touch',
        }));
        harness.button.dispatchEvent(clickEvent(1));
      });
      expect(launches).toBe(0);
    } finally {
      await harness.unmount();
    }
  });

  it('launches touch and pen activation on primary pointerup', async () => {
    let launches = 0;
    const harness = await renderButton({
      busy: false,
      prepared: true,
      onLaunch: () => { launches += 1; },
      onPrepare: () => {},
    });

    try {
      await act(async () => {
        harness.button.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch' }));
      });
      expect(launches).toBe(0);

      await act(async () => {
        harness.button.dispatchEvent(pointerEvent('pointerup', { pointerType: 'touch' }));
        harness.button.dispatchEvent(clickEvent(1));
      });
      expect(launches).toBe(1);

      await act(async () => {
        harness.button.dispatchEvent(pointerEvent('pointerup', { pointerType: 'pen' }));
        harness.button.dispatchEvent(clickEvent(1));
      });
      expect(launches).toBe(2);
    } finally {
      await harness.unmount();
    }
  });

  it('launches on Enter and Space, prevents default, and ignores key repeat', async () => {
    let launches = 0;
    const harness = await renderButton({
      busy: false,
      prepared: true,
      onLaunch: () => { launches += 1; },
      onPrepare: () => {},
    });

    try {
      const enter = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
      });
      const repeatedEnter = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        repeat: true,
      });
      await act(async () => {
        harness.button.dispatchEvent(enter);
        harness.button.dispatchEvent(repeatedEnter);
      });
      expect(enter.defaultPrevented).toBe(true);
      expect(repeatedEnter.defaultPrevented).toBe(true);
      expect(launches).toBe(1);

      const space = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: ' ',
      });
      await act(async () => {
        harness.button.dispatchEvent(space);
      });
      expect(space.defaultPrevented).toBe(true);
      expect(launches).toBe(2);
    } finally {
      await harness.unmount();
    }
  });

  it('prefetches on pointer enter or focus and deduplicates until async preparation settles', async () => {
    let preparations = 0;
    const props: GoogleConnectButtonProps = {
      busy: false,
      prepared: false,
      onLaunch: () => {},
      onPrepare: () => { preparations += 1; },
    };
    const harness = await renderButton(props);

    try {
      await act(async () => {
        harness.button.dispatchEvent(pointerEvent('pointerover', { pointerType: 'mouse' }));
        harness.button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        harness.button.dispatchEvent(clickEvent(1));
      });
      expect(preparations).toBe(1);

      await harness.render({ ...props, busy: true });
      await harness.render(props);
      await act(async () => {
        harness.button.dispatchEvent(pointerEvent('pointerover', { pointerType: 'mouse' }));
      });
      expect(preparations).toBe(2);

      await harness.render({ ...props, prepared: true });
      await act(async () => {
        harness.button.dispatchEvent(pointerEvent('pointerover', { pointerType: 'mouse' }));
      });
      expect(preparations).toBe(2);
    } finally {
      await harness.unmount();
    }
  });

  it('uses click as an unprepared and assistive-technology fallback', async () => {
    let launches = 0;
    let preparations = 0;
    const onLaunch = () => { launches += 1; };
    const onPrepare = () => { preparations += 1; };
    const harness = await renderButton({
      busy: false,
      prepared: false,
      onLaunch,
      onPrepare,
    });

    try {
      await act(async () => {
        harness.button.dispatchEvent(clickEvent(0));
      });
      expect(preparations).toBe(1);
      expect(launches).toBe(0);

      await harness.render({
        busy: false,
        prepared: true,
        onLaunch,
        onPrepare,
      });
      await act(async () => {
        harness.button.dispatchEvent(clickEvent(1));
        harness.button.dispatchEvent(clickEvent(0));
      });
      expect(launches).toBe(1);
    } finally {
      await harness.unmount();
    }
  });

  it('blocks work while busy and releases a stranded launch latch when busy settles', async () => {
    let launches = 0;
    let preparations = 0;
    const onLaunch = () => { launches += 1; };
    const onPrepare = () => { preparations += 1; };
    const harness = await renderButton({
      busy: false,
      prepared: true,
      onLaunch,
      onPrepare,
    });

    try {
      await act(async () => {
        harness.button.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' }));
        harness.button.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' }));
      });
      expect(launches).toBe(1);

      await harness.render({
        busy: true,
        prepared: true,
        onLaunch,
        onPrepare,
      });
      await act(async () => {
        harness.button.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' }));
        harness.button.dispatchEvent(clickEvent(0));
        harness.button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      });
      expect(launches).toBe(1);
      expect(preparations).toBe(0);

      await harness.render({
        busy: false,
        prepared: true,
        onLaunch,
        onPrepare,
      });
      await act(async () => {
        harness.button.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' }));
      });
      expect(launches).toBe(2);
    } finally {
      await harness.unmount();
    }
  });
});
