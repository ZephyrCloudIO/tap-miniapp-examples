import { describe, expect, it, rstest as rs } from '@rstest/core';
import { defaultPreferences, normalizeMailPreferences } from './domain';
import { loadPreferences, savePreferences } from './storage';

const storage = rs.hoisted(() => ({ get: rs.fn(), set: rs.fn() }));
rs.mock('@theaiplatform/miniapp-sdk/sdk', () => ({ sdk: { storage } }));

describe('reading preference persistence', () => {
  it('round-trips explicit opt-outs through the existing governed preferences store', async () => {
    const preferences = { ...defaultPreferences, htmlEnabled: false, scriptsEnabled: false };
    storage.get.mockResolvedValue({ revision: 7, value: null });
    storage.set.mockResolvedValue({ revision: 8 });
    await savePreferences(preferences);
    expect(storage.set).toHaveBeenCalledWith({
      namespace: 'tap-email', key: 'preferences/v1', expectedRevision: 7, value: preferences,
    });
    storage.get.mockResolvedValue({ revision: 8, value: preferences });
    expect(await loadPreferences(false)).toMatchObject({ htmlEnabled: false, scriptsEnabled: false });
  });

  it('remembers column sizes and discards malformed layout data', async () => {
    const preferences = { ...defaultPreferences, columnWidths: { sidebar: 260, threads: 570 }, sidebarCollapsed: true };
    storage.get.mockResolvedValue({ revision: 8, value: preferences });
    expect((await loadPreferences(false)).columnWidths).toEqual({ sidebar: 260, threads: 570 });
    expect((await loadPreferences(false)).sidebarCollapsed).toBe(true);
    await savePreferences(preferences);
    expect(storage.set).toHaveBeenLastCalledWith({ namespace: 'tap-email', key: 'preferences/v1', expectedRevision: 8, value: preferences });
    expect(normalizeMailPreferences({ ...preferences, columnWidths: { sidebar: NaN, threads: -1 } }).columnWidths).toBeUndefined();
  });
});
