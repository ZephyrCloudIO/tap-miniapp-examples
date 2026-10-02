/**
 * Realm-local registry that lets the exported lifecycle entry point reach the
 * mounted surface controller.
 *
 * The host drives lifecycle phases through the package's `./tap/lifecycle`
 * expose while the surface itself is mounted through `./ui/desktop`, so pause,
 * resume, and checkpoint capture must travel from here to the controller.
 *
 * The checkpoint covers what the surface is currently showing, not the
 * notification history: tracked pull requests and unread state are durable in
 * the workspace store, and a stale checkpoint must never be able to outvote it.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface LifecycleTransitionContext {
  readonly hidden?: boolean;
  readonly checkpointReference?: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface LifecycleParticipant {
  capture(): JsonValue;
  restore(value: JsonValue): void | Promise<void>;
  pause(): void | Promise<void>;
  resume(): void | Promise<void>;
}

interface CheckpointStore {
  save(reference: string, value: JsonValue): void | Promise<void>;
  load(
    reference: string,
  ): JsonValue | undefined | Promise<JsonValue | undefined>;
}

const participants = new Map<string, LifecycleParticipant>();
const memoryCheckpoints = new Map<string, JsonValue>();

/** The host-provided checkpoint store for this transition, when there is one. */
const checkpointStore = (
  transition: LifecycleTransitionContext,
): CheckpointStore | undefined => {
  const candidate = transition.context?.checkpoint;
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const store = candidate as Partial<CheckpointStore>;
  return typeof store.save === "function" && typeof store.load === "function"
    ? (store as CheckpointStore)
    : undefined;
};

const cloneJson = (value: JsonValue): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

export const registerLifecycleParticipant = (
  id: string,
  participant: LifecycleParticipant,
): (() => void) => {
  if (participants.has(id)) {
    throw new Error(
      `A PR Radar lifecycle participant already uses id ${id}.`,
    );
  }
  participants.set(id, participant);
  return () => {
    if (participants.get(id) === participant) participants.delete(id);
  };
};

/** Snapshot every mounted surface, or report that there was nothing to save. */
export const captureCheckpoint = async (
  transition: LifecycleTransitionContext,
): Promise<boolean> => {
  const reference = transition.checkpointReference;
  if (!reference) return false;
  const snapshot: JsonValue = {
    version: 1,
    mounts: Object.fromEntries(
      [...participants.entries()].map(([id, participant]) => [
        id,
        cloneJson(participant.capture()),
      ]),
    ),
  };
  memoryCheckpoints.set(reference, snapshot);
  await checkpointStore(transition)?.save(reference, snapshot);
  return true;
};

export const restoreCheckpoint = async (
  transition: LifecycleTransitionContext,
): Promise<boolean> => {
  const reference = transition.checkpointReference;
  if (!reference) return true;
  const snapshot =
    (await checkpointStore(transition)?.load(reference)) ??
    memoryCheckpoints.get(reference);
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    Array.isArray(snapshot)
  ) {
    return false;
  }
  const mounts = snapshot.mounts;
  if (typeof mounts !== "object" || mounts === null || Array.isArray(mounts)) {
    return false;
  }
  await Promise.all(
    [...participants.entries()].map(async ([id, participant]) => {
      const value = mounts[id];
      if (value !== undefined) await participant.restore(cloneJson(value));
    }),
  );
  return true;
};

export const pauseParticipants = async (): Promise<void> => {
  await Promise.all(
    [...participants.values()].map((participant) => participant.pause()),
  );
};

export const resumeParticipants = async (): Promise<void> => {
  await Promise.all(
    [...participants.values()].map((participant) => participant.resume()),
  );
};

export const clearLifecycleState = (): void => {
  participants.clear();
  memoryCheckpoints.clear();
};
