export type LifecycleJson = null | boolean | number | string | LifecycleJson[] | { [key: string]: LifecycleJson };

export interface LifecycleParticipant {
  capture(): LifecycleJson;
  restore(value: LifecycleJson): void | Promise<void>;
  pause(): void | Promise<void>;
  resume(): void | Promise<void>;
}

export interface LifecycleTransitionContext {
  hidden?: boolean;
  checkpointReference?: string;
  context?: {
    checkpoint?: {
      save(reference: string, value: LifecycleJson): void | Promise<void>;
      load(reference: string): LifecycleJson | undefined | Promise<LifecycleJson | undefined>;
    };
  };
}

interface LifecycleCheckpoint {
  version: 1;
  participants: Record<string, LifecycleJson>;
}

const participants = new Map<string, LifecycleParticipant>();

export const registerLifecycleParticipant = (id: string, participant: LifecycleParticipant): (() => void) => {
  if (participants.has(id)) throw new Error(`A player lifecycle participant already uses id ${id}.`);
  participants.set(id, participant);
  return () => {
    if (participants.get(id) === participant) participants.delete(id);
  };
};

const checkpointFrom = (value: LifecycleJson | undefined): LifecycleCheckpoint | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as { version?: unknown; participants?: unknown };
  if (candidate.version !== 1 || !candidate.participants || typeof candidate.participants !== "object" || Array.isArray(candidate.participants)) return null;
  return candidate as LifecycleCheckpoint;
};

export const captureCheckpoint = async (transition: LifecycleTransitionContext): Promise<boolean> => {
  const reference = transition.checkpointReference;
  const storage = transition.context?.checkpoint;
  if (!reference || !storage) return true;
  const captured: Record<string, LifecycleJson> = {};
  for (const [id, participant] of participants) captured[id] = participant.capture();
  await storage.save(reference, { version: 1, participants: captured });
  return true;
};

export const restoreCheckpoint = async (transition: LifecycleTransitionContext): Promise<boolean> => {
  const reference = transition.checkpointReference;
  const storage = transition.context?.checkpoint;
  if (!reference || !storage) return true;
  const checkpoint = checkpointFrom(await storage.load(reference));
  if (!checkpoint) return true;
  for (const [id, participant] of participants) {
    const saved = checkpoint.participants[id];
    if (saved !== undefined) await participant.restore(saved);
  }
  return true;
};

export const pauseParticipants = async (): Promise<void> => {
  await Promise.all([...participants.values()].map(async (participant) => participant.pause()));
};

export const resumeParticipants = async (): Promise<void> => {
  await Promise.all([...participants.values()].map(async (participant) => participant.resume()));
};

export const clearLifecycleParticipants = (): void => participants.clear();
