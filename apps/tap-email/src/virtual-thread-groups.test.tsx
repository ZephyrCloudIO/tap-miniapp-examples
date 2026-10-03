/** @rstest-environment jsdom */
import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, rs } from '@rstest/core';
import { VirtualThreadGroups } from './virtual-thread-groups';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('attaches to the parent scroller after commit and renders a bounded initial range', async () => {
  rs.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  rs.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.className === 'thread-list' ? 650 : 96;
  });
  rs.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(430);
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  function Fixture() {
    const scrollRef = useRef<HTMLDivElement>(null);
    return <div ref={scrollRef} className="thread-list"><VirtualThreadGroups scrollRef={scrollRef} selectedKey={null}
      groups={[{ dateKey: 'day', label: 'Today', items: Array.from({ length: 1000 }, (_, index) => ({ key: String(index) })) }]}
      renderRow={item => <button role="option" key={item.key}>{item.key}</button>} /></div>;
  }
  try {
    await act(async () => root.render(<Fixture />));
    expect(container.querySelector('.virtual-mail-history')).not.toBeNull();
    const rows = container.querySelectorAll('[role="option"]');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(30);
    expect(rows[0]!.textContent).toBe('0');
  } finally { await act(async () => root.unmount()); container.remove(); rs.restoreAllMocks(); rs.unstubAllGlobals(); }
});
