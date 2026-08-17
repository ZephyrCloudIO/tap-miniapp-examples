import { describe, expect, it, rs } from "@rstest/core";
import {
  channelInviteCandidates,
  channelParticipantsCapability,
  loadChannelParticipants,
} from "./channel-participants";

describe("channel participant capability", () => {
  it("fails feature detection honestly when the host has no roster API", () => {
    expect(channelParticipantsCapability({ list: rs.fn() })).toBeNull();
    expect(channelParticipantsCapability(null)).toBeNull();
  });

  it("loads only the exact trusted host result without selecting anyone", async () => {
    const getParticipants = rs.fn(async () => ({
      participants: [
        {
          id: "user-zane",
          displayName: " Zane Doe ",
          email: "ZANE@EXAMPLE.COM ",
          avatarUrl: null,
          kind: "human" as const,
        },
        {
          id: "user-ada",
          displayName: "Ada Lovelace",
          email: null,
          avatarUrl: " https://example.test/ada.png ",
          kind: "human" as const,
        },
      ],
    }));
    const capability = channelParticipantsCapability({ getParticipants });

    await expect(loadChannelParticipants(capability!, "channel-1")).resolves.toEqual([
      {
        id: "user-ada",
        displayName: "Ada Lovelace",
        email: null,
        avatarUrl: "https://example.test/ada.png",
        kind: "human",
      },
      {
        id: "user-zane",
        displayName: "Zane Doe",
        email: "zane@example.com",
        avatarUrl: null,
        kind: "human",
      },
    ]);
    expect(getParticipants).toHaveBeenCalledWith({ channelId: "channel-1" });
  });

  it("prefers the official SDK method even when a compatibility origin is present", async () => {
    const getParticipants = rs.fn(async () => ({ participants: [] }));
    const capability = channelParticipantsCapability(
      { getParticipants },
      "not-a-host-origin",
    );

    await expect(capability!.getParticipants({ channelId: "channel-1" }))
      .resolves.toEqual({ participants: [] });
    expect(getParticipants).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed or non-human roster rows instead of inventing attendees", async () => {
    await expect(loadChannelParticipants(
      {
        getParticipants: async () => ({
          participants: [{
            id: "bot-1",
            displayName: "Calendar Bot",
            email: "bot@example.test",
            avatarUrl: null,
            kind: "bot",
          }] as never,
        }),
      },
      "channel-1",
    )).rejects.toThrow("invalid channel participant roster");
  });

  it("excludes the organizer without preselecting or synthesizing invitees", () => {
    const participants = [
      {
        id: "organizer-1",
        displayName: "Organizer",
        email: "organizer@example.test",
        avatarUrl: null,
        kind: "human" as const,
      },
      {
        id: "guest-1",
        displayName: "Guest",
        email: "guest@example.test",
        avatarUrl: null,
        kind: "human" as const,
      },
    ];
    expect(channelInviteCandidates(participants, "organizer-1")).toEqual([
      participants[1],
    ]);
    expect(channelInviteCandidates(participants, undefined)).toBe(participants);
  });
});
