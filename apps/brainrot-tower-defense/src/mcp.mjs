import { defineMcpServer } from "@theaiplatform/miniapp-sdk/mcp";
import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import inputSchema from "../schemas/game-state-tool-input.json" with { type: "json" };
import { createGameStateReader } from "./mcp-state.mjs";

const getGameState = createGameStateReader({
  readStorage: (address) => sdk.storage.get(address),
  getExecutionContext: () => {
    if (!sdk.mcp) {
      throw new Error(
        "Brainrot Tower Defense requires package-runtime MCP execution context.",
      );
    }
    return sdk.mcp.getExecutionContext();
  },
});

export const mcpServer = defineMcpServer({
  tools: {
    get_game_state: {
      description:
        "Read the current Brainrot Tower Defense game's bounded authoritative channel projection, including level, wave, health, score, players, resources, defenders, enemies, recent actions, and explicit truncation totals.",
      inputSchema,
      execute: getGameState
    }
  }
});
