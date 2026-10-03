import { useEffect, useState } from 'react';

const minuteMs = 60_000;
const currentMinute = () => Math.floor(Date.now() / minuteMs) * minuteMs;

/** One clock for due-reminder summaries and local-day presentation, including resume. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(currentMinute);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(currentMinute());
      clearTimeout(timer);
      timer = setTimeout(tick, minuteMs - Date.now() % minuteMs);
    };
    tick();
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return now;
}
