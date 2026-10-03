import { useEffect, useRef } from 'react';

/** Finalize session-owned resources after unmount, allowing synchronous effect replay. */
export function useSessionCleanup(cleanup: () => void): void {
  const lease = useRef<{ cleanup: () => void; token: object } | null>(null);
  useEffect(() => {
    const token = {};
    lease.current = { cleanup, token };
    return () => {
      // React can reconnect this same session before the microtask runs. A new
      // cleanup identity still finalizes the previous resources independently.
      queueMicrotask(() => {
        if (lease.current?.cleanup === cleanup && lease.current.token !== token) return;
        cleanup();
      });
    };
  }, [cleanup]);
}
