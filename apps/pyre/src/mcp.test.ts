import { describe, expect, it } from "@rstest/core";
import { emptyState } from "./domain";
import { createPyreMcpServer, pyreMcpServer } from "./mcp";

describe("Pyre MCP server", () => {
  it("declares the bounded read-only investigation tools", () => {
    expect(Object.keys(pyreMcpServer.tools).toSorted()).toEqual(["get_investigation", "list_investigations"]);
    expect(pyreMcpServer.tools.get_investigation.inputSchema).toMatchObject({
      additionalProperties: false,
      required: ["investigationId"],
    });
  });

  it("lists deterministic workspace state through an injected storage boundary", async () => {
    const server = createPyreMcpServer(async () => ({
      state: emptyState(),
      revision: 7,
    }));

    await expect(
      server.tools.list_investigations.execute(),
    ).resolves.toEqual({
      activeId: null,
      investigations: [],
    });
  });

  it("returns an explicit miss without inventing an investigation", async () => {
    const server = createPyreMcpServer(async () => ({
      state: emptyState(),
      revision: 7,
    }));

    await expect(
      server.tools.get_investigation.execute({
        investigationId: "inc_missing",
      }),
    ).resolves.toEqual({
      found: false,
      investigationId: "inc_missing",
    });
  });
});
