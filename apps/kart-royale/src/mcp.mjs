import { defineMcpServer } from "@theaiplatform/miniapp-sdk/mcp";
import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import inputSchema from "../schemas/race-state-tool-input.json" with { type: "json" };
import { createRaceStateReader } from "./mcp-state.mjs";

const getRaceState = createRaceStateReader({
  readStorage: (address) => sdk.storage.get(address),
  getExecutionContext: () => {
    if (!sdk.mcp) {
      throw new Error("Kart Royale requires package-runtime MCP execution context.");
    }
    return sdk.mcp.getExecutionContext();
  },
});

export const mcpServer = defineMcpServer({
  tools: {
    get_race_state: {
      description:
        "Read the current Kart Royale race projection for this channel: phase, lobby roster, live standings, and truncation totals, for the trusted execution-context user.",
      inputSchema,
      execute: getRaceState,
    },
  },
});
