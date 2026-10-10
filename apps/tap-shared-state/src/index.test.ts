import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SharedState, emptySnapshot, rebase, parseReplica, type Replica, type Snapshot, type StatePort } from './index.ts';

function fixture() {
  let snapshot = emptySnapshot(); let online = true; let loseReceipt = false; let writes = 0;
  const port: StatePort = {
    async read() { if (!online) throw new Error('offline'); return structuredClone(snapshot); },
    async write(value) {
      if (!online) throw new Error('offline');
      if (value.revision !== snapshot.revision) throw Object.assign(new Error('conflict'), { status: 409 });
      snapshot = { revision: (snapshot.revision ?? 0) + 1, value: structuredClone(value.value) }; writes++;
      if (loseReceipt) { loseReceipt = false; throw new Error('response lost'); }
      return structuredClone(snapshot);
    },
  };
  const device = () => {
    let saved: Replica | null = null; let storeWrites = 0;
    const store = { async read() { return structuredClone(saved); }, async write(value: Replica) { saved = structuredClone(value); storeWrites++; } };
    return { start: () => new SharedState(port, store), journal: () => saved, storeWrites: () => storeWrites };
  };
  return { device, port, snapshot: () => snapshot, writes: () => writes,
    online: (value: boolean) => { online = value; }, loseReceipt: () => { loseReceipt = true; } };
}
test('a fresh phone restores desktop state and independent edits converge in both directions', async () => {
  const f = fixture(); const desktop = f.device().start(); const phone = f.device().start();
  await desktop.open({ preferences: { images: false, notify: true }, schedules: [{ id: 'work', start: '09:00' }] });
  assert.deepEqual(await phone.open(), f.snapshot().value);
  await desktop.change(value => ({ ...value, preferences: { ...value.preferences as object, images: true } }));
  await phone.change(value => ({ ...value, preferences: { ...value.preferences as object, notify: false } }));
  assert.deepEqual((await desktop.refresh()).preferences, { images: true, notify: false });
});
test('opening the phone first does not seed defaults over an existing desktop setup', async () => {
  const f = fixture(); const phone = f.device().start(); await phone.open(); assert.equal(f.writes(), 0);
  const desktop = f.device().start(); await desktop.open({ availability: [{ id: 'old', name: 'Working hours' }] });
  assert.deepEqual((await phone.refresh()).availability, [{ id: 'old', name: 'Working hours' }]);
});
test('offline edits survive a process restart and merge with newer server fields', async () => {
  const f = fixture(); const device = f.device(); const phone = device.start(); const desktop = f.device().start();
  await phone.open({ preferences: { a: false, b: false } }); await desktop.open();
  f.online(false);
  await assert.rejects(phone.change(value => ({ ...value, preferences: { ...value.preferences as object, a: true } })), /offline/);
  assert.notDeepEqual(device.journal()!.value, device.journal()!.base.value); phone.dispose();
  f.online(true); await desktop.change(value => ({ ...value, preferences: { ...value.preferences as object, b: true } }));
  assert.deepEqual((await device.start().open()).preferences, { a: true, b: true });
});
test('a lost commit receipt is reconciled without another write', async () => {
  const f = fixture(); const device = f.device(); const client = device.start(); await client.open();
  f.loseReceipt(); await assert.rejects(client.change(() => ({ choice: 'saved' })), /response lost/);
  const writes = f.writes(); assert.deepEqual(await client.refresh(), { choice: 'saved' }); assert.equal(f.writes(), writes);
});
test('concurrent creates use CAS and retain both devices edits', async () => {
  const f = fixture(); const a = f.device().start(); const b = f.device().start(); await Promise.all([a.open(), b.open()]);
  await Promise.all([a.change(() => ({ a: 1 })), b.change(() => ({ b: 2 }))]);
  assert.deepEqual(await a.refresh(), { a: 1, b: 2 });
});
test('entity additions and removals do not drop unrelated edits or revive unchanged deleted entities', () => {
  const base = { schedules: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] };
  const local = { schedules: [{ id: 'a', title: 'A' }, { id: 'b', title: 'edited' }, { id: 'c', title: 'C' }] };
  assert.deepEqual(rebase(base, local, { schedules: [{ id: 'b', title: 'B' }] }),
    { schedules: [{ id: 'b', title: 'edited' }, { id: 'c', title: 'C' }] });
});
test('migration retains a backup and respects existing server deletions and choices', async () => {
  const f = fixture(); await f.port.write({ revision: null, value: { schedules: [], preferences: { notify: false }, corrections: { phone: true } } });
  const device = f.device(); const result = await device.start().open({ schedules: [{ id: 'deleted' }], preferences: { notify: true, images: false }, corrections: { mac: true } });
  assert.deepEqual(result, { schedules: [], preferences: { notify: false, images: false }, corrections: { phone: true, mac: true } });
  assert.ok(device.journal()!.migration);
});
test('closed accounts cannot write and corrupt journals fail visibly', async () => {
  const f = fixture(); const client = f.device().start(); await client.open(); client.dispose();
  await assert.rejects(client.change(() => ({ bad: true })), /no longer active/);
  assert.equal(f.writes(), 0); assert.throws(() => parseReplica({ base: {}, value: {} }), /invalid/);
});
test('an unchanged refresh does not rewrite the device journal', async () => {
  const f = fixture(); const device = f.device(); const phone = device.start();
  await phone.open({ preferences: { notify: true } });
  const before = device.storeWrites();
  await phone.refresh(); await phone.refresh();
  assert.equal(device.storeWrites(), before);
  const desktop = f.device().start(); await desktop.open();
  await desktop.change(value => ({ ...value, preferences: { notify: false } }));
  assert.deepEqual((await phone.refresh()).preferences, { notify: false });
  assert.equal(device.storeWrites(), before + 1);
});
