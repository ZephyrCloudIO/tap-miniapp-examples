import { describe, expect, it, rstest as rs } from '@rstest/core';
import { defaultPreferences } from './domain';
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
});
