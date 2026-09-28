import { useEffect, useState } from 'react';

/** Short operations/failures never flash; a changed error does not restart the grace period. */
export function useDelayedStatus(active: boolean, delayMs: number): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) { setVisible(false); return; }
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return active && visible;
}
