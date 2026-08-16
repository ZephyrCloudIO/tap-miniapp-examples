import { describe, expect, it } from "@rstest/core";

import { getPrincipalContextResponseSchema, listMembersResponseSchema } from "./directory-boundary";

describe("TAP directory boundary", () => {
  it("accepts a joined workspace principal", () => {
    const response = getPrincipalContextResponseSchema.parse({
      context: {
        workspaceId: "workspace-1",
        userId: "user-1",
        membershipId: "membership-1",
        userEmailId: "email-1",
        role: "WORKSPACE_ROLE_MEMBER",
        membershipEpoch: 1,
        roleEpoch: 1,
        directorySequence: 1,
      },
    });

    expect(response.context?.userId).toBe("user-1");
  });

  it("rejects a roster with an unknown role", () => {
    expect(() =>
      listMembersResponseSchema.parse({
        members: [
          {
            membership: {
              membershipId: "membership-1",
              workspaceId: "workspace-1",
              userId: "user-1",
              invitedEmail: "person@example.com",
              status: "WORKSPACE_MEMBERSHIP_STATUS_JOINED",
              role: "WORKSPACE_ROLE_UNKNOWN",
              invitedAt: 1,
              membershipEpoch: 1,
              roleEpoch: 1,
              inviteEpoch: 1,
            },
          },
        ],
      }),
    ).toThrow();
  });
});
