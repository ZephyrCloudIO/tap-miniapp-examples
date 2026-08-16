import type {
  MiniAppHttpApi,
  MiniAppHttpRequestInput,
  MiniAppHttpRequestOptions,
} from "@theaiplatform/miniapp-sdk";
import { describe, expect, it } from "@rstest/core";
import { definePlatformSessionBackend } from "@theaiplatform/miniapp-sdk/auth";
import { ROADIE_PLATFORM_SESSION_BACKEND } from "@tap-examples/roadie-contract/platform-session";

import type { Trip } from "./domain";
import {
  getWorkspaceContext,
  listWorkspaceTrips,
  ROADIE_API_ORIGIN,
  toServiceTrip,
} from "./roadie-api";

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
      credentialRef: definePlatformSessionBackend(
        ROADIE_PLATFORM_SESSION_BACKEND,
      ).credentialRef,
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

  it("keeps workspace switches explicit at the service boundary", async () => {
    const requestBodies: unknown[] = [];
    const http: MiniAppHttpApi = {
      request: (input) => {
        requestBodies.push(JSON.parse(input.body ?? "null") as unknown);
        return {
          finalUrl: input.url,
          status: 200,
          statusText: "OK",
          headers: [],
          bodyText: '{"trips":[]}',
          bodyBase64: null,
          bodyKind: "text",
          bodyTruncated: false,
          sizeBytes: 12,
          elapsedMs: 1,
          contentType: "application/json",
        };
      },
    };

    await listWorkspaceTrips(http, "workspace-a");
    await listWorkspaceTrips(http, "workspace-b");

    expect(requestBodies).toEqual([
      { workspaceId: "workspace-a" },
      { workspaceId: "workspace-b" },
    ]);
  });

  it("maps complete trips across the protobuf JSON boundary", async () => {
    const trip: Trip = {
      id: "trip-1",
      title: "React Summit",
      purpose: "conference",
      location: "Amsterdam",
      timeline: [
        {
          id: "item-1",
          title: "Shipping AI interfaces",
          start: "2026-06-12T12:30:00.000Z",
          timeZone: "Europe/Amsterdam",
          kind: "talk",
          engagementType: "keynote",
          evidence: [
            {
              sourceKind: "pasted-text",
              sourceLabel: "Speaker confirmation",
              capturedAt: "2026-01-02T10:00:00.000Z",
              confidence: "high",
            },
          ],
          createdAt: "2026-01-02T10:00:00.000Z",
          updatedAt: "2026-01-02T10:00:00.000Z",
        },
      ],
      createdAt: "2026-01-02T10:00:00.000Z",
      updatedAt: "2026-01-02T10:00:00.000Z",
    };
    const serviceTrip = toServiceTrip(trip, "workspace-1", "user-1");
    const http: MiniAppHttpApi = {
      request: () => ({
        finalUrl: ROADIE_API_ORIGIN,
        status: 200,
        statusText: "OK",
        headers: [],
        bodyText: JSON.stringify({ trips: [serviceTrip] }),
        bodyBase64: null,
        bodyKind: "text",
        bodyTruncated: false,
        sizeBytes: 1,
        elapsedMs: 1,
        contentType: "application/json",
      }),
    };

    await expect(listWorkspaceTrips(http, "workspace-1")).resolves.toEqual([trip]);
    expect(serviceTrip.timeline[0]?.engagementType).toBe("ROADIE_ENGAGEMENT_TYPE_KEYNOTE");
  });
});
