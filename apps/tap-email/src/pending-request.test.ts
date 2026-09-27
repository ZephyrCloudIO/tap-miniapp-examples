import { describe, expect, it } from '@rstest/core';
import {
  INITIAL_MAILBOX_PENDING_MESSAGE,
  watchForDelayedPendingRequest,
} from './pending-request';

function waitForTimer(): Promise<void> {
  return new Promise(resolve => globalThis.setTimeout(resolve, 5));
}

describe('delayed pending request', () => {
  it('shows guidance only after the request remains unresolved and clears it on success', async () => {
    let resolveRequest!: (value: string) => void;
    const request = new Promise<string>(resolve => {
      resolveRequest = resolve;
    });
    const transitions: boolean[] = [];
    const watched = watchForDelayedPendingRequest(
      request,
      pending => transitions.push(pending),
      0,
    );

    await waitForTimer();
    expect(transitions).toEqual([true]);

    resolveRequest('mailbox');
    await expect(watched.result).resolves.toBe('mailbox');
    expect(transitions).toEqual([true, false]);
  });

  it('clears guidance and preserves the original rejection', async () => {
    let rejectRequest!: (error: Error) => void;
    const request = new Promise<never>((_resolve, reject) => {
      rejectRequest = reject;
    });
    const transitions: boolean[] = [];
    const watched = watchForDelayedPendingRequest(
      request,
      pending => transitions.push(pending),
      0,
    );

    await waitForTimer();
    const failure = new Error('network failed');
    rejectRequest(failure);

    await expect(watched.result).rejects.toBe(failure);
    expect(transitions).toEqual([true, false]);
  });

  it('cancels the timer and clears visible guidance without touching the request', async () => {
    const request = new Promise<string>(() => undefined);
    const transitions: boolean[] = [];
    const watched = watchForDelayedPendingRequest(
      request,
      pending => transitions.push(pending),
      0,
    );

    await waitForTimer();
    watched.cancel();
    expect(transitions).toEqual([true, false]);
  });

  it('describes a slow request without assuming an approval prompt', () => {
    expect(INITIAL_MAILBOX_PENDING_MESSAGE).toContain('mail service');
    expect(INITIAL_MAILBOX_PENDING_MESSAGE).not.toMatch(
      /API Workbench|localhost|approval|Allow for Session/iu,
    );
  });
});
