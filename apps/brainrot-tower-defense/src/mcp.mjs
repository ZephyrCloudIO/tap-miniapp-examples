import { defineMcpServer } from "@theaiplatform/miniapp-sdk/mcp";
import inputSchema from "../schemas/game-state-tool-input.json";
import { get_game_state as getGameState } from "./runtime.mjs";

const server = defineMcpServer({
  tools: {
    get_game_state: {
      description:
        "Read the selected Brainrot Tower Defense game's authoritative channel snapshot, including level, wave, health, score, players, resources, defenders, enemies, and recent actions.",
      inputSchema,
      execute: getGameState
    }
  }
});

export { server };
export default server;
