import { describe, expect, it, rs } from "@rstest/core";
import {
  createRemoteBrowserMcpClient,
  type CallDeclaredMcpTool,
  type DeclaredMcpToolResult,
  type MiniAppJsonValue,
} from "./remote-browser-mcp";
import { encodeRemoteBrowserRoomCode } from "./room-code";

const SESSION = "8f508329-5217-4be2-a605-b80bc12350c6";
const SELF_PARTICIPANT = `rp_${"a".repeat(64)}`;
const CHLOE_PARTICIPANT = `rp_${"b".repeat(64)}`;
const INVITATION_TOKEN = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdef";
const ROOM_CODE = encodeRemoteBrowserRoomCode({
  sessionHandle: SESSION,
  invitationToken: INVITATION_TOKEN,
});
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function toolResult(
  structuredContent: MiniAppJsonValue,
  content: DeclaredMcpToolResult["content"] = [],
): DeclaredMcpToolResult {
  return { content, structuredContent };
}

const common = {
  sessionHandle: SESSION,
  documentRevision: 4,
  control: {
    holder: "agent",
    participantId: CHLOE_PARTICIPANT,
    epoch: 3,
    expiresAt: null,
  },
  telemetryCoverageStartedAt: "2026-08-07T09:00:00.000Z",
} as const;

