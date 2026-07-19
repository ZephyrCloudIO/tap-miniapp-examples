import { describe, expect, it } from "@rstest/core";
import {
  captureCheckpoint,
  clearLifecycleParticipants,
  pauseParticipants,
  registerLifecycleParticipant,
  restoreCheckpoint,
  resumeParticipants,
  type LifecycleJson,
} from "./lifecycle-state";

describe("lifecycle checkpoint boundary", () => {
  it("captures, restores, pauses, and resumes registered runtime state", async () => {
    clearLifecycleParticipants();
    let value: LifecycleJson = { position: 18.5 };
    let paused = false;
    const records = new Map<string, LifecycleJson>();
    const unregister = registerLifecycleParticipant(`runtime:${crypto.randomUUID()}`, {
      capture: () => value,
      restore: (saved) => { value = saved; },
      pause: () => { paused = true; },
      resume: () => { paused = false; },
    });
    const transition = {
      checkpointReference: `checkpoint:${crypto.randomUUID()}`,
      context: {
        checkpoint: {
          save: (reference: string, saved: LifecycleJson) => { records.set(reference, structuredClone(saved)); },
          load: (reference: string) => structuredClone(records.get(reference)),
        },
      },
    };

    expect(await captureCheckpoint(transition)).toBe(true);
    value = { position: 0 };
    expect(await restoreCheckpoint(transition)).toBe(true);
    expect(value).toEqual({ position: 18.5 });
    await pauseParticipants();
    expect(paused).toBe(true);
    await resumeParticipants();
    expect(paused).toBe(false);
    unregister();
    clearLifecycleParticipants();
  });
});
