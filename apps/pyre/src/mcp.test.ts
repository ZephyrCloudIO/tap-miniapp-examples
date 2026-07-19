import { describe, expect, it } from "@rstest/core";
import { pyreMcpServer } from "./mcp";

describe("Pyre MCP server", () => {
  it("declares the bounded read-only investigation tools", () => {
    expect(Object.keys(pyreMcpServer.tools).toSorted()).toEqual(["get_investigation", "list_investigations"]);
    expect(pyreMcpServer.tools.get_investigation.inputSchema).toMatchObject({
      additionalProperties: false,
      required: ["investigationId"],
    });
  });
});
