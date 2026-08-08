import { readFileSync } from "node:fs";
import { describe, expect, it } from "@rstest/core";

interface Contribution {
  readonly kind: string;
  readonly id: string;
  readonly authorization?: { readonly allOf?: readonly string[] };
  readonly options?: Readonly<Record<string, unknown>>;
}

const manifest = JSON.parse(
  readFileSync(new URL("../manifest.tap.json", import.meta.url), "utf8"),
) as {
  readonly contributions: readonly Contribution[];
};
const joinInputSchema = JSON.parse(
  readFileSync(
    new URL("../schemas/remote-browser-join-session-input.json", import.meta.url),
    "utf8",
  ),
) as {
  readonly oneOf: readonly {
    readonly additionalProperties: boolean;
    readonly required: readonly string[];
    readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  }[];
};

const expectedTools = [
  ["remote-browser-start", "remote_browser_start", "browser.session.control"],
  ["remote-browser-navigate", "remote_browser_navigate", "browser.session.control"],
  ["remote-browser-snapshot", "remote_browser_snapshot", "browser.session.observe"],
  ["remote-browser-screenshot", "remote_browser_screenshot", "browser.session.observe"],
  ["remote-browser-select-element", "remote_browser_select_element", "browser.session.observe"],
  ["remote-browser-share-session", "remote_browser_share_session", "browser.session.control"],
  ["remote-browser-join-session", "remote_browser_join_session", "browser.session.observe"],
  ["remote-browser-room", "remote_browser_room", "browser.session.observe"],
  ["remote-browser-claim-control", "remote_browser_claim_control", "browser.session.control"],
  ["remote-browser-release-control", "remote_browser_release_control", "browser.session.control"],
  ["remote-browser-leave-session", "remote_browser_leave_session", "browser.session.observe"],
  ["remote-browser-network", "remote_browser_network", "browser.session.observe"],
  ["remote-browser-diagnostics", "remote_browser_diagnostics", "browser.session.observe"],
  ["remote-browser-click", "remote_browser_click", "browser.session.control"],
  ["remote-browser-fill", "remote_browser_fill", "browser.session.control"],
  ["remote-browser-scroll", "remote_browser_scroll", "browser.session.control"],
  ["remote-browser-close", "remote_browser_close", "browser.session.control"],
] as const;

describe("shared Remote Browser manifest", () => {
  it("requests an expanded first open only for the conversation surface", () => {
    const conversationSurface = manifest.contributions.find(
      (item) => item.kind === "ui.surface" && item.id === "agent-browser-prototype",
    );
    const workflowSurface = manifest.contributions.find(
      (item) => item.kind === "ui.surface" && item.id === "agent-browser-workflow",
    );

    expect(conversationSurface?.options).toMatchObject({
      placement: "chat-right",
      scope: "conversation",
      instancePolicy: "per-conversation",
      initialPanelMode: "expanded",
    });
    expect(workflowSurface?.options).not.toHaveProperty("initialPanelMode");
  });

  it("promotes every governed CDP-backed tool with its exact signed name and permission", () => {
    for (const [id, toolName, permission] of expectedTools) {
      const contribution = manifest.contributions.find((item) => item.id === id);
      expect(contribution).toMatchObject({
        kind: "mcp.tool",
        authorization: { allOf: [permission] },
        options: {
          serverContributionId: "remote-browser-tools",
          toolName,
        },
      });
      expect(contribution?.options?.inputSchema).toMatch(/^schemas\//u);
      expect(contribution?.options?.outputSchema).toMatch(/^schemas\//u);
    }
  });

  it("packages every browser tool for the UI, channel chat, specialists, and workflows", () => {
    const miniapp = manifest.contributions.find(
      (item) => item.kind === "miniapp" && item.id === "agent-browser-prototype-app",
    );
    const contributionIds = miniapp?.options?.contributionIds;
    expect(Array.isArray(contributionIds)).toBe(true);
    for (const [id] of expectedTools) expect(contributionIds).toContain(id);

    const server = manifest.contributions.find(
      (item) => item.kind === "mcp.server" && item.id === "remote-browser-tools",
    );
    expect(server?.options?.consumerPolicy).toEqual({
      contributionIds: ["agent-browser-prototype", "agent-browser-workflow"],
      externalConsumers: ["selected-specialists", "chat", "workflows"],
    });
  });

  it("delegates observe and control tools to specialists in channel scope", () => {
    const catalog = manifest.contributions.find(
      (item) =>
        item.kind === "permission.catalog" &&
        item.id === "agent-browser-prototype-permissions",
    );
    const actions = (catalog?.options?.actions ?? []) as readonly Readonly<
      Record<string, unknown>
    >[];
    for (const id of ["browser.session.observe", "browser.session.control"]) {
      const action = actions.find((candidate) => candidate.id === id);
      expect(action).toMatchObject({
        scopes: expect.arrayContaining(["channel"]),
        delegatedActors: expect.arrayContaining(["specialist"]),
      });
    }
  });

  it("declares the canonical RB1 join code without allowing mixed legacy input", () => {
    expect(joinInputSchema.oneOf).toHaveLength(2);
    const canonical = joinInputSchema.oneOf.find(
      ({ required }) => required.length === 1 && required[0] === "roomCode",
    );
    const legacy = joinInputSchema.oneOf.find(({ required }) =>
      required.includes("sessionHandle")
    );
    expect(canonical).toMatchObject({
      additionalProperties: false,
      properties: {
        roomCode: {
          pattern: "^RB1\\.[0-9A-Za-z_-]{22}\\.[0-9A-Za-z_-]{43}$",
        },
      },
    });
    expect(legacy).toMatchObject({
      additionalProperties: false,
      properties: {
        sessionHandle: { format: "uuid" },
        invitationToken: { pattern: "^[0-9A-Za-z_-]{43}$" },
      },
    });
    expect(canonical?.properties).not.toHaveProperty("sessionHandle");
    expect(legacy?.properties).not.toHaveProperty("roomCode");
  });
});
