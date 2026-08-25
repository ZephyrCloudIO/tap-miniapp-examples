import { describe, expect, it, rs } from "@rstest/core";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoomHeaderControls, wheelDeltaPixels } from "./app";
import type { RemoteBrowserRoomState } from "./remote-browser-mcp";

const SESSION = "8f508329-5217-4be2-a605-b80bc12350c6";
const SELF = `rp_${"a".repeat(64)}`;
const CHLOE = `rp_${"b".repeat(64)}`;
const VIEWER = `rp_${"c".repeat(64)}`;

function room(selfCreator: boolean, selfControls: boolean): RemoteBrowserRoomState {
  return {
    sessionHandle: SESSION,
    state: "active",
    documentRevision: 7,
    control: {
      holder: selfControls ? "human" : "agent",
      participantId: selfControls ? SELF : CHLOE,
      epoch: 4,
      expiresAt: selfControls ? null : "2026-08-07T09:03:00.000Z",
    },
    participants: [
      {
        participantId: SELF,
        kind: "human",
        principalId: "zack@zephyr-cloud.io",
        consumerKind: "package-contribution",
        status: "connected",
        creator: selfCreator,
        self: true,
        joinedAt: "2026-08-07T09:00:00.000Z",
        lastSeenAt: "2026-08-07T09:01:00.000Z",
        disconnectedAt: null,
      },
      {
        participantId: VIEWER,
        kind: "human",
        principalId: "zack@zephyr-cloud.io",
        consumerKind: "package-contribution",
        status: "connected",
        creator: false,
        self: false,
        joinedAt: "2026-08-07T09:00:30.000Z",
        lastSeenAt: "2026-08-07T09:01:00.000Z",
        disconnectedAt: null,
      },
      {
        participantId: CHLOE,
        kind: "agent",
        principalId: "chloe",
        consumerKind: "specialist",
        status: "connected",
        creator: !selfCreator,
        self: false,
        joinedAt: "2026-08-07T08:59:00.000Z",
        lastSeenAt: "2026-08-07T09:01:00.000Z",
        disconnectedAt: null,
      },
    ],
  };
}

function model(activeRoom: RemoteBrowserRoomState | null, joined = false) {
  return {
    experience: "live" as const,
    session: activeRoom
      ? {
          sessionHandle: SESSION,
          requestedUrl: "Shared Remote Browser room",
          expiresAt: null,
          frameUrl: null,
          frameWidth: null,
          frameHeight: null,
          room: activeRoom,
          snapshot: {
            control: activeRoom.control,
            documentRevision: activeRoom.documentRevision,
            visibleOrigin: "Shared room",
          },
          connectionState: "connected" as const,
        }
      : null,
    roomInvitation: joined
      ? null
      : {
          code: "RB1.j1CDKVIXS-KmBbgLwSNQxg.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdef",
          expiresAt: "2026-08-07T09:05:00.000Z",
          remainingUses: 2,
        },
    joinRoomCode: "",
    setJoinRoomCode: rs.fn(),
    busy: "" as const,
    joinSession: rs.fn(),
    shareSession: rs.fn(),
    claimRoomControl: rs.fn(),
    releaseRoomControl: rs.fn(),
  } satisfies Parameters<typeof RoomHeaderControls>[0]["model"];
}

describe("shared room header controls", () => {
  it("keeps Room code and Join compact on the live header before a session", () => {
    const markup = renderToStaticMarkup(
      <RoomHeaderControls model={model(null)} />,
    );

    expect(markup).toContain('aria-label="Room code"');
    expect(markup).toContain("Join");
  });

  it("shows actual observers, current controller, and owner sharing", () => {
    const markup = renderToStaticMarkup(
      <RoomHeaderControls model={model(room(true, true))} />,
    );

    expect(markup).toContain("3</strong> viewing");
    expect(markup).toContain('aria-label="Connected participants (3)"');
    expect(markup).toContain("You · App 1");
    expect(markup).toContain("Human · App 2");
    expect(markup).toContain("chloe");
    expect(markup).toContain(
      "Controller <strong>You · App 1</strong>",
    );
    expect(markup).toContain("Share");
    expect(markup).toContain("Release");
    expect(markup).toContain('aria-label="Shareable room code"');
    expect(markup).not.toContain("Take control");
  });

  it("shows Chloe as controller and lets a joined observer take control", () => {
    const markup = renderToStaticMarkup(
      <RoomHeaderControls model={model(room(false, false), true)} />,
    );

    expect(markup).toContain("Controller <strong>chloe</strong>");
    expect(markup).toContain("Take control");
    expect(markup).not.toContain(">Share<");
  });
});

describe("live viewport wheel normalization", () => {
  it("normalizes pixel, line, and page deltas while bounding bursts", () => {
    expect(wheelDeltaPixels(12.5, 0, 800)).toBe(12.5);
    expect(wheelDeltaPixels(3, 1, 800)).toBe(72);
    expect(wheelDeltaPixels(-1, 2, 800)).toBe(-800);
    expect(wheelDeltaPixels(10, 2, 800)).toBe(2_400);
    expect(wheelDeltaPixels(Number.NaN, 0, 800)).toBe(0);
  });
});
