import type {
  MiniAppHttpApi,
  MiniAppHttpRequestInput,
  MiniAppHttpRequestOptions,
} from "@theaiplatform/miniapp-sdk";
import { describe, expect, it } from "@rstest/core";

import { getWorkspaceContext, ROADIE_API_ORIGIN } from "./roadie-api";

describe("Roadie service client", () => {
  it("uses host-managed TAP authentication and validates the response", async () => {
    const calls: Array<{
      input: MiniAppHttpRequestInput;
      options: MiniAppHttpRequestOptions | undefined;
    }> = [];
    const http: MiniAppHttpApi = {
      request: (input, options) => {
        calls.push({ input, options });
        return {
          finalUrl: `${ROADIE_API_ORIGIN}/rpc/tap.roadie.v1.RoadieService/GetWorkspaceContext`,
          status: 200,
          statusText: "OK",
          headers: [],
          bodyText: JSON.stringify({
            workspaceId: "workspace-1",
            currentMember: {
              userId: "user-1",
              displayName: "Debbie",
              role: "ROADIE_WORKSPACE_ROLE_MEMBER",
            },
            members: [
              {
                userId: "user-1",
                displayName: "Debbie",
                role: "ROADIE_WORKSPACE_ROLE_MEMBER",
              },
              {
                userId: "user-2",
                displayName: "Chloe",
                role: "ROADIE_WORKSPACE_ROLE_MEMBER",
              },
            ],
          }),
          bodyBase64: null,
          bodyKind: "text",
          bodyTruncated: false,
          sizeBytes: 1,
          elapsedMs: 1,
          contentType: "application/json",
        };
      },
    };

    const result = await getWorkspaceContext(http, "workspace-1");

    expect(result.members).toHaveLength(2);
    expect(calls[0]?.options).toEqual({
      credentialRef: "platform-session",
    });
    expect(calls[0]?.input.url).toBe(
      `${ROADIE_API_ORIGIN}/rpc/tap.roadie.v1.RoadieService/GetWorkspaceContext`,
    );
  });

  it("rejects malformed service responses", async () => {
    const http: MiniAppHttpApi = {
      request: () => ({
        finalUrl: ROADIE_API_ORIGIN,
        status: 200,
        statusText: "OK",
        headers: [],
        bodyText: '{"workspaceId":"workspace-1","members":"wrong"}',
        bodyBase64: null,
        bodyKind: "text",
        bodyTruncated: false,
        sizeBytes: 1,
        elapsedMs: 1,
        contentType: "application/json",
      }),
    };

    await expect(getWorkspaceContext(http, "workspace-1")).rejects.toThrow();
  });
});
