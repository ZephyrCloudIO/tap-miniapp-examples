import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { createFunnelTracker } from "./funnel-tracker";

afterEach(() => { rs.useRealTimers(); });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("public funnel delivery", () => {
  it("retries a lost start and deduplicates back navigation after acknowledgement", async () => {
    rs.useFakeTimers();
    const send = rs.fn<(stage: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const tracker = createFunnelTracker({ send, retryable: () => true, onFailure: rs.fn() });
    tracker.record("starts");
    await settle();
    await rs.advanceTimersByTimeAsync(1_000);
    expect(send.mock.calls).toEqual([["starts"], ["starts"]]);
    tracker.record("views");
    tracker.record("slotViews");
    tracker.record("starts");
    expect(send).toHaveBeenCalledTimes(2);
    tracker.stop();
  });

  it("delivers the highest stage reached while a request is in flight", async () => {
    let release!: () => void;
    const send = rs.fn<(stage: string) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }))
      .mockResolvedValue(undefined);
    const tracker = createFunnelTracker({ send, retryable: () => true, onFailure: rs.fn() });
    tracker.record("views");
    tracker.record("slotViews");
    tracker.record("starts");
    release();
    await settle();
    expect(send.mock.calls).toEqual([["views"], ["starts"]]);
    tracker.stop();
  });

  it("bounds retries, exposes delivery failure, and recovers on reconnection", async () => {
    rs.useFakeTimers();
    const send = rs.fn<(stage: string) => Promise<void>>().mockRejectedValue(new Error("network"));
    const onFailure = rs.fn();
    const tracker = createFunnelTracker({ send, retryable: () => true, onFailure });
    tracker.record("views");
    await settle();
    await rs.advanceTimersByTimeAsync(44_000);
    expect(send).toHaveBeenCalledTimes(5);
    expect(onFailure).toHaveBeenCalledTimes(1);
    send.mockResolvedValue(undefined);
    tracker.resume();
    await settle();
    expect(send).toHaveBeenCalledTimes(6);
    tracker.stop();
  });

  it("does not retry invalid requests or leave retry timers after unmount", async () => {
    rs.useFakeTimers();
    const send = rs.fn<(stage: string) => Promise<void>>().mockRejectedValue(new Error("invalid"));
    const failure = rs.fn();
    const invalid = createFunnelTracker({ send, retryable: () => false, onFailure: failure });
    invalid.record("views");
    await settle();
    await rs.advanceTimersByTimeAsync(100_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledTimes(1);
    invalid.stop();
    const retrying = createFunnelTracker({ send, retryable: () => true, onFailure: failure });
    retrying.record("views");
    await settle();
    retrying.stop();
    await rs.advanceTimersByTimeAsync(100_000);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
