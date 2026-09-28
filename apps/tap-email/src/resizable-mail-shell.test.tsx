/** @rstest-environment jsdom */
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, rs } from '@rstest/core';
import { ResizableMailShell } from './resizable-mail-shell';
import type { MailColumnWidths } from './domain';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const viewport = window.innerWidth;
const rectangle = HTMLElement.prototype.getBoundingClientRect;
let width = 1400;
afterEach(() => { rs.restoreAllMocks(); window.innerWidth = viewport; });

async function pointer(target: HTMLElement, type: string, x: number) {
  await act(async () => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
  });
}
async function key(target: HTMLElement, key: string, type = 'keydown') {
  await act(async () => target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true })));
}
async function mount(initial?: MailColumnWidths, collapsed = false, mobile = false, sidebarCollapsed = false) {
  window.innerWidth = width = 1400;
  rs.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('mail-shell') ? { ...rectangle.call(this), width } as DOMRect : rectangle.call(this);
  });
  const changed = rs.fn();
  const sidebarChanged = rs.fn();
  const rendered = rs.fn();
  function MailContent() { rendered(); return <article>Reader</article>; }
  function Shell() {
    const [widths, setWidths] = useState(initial);
    const [sidebarHidden, setSidebarHidden] = useState(sidebarCollapsed);
    return <ResizableMailShell className="mail-shell" widths={widths} collapsed={collapsed} mobile={mobile}
      sidebarCollapsed={sidebarHidden}
      onLayoutChange={(next, hidden) => { changed(next); setWidths(next); sidebarChanged(hidden); setSidebarHidden(hidden); }}>
      <aside>Views</aside><section hidden={collapsed}>Threads</section><MailContent />
    </ResizableMailShell>;
  }
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Shell />));
  const divider = (name: string) => container.querySelector<HTMLElement>(`[aria-label="${name}"]`)!;
  const sidebar = divider('Resize mailbox sidebar');
  const threads = divider('Resize message list');
  for (const handle of [sidebar, threads].filter(Boolean)) {
    handle.setPointerCapture = rs.fn(); handle.releasePointerCapture = rs.fn(); handle.hasPointerCapture = () => true;
  }
  return { container, changed, sidebarChanged, rendered, sidebar, threads,
    async resize(next: number) { await act(async () => { width = window.innerWidth = next; window.dispatchEvent(new Event('resize')); }); },
    async dispose() { await act(async () => root.unmount()); container.remove(); } };
}

