/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rs } from '@rstest/core';
import { useMinuteClock } from './use-minute-clock';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Clock() { return <output>{new Date(useMinuteClock()).toISOString()}</output>; }

describe('mail presentation clock', () => {
  it('updates at midnight and catches up after resume without duplicate timers in Strict Mode', async () => {
    rs.useFakeTimers();
    rs.setSystemTime(new Date('2026-10-03T23:59:59Z'));
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(<React.StrictMode><Clock /></React.StrictMode>));
      expect(container.textContent).toBe('2026-10-03T23:59:00.000Z');
      expect(rs.getTimerCount()).toBe(1);
      await act(async () => rs.advanceTimersByTimeAsync(1000));
      expect(container.textContent).toBe('2026-10-04T00:00:00.000Z');
      rs.setSystemTime(new Date('2026-10-04T10:00:01Z'));
      await act(async () => window.dispatchEvent(new Event('focus')));
      expect(container.textContent).toBe('2026-10-04T10:00:00.000Z');
      expect(rs.getTimerCount()).toBe(1);
      await act(async () => root.unmount());
      expect(rs.getTimerCount()).toBe(0);
    } finally { rs.useRealTimers(); }
  });
});
