export const INITIAL_MAILBOX_APPROVAL_DELAY_MS = 1_500;

export const INITIAL_MAILBOX_APPROVAL_MESSAGE =
  'Approve the API Workbench network access prompt for localhost to load mail. ' +
  'If it is behind TAP, bring it forward and choose “Allow for Session.”';

export interface DelayedPendingRequest<T> {
  readonly result: Promise<T>;
  cancel(): void;
}

export function watchForDelayedPendingRequest<T>(
  request: Promise<T>,
  onPendingChange: (pending: boolean) => void,
  delayMs = INITIAL_MAILBOX_APPROVAL_DELAY_MS,
): DelayedPendingRequest<T> {
  let active = true;
  let pendingShown = false;
  const timer = globalThis.setTimeout(() => {
    if (!active) return;
    pendingShown = true;
    onPendingChange(true);
  }, delayMs);

  const finish = () => {
    if (!active) return;
    active = false;
    globalThis.clearTimeout(timer);
    if (pendingShown) onPendingChange(false);
  };

  return {
    result: request.then(
      value => {
        finish();
        return value;
      },
      error => {
        finish();
        throw error;
      },
    ),
    cancel: finish,
  };
}