describe('resizable mailbox columns', () => {
  it('snaps the sidebar closed when dragged left and restores its previous width with the edge button', async () => {
    const view = await mount({ sidebar: 240, threads: 450 });
    try {
      await pointer(view.sidebar, 'pointerdown', 240);
      await pointer(view.sidebar, 'pointermove', 50);
      expect(view.sidebar.getAttribute('aria-valuenow')).toBe('0');
      expect(view.container.querySelector('main')?.classList.contains('is-sidebar-collapsed')).toBe(true);
      expect(view.changed).not.toHaveBeenCalled();
      await pointer(view.sidebar, 'pointerup', 50);
      expect(view.changed).toHaveBeenLastCalledWith({ sidebar: 240, threads: 450 });
      expect(view.sidebarChanged).toHaveBeenLastCalledWith(true);
      const reopen = view.container.querySelector<HTMLButtonElement>('[aria-label="Show mailbox sidebar"]')!;
      expect(reopen.getAttribute('aria-expanded')).toBe('false');
      await act(async () => reopen.click());
      expect(view.sidebar.getAttribute('aria-valuenow')).toBe('240');
      expect(view.sidebarChanged).toHaveBeenLastCalledWith(false);
      expect(view.container.querySelector('main')?.style.gridTemplateColumns).toBe('240px 450px minmax(0, 1fr)');
    } finally { await view.dispose(); }
  });

  it('can drag open a saved collapsed sidebar and cancel a collapse without losing its width', async () => {
    const view = await mount({ sidebar: 260, threads: 450 }, false, false, true);
    try {
      expect(view.sidebar.getAttribute('aria-valuetext')).toBe('Collapsed');
      await pointer(view.sidebar, 'pointerdown', 20);
      await pointer(view.sidebar, 'pointermove', 102);
      expect(view.sidebar.getAttribute('aria-valuenow')).toBe('160');
      await pointer(view.sidebar, 'pointerup', 220);
      expect(view.changed).toHaveBeenLastCalledWith({ sidebar: 220, threads: 450 });
      expect(view.sidebarChanged).toHaveBeenLastCalledWith(false);
      await pointer(view.sidebar, 'pointerdown', 220); await pointer(view.sidebar, 'pointermove', 30);
      await key(view.sidebar, 'Escape');
      expect(view.sidebar.getAttribute('aria-valuenow')).toBe('220');
      expect(view.sidebarChanged).toHaveBeenCalledTimes(1);
    } finally { await view.dispose(); }
  });

  it('toggles with Enter, restores with Right, and keeps the collapsed preference across narrow layouts', async () => {
    const view = await mount({ sidebar: 260, threads: 450 });
    try {
      await key(view.sidebar, 'Enter');
      expect(view.sidebar.getAttribute('aria-valuenow')).toBe('0');
      await key(view.sidebar, 'Enter');
      expect(view.sidebar.getAttribute('aria-valuenow')).toBe('260');
      await key(view.sidebar, 'Home'); await key(view.sidebar, 'Home', 'keyup');
      expect(view.sidebar.getAttribute('aria-valuenow')).toBe('0');
      await key(view.sidebar, 'ArrowRight'); await key(view.sidebar, 'ArrowRight', 'keyup');
      expect(view.sidebar.getAttribute('aria-valuenow')).toBe('260');
      await act(async () => view.container.querySelector<HTMLButtonElement>('[aria-label="Hide mailbox sidebar"]')!.click());
      await view.resize(600); await view.resize(1400);
      expect(view.container.querySelector('[aria-label="Resize mailbox sidebar"]')?.getAttribute('aria-valuenow')).toBe('0');
      expect(view.container.querySelector('[aria-label="Show mailbox sidebar"]')).not.toBeNull();
    } finally { await view.dispose(); }
  });

  it('resizes both dividers, keeps the reader usable, and saves only after releasing the pointer', async () => {
    const view = await mount();
    try {
      const renderCount = view.rendered.mock.calls.length;
      await pointer(view.threads, 'pointerdown', 600);
      await pointer(view.threads, 'pointermove', 780);
      expect(view.threads.getAttribute('aria-valuenow')).toBe('570');
      expect(view.changed).not.toHaveBeenCalled();
      expect(view.rendered.mock.calls.length).toBe(renderCount);
      await pointer(view.threads, 'pointerup', 790);
      expect(view.changed).toHaveBeenLastCalledWith({ sidebar: 210, threads: 580 });
      expect(view.container.querySelector('.is-resizing-columns')).toBeNull();
      await pointer(view.sidebar, 'pointerdown', 210);
      await pointer(view.sidebar, 'pointerup', 1000);
      expect(view.changed).toHaveBeenLastCalledWith({ sidebar: 480, threads: 580 });
      await key(view.threads, 'End'); await key(view.threads, 'End', 'keyup');
      expect(view.changed).toHaveBeenLastCalledWith({ sidebar: 480, threads: 600 });
      expect(1400 - 480 - 600).toBe(320);
    } finally { await view.dispose(); }
  });

  it('supports keyboard resizing, cancellation, and double-click reset', async () => {
    const view = await mount({ sidebar: 240, threads: 450 });
    try {
      await key(view.threads, 'ArrowRight');
      expect(view.threads.getAttribute('aria-valuenow')).toBe('466');
      expect(view.changed).not.toHaveBeenCalled();
      await key(view.threads, 'ArrowRight', 'keyup');
      expect(view.changed).toHaveBeenLastCalledWith({ sidebar: 240, threads: 466 });
      await pointer(view.threads, 'pointerdown', 706); await pointer(view.threads, 'pointermove', 850);
      await key(view.threads, 'Escape');
      expect(view.threads.getAttribute('aria-valuenow')).toBe('466');
      expect(view.changed).toHaveBeenCalledTimes(1);
      await pointer(view.threads, 'pointerdown', 706); await pointer(view.threads, 'pointermove', 900);
      await pointer(view.threads, 'pointercancel', 900);
      expect(view.changed).toHaveBeenCalledTimes(1);
      await act(async () => view.threads.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
      expect(view.changed).toHaveBeenLastCalledWith({ sidebar: 240, threads: 390 });
    } finally { await view.dispose(); }
  });

  it('restores saved widths after a narrow window without persisting temporary limits', async () => {
    const view = await mount({ sidebar: 240, threads: 700 });
    try {
      await view.resize(900);
      expect(view.threads.getAttribute('aria-valuenow')).toBe('340');
      await view.resize(800);
      expect(view.container.querySelector('[aria-label="Resize mailbox sidebar"]')).toBeNull();
      expect(view.threads.getAttribute('aria-valuenow')).toBe('480');
      await view.resize(600);
      expect(view.container.querySelector('[role="separator"]')).toBeNull();
      expect(view.container.querySelector('main')?.style.gridTemplateColumns).toBe('');
      await view.resize(1400);
      expect(view.container.querySelector('[aria-label="Resize message list"]')?.getAttribute('aria-valuenow')).toBe('700');
      expect(view.changed).not.toHaveBeenCalled();
    } finally { await view.dispose(); }
  });

  it('omits the list divider when collapsed and all dividers in the mobile reader', async () => {
    const collapsed = await mount({ sidebar: 240, threads: 700 }, true);
    try {
      expect(collapsed.container.querySelectorAll('[role="separator"]')).toHaveLength(1);
      expect(collapsed.container.querySelector('main')?.style.gridTemplateColumns).toBe('240px minmax(0, 1fr)');
    } finally { await collapsed.dispose(); }
    const mobile = await mount({ sidebar: 240, threads: 700 }, false, true);
    try {
      expect(mobile.container.querySelector('[role="separator"]')).toBeNull();
      expect(mobile.container.querySelector('main')?.style.gridTemplateColumns).toBe('');
    } finally { await mobile.dispose(); }
  });
});