describe("declared Remote Browser MCP transport", () => {
  it("calls only the signed contribution ids and validates real session output", async () => {
    const call = rs.fn<CallDeclaredMcpTool>(async (request) => {
      expect(request).toEqual({
        toolContributionId: "remote-browser-start",
        input: {
          url: "https://example.com/",
          keepAliveMs: 600_000,
          viewport: {
            width: 390,
            height: 844,
            deviceScaleFactor: 2,
            mobile: true,
          },
        },
      });
      return toolResult({
        ...common,
        url: "https://example.com/",
        title: "Example",
        expiresAt: "2026-08-07T09:10:00.000Z",
      });
    });

    const started = await createRemoteBrowserMcpClient(call).start({
      url: "https://example.com/",
      keepAliveMs: 600_000,
      viewport: {
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true,
      },
    });

    expect(started).toMatchObject({
      sessionHandle: SESSION,
      url: "https://example.com/",
      title: "Example",
      documentRevision: 4,
      control: { holder: "agent", epoch: 3 },
    });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("preserves and verifies the native MCP screenshot image block", async () => {
    const call = rs.fn<CallDeclaredMcpTool>(async () =>
      toolResult(
        { ...common, mediaType: "image/png", byteLength: 68 },
        [{ type: "image", data: PNG, mimeType: "image/png" }],
      ),
    );

    const screenshot = await createRemoteBrowserMcpClient(call).screenshot(SESSION);

    expect(call).toHaveBeenCalledWith({
      toolContributionId: "remote-browser-screenshot",
      input: { sessionHandle: SESSION },
    });
    expect(screenshot.pngData.slice(0, 8)).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(screenshot.pngDataUrl).toBe(`data:image/png;base64,${PNG}`);
    expect(screenshot.pngDataUrl).not.toMatch(/^blob:/u);
    expect(screenshot).toMatchObject({ byteLength: 68, width: 1, height: 1 });
  });

  it("selects the clicked coordinate as selector, HTML, or element PNG", async () => {
    const scenarios = [
      {
        representation: "selector" as const,
        output: {
          ...common,
          elementRef: "el_document_4_1",
          representation: "selector",
          selector: "html:nth-of-type(1) > button:nth-of-type(2)",
          html: null,
          mediaType: null,
          byteLength: null,
        },
        content: [],
      },
      {
        representation: "html" as const,
        output: {
          ...common,
          elementRef: "el_document_4_2",
          representation: "html",
          selector: null,
          html: "<button>Continue</button>",
          mediaType: null,
          byteLength: null,
        },
        content: [],
      },
      {
        representation: "png" as const,
        output: {
          ...common,
          elementRef: "el_document_4_3",
          representation: "png",
          selector: null,
          html: null,
          mediaType: "image/png",
          byteLength: 68,
        },
        content: [{ type: "image", data: PNG, mimeType: "image/png" }] as const,
      },
    ];

    for (const scenario of scenarios) {
      const call = rs.fn<CallDeclaredMcpTool>(async () =>
        toolResult(scenario.output, scenario.content),
      );
      const selected = await createRemoteBrowserMcpClient(call).selectElement({
        sessionHandle: SESSION,
        point: { xRatio: 0.25, yRatio: 0.75 },
        representation: scenario.representation,
        expectedControlEpoch: 3,
        expectedDocumentRevision: 4,
      });

      expect(call).toHaveBeenCalledWith({
        toolContributionId: "remote-browser-select-element",
        input: {
          sessionHandle: SESSION,
          xRatio: 0.25,
          yRatio: 0.75,
          representation: scenario.representation,
          expectedControlEpoch: 3,
          expectedDocumentRevision: 4,
        },
      });
      expect(selected.representation).toBe(scenario.representation);
      expect(selected.pngData === null).toBe(scenario.representation !== "png");
      expect(selected.pngDataUrl).toBe(
        scenario.representation === "png"
          ? `data:image/png;base64,${PNG}`
          : null,
      );
      expect(selected.pngDataUrl?.startsWith("blob:") ?? false).toBe(false);
    }
  });

  it("sends bounded normalized wheel input through the signed scroll contribution", async () => {
    const call = rs.fn<CallDeclaredMcpTool>(async () =>
      toolResult({
        ...common,
        url: "https://example.com/",
        title: "Example",
      }),
    );

    await createRemoteBrowserMcpClient(call).scroll({
      sessionHandle: SESSION,
      point: { xRatio: 0.25, yRatio: 0.75 },
      deltaX: 8,
      deltaY: 320,
      expectedControlEpoch: 3,
      expectedDocumentRevision: 4,
    });

    expect(call).toHaveBeenCalledWith({
      toolContributionId: "remote-browser-scroll",
      input: {
        sessionHandle: SESSION,
        xRatio: 0.25,
        yRatio: 0.75,
        deltaX: 8,
        deltaY: 320,
        expectedControlEpoch: 3,
        expectedDocumentRevision: 4,
      },
    });
  });

  it("rejects stale documents and image bytes that do not match metadata", async () => {
    const staleCall = rs.fn<CallDeclaredMcpTool>(async () =>
      toolResult({
        ...common,
        documentRevision: 5,
        elementRef: "el_document_5_1",
        representation: "selector",
        selector: "html:nth-of-type(1)",
        html: null,
        mediaType: null,
        byteLength: null,
      }),
    );
    await expect(
      createRemoteBrowserMcpClient(staleCall).selectElement({
        sessionHandle: SESSION,
        point: { xRatio: 0.5, yRatio: 0.5 },
        representation: "selector",
        expectedControlEpoch: 3,
        expectedDocumentRevision: 4,
      }),
    ).rejects.toThrow(/stale browser document/u);

    const mismatchedPng = rs.fn<CallDeclaredMcpTool>(async () =>
      toolResult(
        { ...common, mediaType: "image/png", byteLength: 69 },
        [{ type: "image", data: PNG, mimeType: "image/png" }],
      ),
    );
    await expect(
      createRemoteBrowserMcpClient(mismatchedPng).screenshot(SESSION),
    ).rejects.toThrow(/mismatched size metadata/u);
  });

  it("closes only the expected opaque session", async () => {
    const call = rs.fn<CallDeclaredMcpTool>(async () =>
      toolResult({ sessionHandle: SESSION, state: "closed" }),
    );

    await expect(createRemoteBrowserMcpClient(call).close(SESSION)).resolves.toEqual({
      sessionHandle: SESSION,
      state: "closed",
    });
    expect(call).toHaveBeenCalledWith({
      toolContributionId: "remote-browser-close",
      input: { sessionHandle: SESSION },
    });
  });

  it("shares one compact invitation and joins the exact room session", async () => {
    const room: MiniAppJsonValue = {
      sessionHandle: SESSION,
      state: "active",
      documentRevision: 4,
      control: common.control,
      participants: [
        {
          participantId: SELF_PARTICIPANT,
          kind: "human",
          principalId: "user_zack",
          consumerKind: "package-contribution",
          status: "connected",
          creator: false,
          self: true,
          joinedAt: "2026-08-07T09:00:00.000Z",
          lastSeenAt: "2026-08-07T09:01:00.000Z",
          disconnectedAt: null,
        },
        {
          participantId: CHLOE_PARTICIPANT,
          kind: "agent",
          principalId: "chloe",
          consumerKind: "specialist",
          status: "connected",
          creator: true,
          self: false,
          joinedAt: "2026-08-07T08:59:00.000Z",
          lastSeenAt: "2026-08-07T09:01:00.000Z",
          disconnectedAt: null,
        },
      ],
    };
    const call = rs.fn<CallDeclaredMcpTool>(async ({ toolContributionId }) => {
      if (toolContributionId === "remote-browser-share-session") {
        return toolResult({
          sessionHandle: SESSION,
          invitationToken: INVITATION_TOKEN,
          invitationExpiresAt: "2026-08-07T09:05:00.000Z",
          remainingUses: 2,
        });
      }
      return toolResult(room);
    });
    const client = createRemoteBrowserMcpClient(call);

    await expect(client.share(SESSION)).resolves.toEqual({
      sessionHandle: SESSION,
      invitationToken: INVITATION_TOKEN,
      invitationExpiresAt: "2026-08-07T09:05:00.000Z",
      remainingUses: 2,
    });
    await expect(
      client.join({ sessionHandle: SESSION, invitationToken: INVITATION_TOKEN }),
    ).resolves.toMatchObject({
      sessionHandle: SESSION,
      state: "active",
      participants: [{ self: true }, { principalId: "chloe" }],
    });
    await expect(client.join({ sessionHandle: SESSION })).resolves.toMatchObject({
      sessionHandle: SESSION,
      state: "active",
    });
    await expect(client.room(SESSION)).resolves.toMatchObject({
      control: { participantId: CHLOE_PARTICIPANT, epoch: 3 },
    });
    expect(call).toHaveBeenNthCalledWith(1, {
      toolContributionId: "remote-browser-share-session",
      input: { sessionHandle: SESSION },
    });
    expect(call).toHaveBeenNthCalledWith(2, {
      toolContributionId: "remote-browser-join-session",
      input: { roomCode: ROOM_CODE },
    });
    expect(call).toHaveBeenNthCalledWith(3, {
      toolContributionId: "remote-browser-join-session",
      input: { sessionHandle: SESSION },
    });
    expect(call).toHaveBeenNthCalledWith(4, {
      toolContributionId: "remote-browser-room",
      input: { sessionHandle: SESSION },
    });
  });

  it("claims, releases, and leaves room control with epoch fencing", async () => {
    const claimedControl = {
      holder: "human",
      participantId: SELF_PARTICIPANT,
      epoch: 4,
      expiresAt: "2026-08-07T09:03:00.000Z",
    } as const;
    const releasedControl = {
      holder: "human",
      participantId: null,
      epoch: 5,
      expiresAt: null,
    } as const;
    const call = rs.fn<CallDeclaredMcpTool>(async ({ toolContributionId }) => {
      if (toolContributionId === "remote-browser-claim-control") {
        return toolResult({ sessionHandle: SESSION, control: claimedControl });
      }
      if (toolContributionId === "remote-browser-release-control") {
        return toolResult({ sessionHandle: SESSION, control: releasedControl });
      }
      return toolResult({
        sessionHandle: SESSION,
        participantId: SELF_PARTICIPANT,
        status: "disconnected",
        control: releasedControl,
      });
    });
    const client = createRemoteBrowserMcpClient(call);

    await expect(
      client.claimControl({
        sessionHandle: SESSION,
        expectedControlEpoch: 3,
        leaseMs: 120_000,
      }),
    ).resolves.toEqual({ sessionHandle: SESSION, control: claimedControl });
    await expect(
      client.releaseControl({ sessionHandle: SESSION, expectedControlEpoch: 4 }),
    ).resolves.toEqual({ sessionHandle: SESSION, control: releasedControl });
    await expect(client.leave(SESSION)).resolves.toEqual({
      sessionHandle: SESSION,
      participantId: SELF_PARTICIPANT,
      status: "disconnected",
      control: releasedControl,
    });
    expect(call).toHaveBeenNthCalledWith(1, {
      toolContributionId: "remote-browser-claim-control",
      input: {
        sessionHandle: SESSION,
        expectedControlEpoch: 3,
        leaseMs: 120_000,
      },
    });
    expect(call).toHaveBeenNthCalledWith(2, {
      toolContributionId: "remote-browser-release-control",
      input: { sessionHandle: SESSION, expectedControlEpoch: 4 },
    });
    expect(call).toHaveBeenNthCalledWith(3, {
      toolContributionId: "remote-browser-leave-session",
      input: { sessionHandle: SESSION },
    });
  });
});
