/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rs } from '@rstest/core';
import { useDelayedStatus } from './use-delayed-status';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Status({ message }: { message: string }) {
  const visible = useDelayedStatus(Boolean(message), 15_000);
  return visible ? <span role="status">{message}</span> : null;
}

describe('status grace period', () => {
  it('never flashes a transient failure, shows persistent failures, and clears immediately on recovery', async () => {
    rs.useFakeTimers();
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(<Status message="Trying again" />));
      await act(async () => rs.advanceTimersByTimeAsync(10_000));
      expect(container.textContent).toBe('');
      await act(async () => root.render(<Status message="" />));
      await act(async () => rs.advanceTimersByTimeAsync(10_000));
      expect(container.textContent).toBe('');
      await act(async () => root.render(<Status message="Offline" />));
      await act(async () => rs.advanceTimersByTimeAsync(10_000));
      await act(async () => root.render(<Status message="Still offline" />));
      await act(async () => rs.advanceTimersByTimeAsync(5_000));
      expect(container.textContent).toBe('Still offline');
      await act(async () => root.render(<Status message="" />));
      expect(container.textContent).toBe('');
    } finally {
      await act(async () => root.unmount());
      rs.useRealTimers();
    }
  });
});
