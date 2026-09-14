import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createRemoteBrowserMcpHandler } from "../src/mcp";
import type { RemoteBrowserMcpProps } from "../src/oauth";

const authProps: RemoteBrowserMcpProps = {
  userId: "zack@zephyr-cloud.io",
  scopes: ["remote-browser"],
  owner: {
    actorId: "zack@zephyr-cloud.io",
    workspaceId: "kitesurf-test",
    packageId: "tap_pkg_examples_agent_browser_prototype_0001",
    installationId: "local-custom-miniapp",
    contributionId: "remote-browser-tools",
  },
};

function mcpRequest(body: Readonly<Record<string, unknown>>): Request {
  return new Request("http://127.0.0.1:8787/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      Host: "127.0.0.1:8787",
    },
    body: JSON.stringify(body),
  });
}

async function mcpCall(
  body: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
  const handler = createRemoteBrowserMcpHandler(env, authProps);
  const response = await handler.fetch(mcpRequest(body));
  const text = await response.text();
  expect(response.status, text).toBe(200);
  if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
    const data = text
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice("data: ".length);
    if (!data) throw new Error("MCP response omitted an SSE data record.");
    return JSON.parse(data) as Readonly<Record<string, unknown>>;
  }
  return JSON.parse(text) as Readonly<Record<string, unknown>>;
}

describe("Remote Browser Streamable HTTP MCP", () => {
  it("initializes through the current stateless transport", async () => {
    const response = await mcpCall({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "remote-browser-contract-test", version: "1.0.0" },
      },
    });

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-11-25",
        serverInfo: { name: "TAP Remote Browser", version: "0.3.0" },
        capabilities: { tools: {} },
      },
    });
  });

  it("advertises exactly the governed semantic browser tools", async () => {
    const response = await mcpCall({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const result = response.result;
    expect(result).toBeTypeOf("object");
    const tools = Reflect.get(result as object, "tools") as readonly Readonly<
      Record<string, unknown>
    >[];
    expect(tools.map((tool) => tool.name)).toEqual([
      "remote_browser_start",
      "remote_browser_share_session",
      "remote_browser_join_session",
      "remote_browser_room",
      "remote_browser_claim_control",
      "remote_browser_release_control",
      "remote_browser_leave_session",
      "remote_browser_navigate",
      "remote_browser_snapshot",
      "remote_browser_screenshot",
      "remote_browser_select_element",
      "remote_browser_network",
      "remote_browser_diagnostics",
      "remote_browser_click",
      "remote_browser_fill",
      "remote_browser_scroll",
      "remote_browser_close",
    ]);

    const serialized = JSON.stringify(
      tools.map((tool) => ({
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
      })),
    );
    expect(serialized).not.toMatch(/"x"\s*:/u);
    expect(serialized).not.toMatch(/"y"\s*:/u);
    expect(serialized).not.toContain("execute_cdp");
    expect(serialized).not.toContain("sessionToken");
    expect(serialized).not.toContain("backendNodeId");
    expect(serialized).not.toContain("headers");
    expect(serialized).not.toContain("responseBody");
    expect(serialized).toContain("expectedControlEpoch");
    expect(serialized).toContain("expectedDocumentRevision");

    const selectElement = tools.find(
      (tool) => tool.name === "remote_browser_select_element",
    );
    expect(selectElement).toBeDefined();
    const selectInput = JSON.stringify(selectElement?.inputSchema);
    expect(selectInput).not.toMatch(/"selector"\s*:/u);
    expect(selectInput).toContain("elementRef");
    expect(selectInput).toContain("xRatio");
    expect(selectInput).toContain("yRatio");
    expect(selectInput).toContain("selector");
    expect(selectInput).toContain("html");
    expect(selectInput).toContain("png");

    const joinSession = tools.find(
      (tool) => tool.name === "remote_browser_join_session",
    );
    expect(joinSession).toBeDefined();
    const joinInput = JSON.stringify(joinSession?.inputSchema);
    expect(joinInput).toContain("roomCode");
    expect(joinInput).toContain("RB1");
    expect(joinInput).toContain("sessionHandle");
    expect(joinInput).toContain("invitationToken");
  });
});
