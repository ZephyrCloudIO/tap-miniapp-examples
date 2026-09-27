import { describe, expect, it } from '@rstest/core';
import { CalendarMcpSync } from './calendar-mcp-sync';
import type { CalendarMcpConfiguration, CalendarMcpConfigurationSnapshot } from './mcp-contract';

const original: CalendarMcpConfiguration = { conflictCalendarIds: ['desktop'], eventTypes: [] };
const mobile: CalendarMcpConfiguration = { conflictCalendarIds: ['phone'], eventTypes: [] };
function fixture() {
  let remote: CalendarMcpConfigurationSnapshot = { revision: 40, configuration: original };
  let writes = 0;
  let loseResponse = false;
  return {
    get writes() { return writes; }, get remote() { return remote; },
    change(value: CalendarMcpConfigurationSnapshot) { remote = value; },
    loseResponse() { loseResponse = true; },
    gateway: {
      readMcpConfiguration: async () => remote,
      async saveMcpConfiguration(expectedRevision: number | null, configuration: CalendarMcpConfiguration) {
        if (expectedRevision !== remote.revision) throw new Error('configuration conflict');
        writes++; const revision = (remote.revision ?? 0) + 1; remote = { revision, configuration };
        if (loseResponse) { loseResponse = false; throw new Error('connection lost'); }
        return { saved: true as const, revision };
      },
    },
  };
}
describe('cross-device MCP configuration', () => {
  it('requires explicit replacement before a new phone can change desktop settings', async () => {
    const test = fixture(); const sync = new CalendarMcpSync(test.gateway);
    await expect(sync.sync(mobile)).rejects.toThrow('Another device');
    expect(test.writes).toBe(0);
    await sync.sync(mobile, true);
    expect(test.remote).toEqual({ revision: 41, configuration: mobile });
  });
  it('does not retry a conflict as an unconditional overwrite', async () => {
    const test = fixture(); const sync = new CalendarMcpSync(test.gateway);
    await sync.sync(original);
    test.change({ revision: 41, configuration: { ...original, conflictCalendarIds: ['new-desktop'] } });
    await expect(sync.sync(mobile)).rejects.toThrow('Another device');
    await expect(sync.sync(mobile)).rejects.toThrow('Another device');
    expect(test.writes).toBe(0);
  });
  it('reconciles a lost receipt without writing the same settings twice', async () => {
    const test = fixture(); const sync = new CalendarMcpSync(test.gateway);
    await sync.sync(original); test.loseResponse(); await sync.sync(mobile);
    await sync.sync(mobile); expect(test.writes).toBe(1);
  });
  it('rejects an explicit replacement if the remote changed after the conflict was shown', async () => {
    const test = fixture(); const sync = new CalendarMcpSync(test.gateway);
    await expect(sync.sync(mobile)).rejects.toThrow('Another device');
    test.change({ revision: 41, configuration: { ...original, conflictCalendarIds: ['new-desktop'] } });
    await expect(sync.sync(mobile, true)).rejects.toThrow('configuration conflict');
    expect(test.writes).toBe(0);
  });
});
