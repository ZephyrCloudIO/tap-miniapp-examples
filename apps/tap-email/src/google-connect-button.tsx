import React, {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';

export interface GoogleConnectButtonProps {
  readonly busy: boolean;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly prepared: boolean;
  readonly onPrepare: () => void;
  readonly onLaunch: () => void;
}

const LABEL = 'Add account';

function isPrimaryPointer(event: PointerEvent<HTMLButtonElement>): boolean {
  return event.button === 0 && event.isPrimary;
}

/**
 * Preserves the browser's user-activation boundary while an authorization URL
 * is already prepared. Hover and focus only prepare that URL; launching remains
 * an explicit primary-pointer, keyboard, or assistive-technology activation.
 */
export function GoogleConnectButton({
  busy,
  children,
  className,
  prepared,
  onPrepare,
  onLaunch,
}: GoogleConnectButtonProps) {
  const prepareRequestedRef = useRef(false);
  const launchLatchedRef = useRef(false);
  const suppressNextPointerClickRef = useRef(false);
  const busyRef = useRef(busy);
  const previousBusyRef = useRef(busy);
  const previousPreparedRef = useRef(prepared);

  busyRef.current = busy;

  useEffect(() => {
    const busyFinished = previousBusyRef.current && !busy;
    const preparationWasInvalidated = previousPreparedRef.current && !prepared;

    if (busyFinished) {
      launchLatchedRef.current = false;
      suppressNextPointerClickRef.current = false;
      if (!prepared) prepareRequestedRef.current = false;
    }
    if (preparationWasInvalidated) prepareRequestedRef.current = false;

    previousBusyRef.current = busy;
    previousPreparedRef.current = prepared;
  }, [busy, prepared]);

  const requestPreparation = useCallback(() => {
    if (busy || prepared || prepareRequestedRef.current) return;

    prepareRequestedRef.current = true;
    try {
      onPrepare();
    } catch (error) {
      prepareRequestedRef.current = false;
      throw error;
    }
  }, [busy, onPrepare, prepared]);

  const launchOnce = useCallback((): boolean => {
    if (busy || !prepared || launchLatchedRef.current) return false;

    launchLatchedRef.current = true;
    try {
      onLaunch();
    } catch (error) {
      launchLatchedRef.current = false;
      throw error;
    }

    // An async parent normally raises `busy` and releases the latch when that
    // work settles. This microtask also releases it for synchronous consumers,
    // while the separate pointer-click latch still absorbs the ensuing click.
    queueMicrotask(() => {
      if (!busyRef.current) launchLatchedRef.current = false;
    });
    return true;
  }, [busy, onLaunch, prepared]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'mouse' || !isPrimaryPointer(event)) return;
    if (launchOnce()) suppressNextPointerClickRef.current = true;
  }, [launchOnce]);

  const handlePointerUp = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (
      (event.pointerType !== 'touch' && event.pointerType !== 'pen')
      || !isPrimaryPointer(event)
    ) return;
    if (launchOnce()) suppressNextPointerClickRef.current = true;
  }, [launchOnce]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (busy || !prepared) return;

    event.preventDefault();
    if (event.repeat) return;
    launchOnce();
  }, [busy, launchOnce, prepared]);

  const handleClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (suppressNextPointerClickRef.current) {
      suppressNextPointerClickRef.current = false;
      return;
    }
    if (busy) return;
    if (!prepared) {
      requestPreparation();
      return;
    }

    // Pointer activation is handled at pointerdown/pointerup so the trusted
    // gesture cannot expire. detail === 0 covers AT and programmatic activation.
    if (event.detail === 0) launchOnce();
  }, [busy, launchOnce, prepared, requestPreparation]);

  return (
    <button
      aria-busy={busy}
      aria-label={LABEL}
      className={className}
      disabled={busy}
      onClick={handleClick}
      onFocus={requestPreparation}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerEnter={requestPreparation}
      onPointerUp={handlePointerUp}
      type="button"
    >
      {children ?? LABEL}
    </button>
  );
}
