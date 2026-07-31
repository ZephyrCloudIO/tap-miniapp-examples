import { describe, expect, it } from "@rstest/core";

import { requireJoinedWorkspace } from "./auth";
import type { RoadieApiEnv } from "./types";

function envWithPrincipal(context: unknown): RoadieApiEnv {
  return {
    DIRECTORY_API: {
      async getPrincipalContext() {
        return { context };
      },
    },
  } as unknown as RoadieApiEnv;
}

function principal(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "workspace-a",
    userId: "user-a",
    membershipId: "membership-a",
    userEmailId: "email-a",
    role: "WORKSPACE_ROLE_MEMBER",
    membershipEpoch: 1,
    roleEpoch: 1,
    directorySequence: 1,
    ...overrides,
  };
}

describe("Roadie workspace authorization", () => {
  it("accepts a joined principal only for the requested workspace and user", async () => {
    await expect(
      requireJoinedWorkspace(envWithPrincipal(principal()), "workspace-a", "user-a"),
    ).resolves.toMatchObject({ workspaceId: "workspace-a", userId: "user-a" });
  });

  it("rejects an absent membership context", async () => {
    await expect(
      requireJoinedWorkspace(envWithPrincipal(undefined), "workspace-a", "user-a"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a principal returned for another workspace", async () => {
    await expect(
      requireJoinedWorkspace(
        envWithPrincipal(principal({ workspaceId: "workspace-b" })),
        "workspace-a",
        "user-a",
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a principal returned for another user", async () => {
    await expect(
      requireJoinedWorkspace(
        envWithPrincipal(principal({ userId: "user-b" })),
        "workspace-a",
        "user-a",
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
