import { afterEach, describe, expect, it, rs } from '@rstest/core';
import { MAIL_REFRESH_INTERVAL_MS, MailRefreshScheduler } from './mail-refresh-scheduler';

afterEach(() => { rs.useRealTimers(); });

describe('quiet mailbox refresh', () => {
  it('avoids a duplicate startup request, coalesces focus, and skips hidden/offline polling', async () => {
    rs.useFakeTimers();
    const refresh = rs.fn(async () => {});
    let visible = true;
    const scheduler = new MailRefreshScheduler(refresh, () => visible);
    scheduler.resume();
    await rs.advanceTimersByTimeAsync(30_000);
    expect(refresh).not.toHaveBeenCalled();
    visible = false;
    await rs.advanceTimersByTimeAsync(MAIL_REFRESH_INTERVAL_MS);
    expect(refresh).not.toHaveBeenCalled();
    visible = true;
    scheduler.resume(); scheduler.resume(); scheduler.resume();
    await rs.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    scheduler.resume();
    await rs.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    scheduler.dispose();
    await rs.advanceTimersByTimeAsync(MAIL_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures with backoff and returns to the normal cadence after recovery', async () => {
    rs.useFakeTimers();
    const refresh = rs.fn().mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const scheduler = new MailRefreshScheduler(refresh, () => true, 5_000);
    await rs.advanceTimersByTimeAsync(5_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await rs.advanceTimersByTimeAsync(5_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    await rs.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    await rs.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    scheduler.dispose();
  });
});
