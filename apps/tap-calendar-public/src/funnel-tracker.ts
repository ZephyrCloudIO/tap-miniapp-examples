export type FunnelStage = "views" | "slotViews" | "starts";
const ranks: Record<FunnelStage, number> = { views: 0, slotViews: 1, starts: 2 };
const delays = [1_000, 3_000, 10_000, 30_000];

/** One in-memory queue per page visit. Every retry uses the same visit ID. */
export function createFunnelTracker(options: {
  readonly send: (stage: FunnelStage) => Promise<void>;
  readonly retryable: (error: unknown) => boolean;
  readonly onFailure: () => void;
}) {
  let desired: FunnelStage = "views";
  let acknowledged = -1;
  let running = false;
  let stopped = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const flush = async (): Promise<void> => {
    if (stopped || running || acknowledged >= ranks[desired]) return;
    clearTimer();
    running = true;
    const stage = desired;
    let failed = false;
    try {
      await options.send(stage);
      acknowledged = Math.max(acknowledged, ranks[stage]);
      retry = 0;
    } catch (error) {
      failed = true;
      if (!stopped && options.retryable(error) && retry < delays.length) {
        timer = setTimeout(() => { void flush(); }, delays[retry++]);
      } else if (!stopped) {
        options.onFailure();
      }
    } finally {
      running = false;
    }
    // A higher stage entered while a request was in flight must be delivered.
    // Sending starts repairs any missing earlier events on the server.
    if (!stopped && (!failed || ranks[desired] > ranks[stage])) void flush();
  };
  return {
    record(stage: FunnelStage) {
      if (ranks[stage] > ranks[desired]) { desired = stage; retry = 0; }
      void flush();
    },
    resume() { retry = 0; void flush(); },
    stop() { stopped = true; clearTimer(); },
  };
}
