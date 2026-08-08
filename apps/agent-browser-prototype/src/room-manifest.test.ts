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

const expected = [
  ["remote-browser-share-session", "remote_browser_share_session", "browser.session.control"],
  ["remote-browser-join-session", "remote_browser_join_session", "browser.session.observe"],
  ["remote-browser-room", "remote_browser_room", "browser.session.observe"],
  ["remote-browser-claim-control", "remote_browser_claim_control", "browser.session.control"],
  ["remote-browser-release-control", "remote_browser_release_control", "browser.session.control"],
  ["remote-browser-leave-session", "remote_browser_leave_session", "browser.session.observe"],
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

  it("declares every real room tool with its exact signed name and permission", () => {
    for (const [id, toolName, permission] of expected) {
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

  it("packages every room tool for UI, specialists, and workflows", () => {
    const miniapp = manifest.contributions.find(
      (item) => item.kind === "miniapp" && item.id === "agent-browser-prototype-app",
    );
    const contributionIds = miniapp?.options?.contributionIds;
    expect(Array.isArray(contributionIds)).toBe(true);
    for (const [id] of expected) expect(contributionIds).toContain(id);

    const server = manifest.contributions.find(
      (item) => item.kind === "mcp.server" && item.id === "remote-browser-tools",
    );
    expect(server?.options?.consumerPolicy).toEqual({
      contributionIds: ["agent-browser-prototype", "agent-browser-workflow"],
      externalConsumers: ["selected-specialists", "workflows"],
    });
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
