/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import { PullToSync } from './pull-to-sync';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(run: (ui: {
  container: HTMLDivElement;
  list: HTMLDivElement;
  touch(type: string, x: number, y: number, fingers?: number): Promise<TouchEvent>;
  calls(): number;
  clicks(): number;
  finish(fail?: boolean): Promise<void>;
  render(enabled: boolean, syncing: boolean): Promise<void>;
}) => Promise<void>) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let calls = 0; let clicks = 0;
  let resolve = () => {}; let reject = (_error: Error) => {};
  const onSync = () => { calls++; return new Promise<void>((yes, no) => { resolve = yes; reject = no; }); };
  const render = async (enabled = true, syncing = false) => {
    await act(async () => root.render(<PullToSync enabled={enabled} syncing={syncing} onSync={onSync} role="listbox" label="Email threads"><button onClick={() => clicks++}>Read message</button></PullToSync>));
  };
  try {
    await render();
    const list = container.querySelector<HTMLDivElement>('.thread-list')!;
    await run({ container, list, render, calls: () => calls, clicks: () => clicks,
      async touch(type, x, y, fingers = 1) {
        const touches = Array.from({ length: fingers }, (_, identifier) => ({ identifier, clientX: x, clientY: y } as Touch));
        const event = new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : touches });
        await act(async () => { list.dispatchEvent(event); });
        return event;
      },
      async finish(fail = false) { await act(async () => { if (fail) reject(new Error('Offline')); else resolve(); }); },
    });
  } finally { await act(async () => root.unmount()); container.remove(); }
}

async function pull(ui: Parameters<Parameters<typeof fixture>[0]>[0], end = 'touchend', x = 100, y = 250) {
  await ui.touch('touchstart', 100, 100);
  await ui.touch('touchmove', x, y);
  await ui.touch(end, x, y);
}

describe('mobile pull to sync', () => {
  it('syncs once on release, suppresses the row click, and keeps the list mounted while pending', async () => fixture(async ui => {
    await ui.touch('touchstart', 100, 100);
    const move = await ui.touch('touchmove', 102, 250);
    expect(move.defaultPrevented).toBe(true);
    expect(ui.calls()).toBe(0);
    expect(ui.container.textContent).toContain('Release to sync');
    await ui.touch('touchend', 102, 250);
    expect(ui.calls()).toBe(1);
    expect(ui.container.textContent).toContain('Syncing email');
    await act(async () => ui.list.querySelector('button')!.click());
    expect(ui.clicks()).toBe(0);
    await pull(ui);
    expect(ui.calls()).toBe(1);
    await ui.finish();
    expect(ui.container.querySelector('[role="status"]')?.textContent).toBe('Email synced');
    expect(ui.list.style.transform).toBe('translateY(0px)');
    expect(ui.container.querySelector('.thread-list')).toBe(ui.list);
  }));

  it('leaves scrolling, horizontal gestures, short pulls, cancellation and multiple touches alone', async () => fixture(async ui => {
    ui.list.scrollTop = 80;
    await pull(ui);
    ui.list.scrollTop = 0;
    await pull(ui, 'touchend', 260, 120);
    await pull(ui, 'touchend', 100, 30);
    await pull(ui, 'touchend', 100, 140);
    await pull(ui, 'touchcancel');
    await ui.touch('touchstart', 100, 100);
    await ui.touch('touchmove', 100, 280, 2);
    await ui.touch('touchend', 100, 280);
    expect(ui.calls()).toBe(0);
    expect(ui.list.style.transform).toBe('translateY(0px)');
  }));

  it('allows retry after a failed sync and ignores gestures when disabled or already syncing', async () => fixture(async ui => {
    await ui.render(false, false); await pull(ui);
    await ui.render(true, true); await pull(ui);
    expect(ui.calls()).toBe(0);
    await ui.render(true, false); await pull(ui);
    await ui.finish(true);
    expect(ui.container.querySelector('[role="status"]')?.textContent).toContain('Could not sync');
    expect(ui.list.style.transform).toBe('translateY(0px)');
    await pull(ui);
    expect(ui.calls()).toBe(2);
    await ui.finish();
  }));

  it('preserves a normal row tap', async () => fixture(async ui => {
    await ui.touch('touchstart', 100, 100);
    await ui.touch('touchend', 100, 100);
    await act(async () => ui.list.querySelector('button')!.click());
    expect(ui.clicks()).toBe(1);
    expect(ui.calls()).toBe(0);
  }));
});
