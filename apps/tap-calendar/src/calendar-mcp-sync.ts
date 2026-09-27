import type { CalendarGatewayClient } from "./gateway";
import type { CalendarMcpConfiguration, CalendarMcpConfigurationSnapshot } from "./mcp-contract";

export class CalendarMcpSync {
  private snapshot: CalendarMcpConfigurationSnapshot | null = null;
  private established = false;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly gateway: Pick<CalendarGatewayClient, "readMcpConfiguration" | "saveMcpConfiguration">) {}
  sync(configuration: CalendarMcpConfiguration, replaceRemote = false): Promise<void> {
    const operation = this.queue.catch(() => {}).then(() => this.synchronize(configuration, replaceRemote));
    this.queue = operation; return operation;
  }
  private async synchronize(configuration: CalendarMcpConfiguration, replaceRemote: boolean) {
    if (!replaceRemote || !this.snapshot) {
      const remote = await this.gateway.readMcpConfiguration();
      if (this.snapshot && remote.revision !== this.snapshot.revision) this.established = false;
      this.snapshot = remote;
    }
    const same = JSON.stringify(this.snapshot.configuration) === JSON.stringify(configuration);
    if (same) { this.established = true; return; }
    if (this.snapshot.revision !== null && !this.established && !replaceRemote) throw new Error("Another device has different specialist settings. Review this device’s settings, then explicitly replace the shared settings if intended.");
    try {
      const receipt = await this.gateway.saveMcpConfiguration(this.snapshot.revision, configuration);
      this.snapshot = { revision: receipt.revision, configuration }; this.established = true;
    } catch (error) {
      // A lost response may have committed. Re-read and acknowledge exactly the
      // submitted configuration; never retry an overwrite with a fresh revision.
      this.snapshot = await this.gateway.readMcpConfiguration();
      if (JSON.stringify(this.snapshot.configuration) === JSON.stringify(configuration)) { this.established = true; return; }
      this.established = false; throw error;
    }
  }
}
