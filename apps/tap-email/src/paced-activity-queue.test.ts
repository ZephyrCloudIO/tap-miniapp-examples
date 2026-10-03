import { afterEach, describe, expect, it, rs } from '@rstest/core';
import { PacedActivityQueue } from './paced-activity-queue';

afterEach(() => { rs.useRealTimers(); });

describe('miniapp Pacer activity queue', () => {
  it('keeps adding nonblocking, groups a burst, and flushes after quiet time', async () => {
    rs.useFakeTimers();
    const process = rs.fn(async (_items: readonly number[]) => {});
    const queue = new PacedActivityQueue<number>(process, rs.fn());
    for (let index = 0; index < 5; index++) queue.add(index);
    expect(process).not.toHaveBeenCalled();
    await rs.advanceTimersByTimeAsync(100);
    expect(process).toHaveBeenCalledExactlyOnceWith([0, 1, 2, 3, 4]);
    await queue.close();
  });

  it('caps batch age during continuous input without dropping any events', async () => {
    rs.useFakeTimers();
    const batches: number[][] = [];
    const queue = new PacedActivityQueue<number>(async items => { batches.push([...items]); }, rs.fn());
    for (let index = 0; index < 20; index++) {
      queue.add(index);
      await rs.advanceTimersByTimeAsync(30);
      if (index === 4) expect(batches).toHaveLength(1);
    }
    await queue.close();
    expect(batches.flat()).toEqual(Array.from({ length: 20 }, (_, index) => index));
    expect(batches).toHaveLength(4);
  });

  it('serializes overlapping batches and drains accepted work on close', async () => {
    rs.useFakeTimers();
    let release!: () => void;
    let active = 0;
    let maximum = 0;
    const observed: number[] = [];
    const queue = new PacedActivityQueue<number>(async items => {
      maximum = Math.max(maximum, ++active);
      if (!observed.length) await new Promise<void>(done => { release = done; });
      observed.push(...items);
      active--;
    }, rs.fn());
    for (let index = 0; index < 8; index++) queue.add(index);
    await rs.advanceTimersByTimeAsync(0);
    for (let index = 8; index < 16; index++) queue.add(index);
    await rs.advanceTimersByTimeAsync(0);
    expect(maximum).toBe(1);
    release();
    await queue.close();
    expect(observed).toEqual(Array.from({ length: 16 }, (_, index) => index));
    expect(maximum).toBe(1);
  });

  it('caps cumulative publication age while new projections keep replacing it', async () => {
    rs.useFakeTimers();
    const process = rs.fn(async (_items: readonly number[]) => {});
    const queue = new PacedActivityQueue<number>(process, rs.fn(), { latestOnly: true });
    for (let index = 0; index < 5; index++) {
      queue.add(index);
      await rs.advanceTimersByTimeAsync(30);
    }
    expect(process).toHaveBeenCalledExactlyOnceWith([4]);
    await queue.close();
  });

  it('coalesces cumulative publications to the latest state while the SDK is stalled', async () => {
    rs.useFakeTimers();
    let release!: () => void;
    const observed: number[] = [];
    const queue = new PacedActivityQueue<number>(async items => {
      if (!observed.length) await new Promise<void>(done => { release = done; });
      observed.push(...items);
    }, rs.fn(), { latestOnly: true });
    for (let index = 0; index < 5; index++) queue.add(index);
    await rs.advanceTimersByTimeAsync(100);
    for (let index = 5; index < 100; index++) queue.add(index);
    await rs.advanceTimersByTimeAsync(500);
    expect(observed).toEqual([]);
    release();
    await queue.close();
    expect(observed).toEqual([4, 99]);
  });

  it('retries failures in the background and reports exhausted retries', async () => {
    rs.useFakeTimers();
    const process = rs.fn().mockRejectedValue(new Error('offline'));
    const onError = rs.fn();
    const queue = new PacedActivityQueue<number>(process, onError);
    queue.add(1);
    await rs.advanceTimersByTimeAsync(3_100);
    expect(process).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
    await queue.close();
  });

  it('discards pending activity when the owner changes', async () => {
    rs.useFakeTimers();
    const process = rs.fn(async () => {});
    const queue = new PacedActivityQueue<number>(process, rs.fn());
    queue.add(1);
    queue.dispose();
    queue.add(2);
    await rs.advanceTimersByTimeAsync(500);
    expect(process).not.toHaveBeenCalled();
  });
});
