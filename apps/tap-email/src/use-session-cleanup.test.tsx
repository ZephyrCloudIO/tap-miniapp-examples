/** @rstest-environment jsdom */
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rstest as rs } from '@rstest/core';
import { PacedActivityQueue } from './paced-activity-queue';
import { useSessionCleanup } from './use-session-cleanup';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('session resource lifetime', () => {
  it('keeps a session queue alive through Strict Mode replay and closes it once on unmount', async () => {
    const process = rs.fn(async () => undefined);
    const close = rs.fn();
    let queue!: PacedActivityQueue<string>;
    function Session() {
      const [owned] = useState(() => new PacedActivityQueue<string>(process, () => undefined));
      const [cleanup] = useState(() => () => { close(); owned.dispose(); });
      queue = owned;
      useSessionCleanup(cleanup);
      return null;
    }
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<React.StrictMode><Session /></React.StrictMode>));
    expect(close).not.toHaveBeenCalled();
    queue.add('view');
    await queue.flush();
    expect(process).toHaveBeenCalledWith(['view']);
    await act(async () => root.unmount());
    expect(close).toHaveBeenCalledTimes(1);
    queue.add('after-unmount');
    await queue.flush();
    expect(process).toHaveBeenCalledTimes(1);
  });

  it('finalizes the previous cleanup when resource identity changes', async () => {
    const first = rs.fn();
    const next = rs.fn();
    function Session({ cleanup }: { cleanup: () => void }) { useSessionCleanup(cleanup); return null; }
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Session cleanup={first} />));
    await act(async () => root.render(<Session cleanup={next} />));
    expect(first).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('closes the old keyed session while retaining a replacement with the same cleanup function', async () => {
    const close = rs.fn();
    function Session() { useSessionCleanup(close); return null; }
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Session key="old" />));
    await act(async () => root.render(<Session key="new" />));
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    expect(close).toHaveBeenCalledTimes(2);
  });
});
