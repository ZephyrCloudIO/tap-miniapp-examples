export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Document = { [key: string]: Json };
export interface Snapshot { revision: number | null; value: Document }
export interface Replica { base: Snapshot; value: Document; migration?: Document }
export interface StatePort {
  read(): Promise<Snapshot>;
  write(snapshot: Snapshot): Promise<Snapshot>;
}
export interface ReplicaStore {
  read(): Promise<Replica | null>;
  write(replica: Replica): Promise<void>;
}
export function replicaStore(storage: {
  get(address: { namespace: string; key: string }): { value: unknown; revision: number | null } | PromiseLike<{ value: unknown; revision: number | null }>;
  set(input: { namespace: string; key: string; expectedRevision: number | null; value: Json }): { revision: number } | PromiseLike<{ revision: number }>;
}, address: { namespace: string; key: string }): ReplicaStore {
  let revision: number | null = null;
  return {
    async read() { const entry = await storage.get(address); revision = entry.revision; return parseReplica(entry.value); },
    async write(replica) {
      const saved = await storage.set({ ...address, expectedRevision: revision, value: JSON.parse(JSON.stringify(replica)) });
      revision = saved.revision;
    },
  };
}
export const emptySnapshot = (): Snapshot => ({ revision: null, value: {} });
export class SettingsNotSavedError extends Error {}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export function isDocument(value: unknown): value is Document {
  const valid = (value: unknown, depth: number): boolean => {
    if (depth > 32) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(item => valid(item, depth + 1));
    return record(value) && Object.entries(value).every(([key, item]) =>
      !['__proto__', 'prototype', 'constructor'].includes(key) && valid(item, depth + 1));
  };
  return record(value) && valid(value, 0);
}
export function parseSnapshot(value: unknown): Snapshot {
  if (!record(value) || !isDocument(value.value) ||
    !(value.revision === null || (typeof value.revision === 'number' && Number.isSafeInteger(value.revision) && value.revision > 0))) {
    throw new Error('The shared settings response is invalid.');
  }
  return { revision: value.revision, value: value.value };
}
export function parseReplica(value: unknown): Replica | null {
  if (value === null) return null;
  if (!record(value) || !isDocument(value.value)) throw new Error('The pending settings journal is invalid.');
  return { base: parseSnapshot(value.base), value: value.value,
    ...(isDocument(value.migration) ? { migration: value.migration } : {}) };
}
export const equal = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((v, i) => equal(v, right[i]));
  return record(left) && record(right) && Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
};

/** Apply only locally edited fields. Unchanged fields and deletions follow the
 * server. Identified collections merge by ID; simultaneous edits to one scalar
 * use the last acknowledged write, without a device-clock dependency. */
export function rebase(base: Document, local: Document, remote: Document): Document {
  const merge = (base: Json | undefined, local: Json | undefined, remote: Json | undefined): Json | undefined => {
    if (equal(base, local)) return remote;
    if (record(local) && (base === undefined || record(base)) && (remote === undefined || record(remote))) {
      const result: Document = {};
      for (const key of new Set([...Object.keys(base ?? {}), ...Object.keys(local), ...Object.keys(remote ?? {})])) {
        const next = merge(base?.[key], local[key], remote?.[key]);
        if (next !== undefined) result[key] = next;
      }
      return result;
    }
    const identified = (items: Json | undefined): items is (Document & { id: string })[] => {
      if (!Array.isArray(items)) return false;
      const ids = new Set<string>();
      for (const item of items) {
        if (!record(item) || typeof item.id !== 'string' || ids.has(item.id)) return false;
        ids.add(item.id);
      }
      return true;
    };
    if (identified(local) && identified(base ?? []) && identified(remote ?? [])) {
      const keyed = (items: Json | undefined): Document => Object.fromEntries((items as (Document & { id: string })[] ?? []).map(item => [item.id, item]));
      return Object.values(merge(keyed(base), keyed(local), keyed(remote)) as Document);
    }
    return local;
  };
  return merge(base, local, remote) as Document;
}

/** Device journal + revisioned service; no module-global account state. */
export class SharedState {
  private queue: Promise<unknown> = Promise.resolve();
  private replica: Replica | null = null;
  private active = true;
  private readonly port: StatePort;
  private readonly store: ReplicaStore;
  constructor(port: StatePort, store: ReplicaStore) { this.port = port; this.store = store; }
  get ready() { return this.replica !== null; }
  get document(): Document { return this.replica?.value ?? {}; }
  dispose() { this.active = false; }
  private assertActive() { if (!this.active) throw new Error('This account is no longer active.'); }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const pending = this.queue.catch(() => {}).then(() => { this.assertActive(); return run(); });
    this.queue = pending; return pending;
  }
  private async persist(replica: Replica) {
    this.assertActive();
    await this.store.write(replica);
    this.replica = replica;
  }
  open(legacy: Document | (() => Promise<Document>) = {}): Promise<Document> {
    return this.serial(async () => {
      this.replica = await this.store.read();
      if (!this.replica) {
        // Keep the original migration snapshot even after acknowledgement.
        // Established server choices win on first import; missing fields migrate.
        const migration = typeof legacy === 'function' ? await legacy() : legacy;
        const remote = await this.port.read();
        this.assertActive();
        const importMissing = (legacy: Document, current: Document): Document => Object.fromEntries(
          [...new Set([...Object.keys(legacy), ...Object.keys(current)])].map(key => {
            const old = legacy[key]; const present = current[key];
            return [key, present === undefined ? old! : isDocument(old) && isDocument(present) ? importMissing(old, present) : present];
          }),
        );
        const value = importMissing(migration, remote.value);
        await this.persist({ base: remote, value, migration });
      }
      return this.flush();
    });
  }
  change(update: (current: Document) => Document): Promise<Document> {
    return this.serial(async () => {
      if (!this.replica) throw new Error('Shared settings have not loaded. Reconnect before changing them.');
      const value = update(this.replica.value);
      if (!isDocument(value)) throw new Error('The settings change is invalid.');
      try { await this.persist({ ...this.replica, value }); }
      catch (cause) { throw new SettingsNotSavedError(`Settings were not saved on this device: ${String(cause)}`); }
      return this.flush();
    });
  }
  refresh(): Promise<Document> { return this.serial(() => this.flush()); }
  private async flush(): Promise<Document> {
    if (!this.replica) throw new Error('Shared settings have not loaded.');
    for (let attempt = 0; attempt < 4; attempt++) {
      const remote = await this.port.read();
      this.assertActive();
      const value = rebase(this.replica.base.value, this.replica.value, remote.value);
      if (equal(value, remote.value)) {
        // Polls usually find nothing new; skip the device write when the journal already matches.
        if (!equal(this.replica.base, remote) || !equal(this.replica.value, value)) {
          await this.persist({ ...this.replica, base: remote, value });
        }
        return value;
      }
      try {
        const saved = await this.port.write({ revision: remote.revision, value });
        this.assertActive();
        await this.persist({ ...this.replica, base: saved, value: saved.value });
        return saved.value;
      } catch (error) {
        if (!(record(error) && error.status === 409) || attempt === 3) throw error;
      }
    }
    throw new Error('Settings changed repeatedly. Retry sync.');
  }
}
