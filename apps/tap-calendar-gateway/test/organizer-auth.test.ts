import { describe, expect, it } from "vitest";
import {
  OrganizerAuthError,
  resolveOrganizerScope,
} from "../src/organizer-auth";

const request = (headers: Record<string, string>): Request =>
  new Request("https://calendar.with-tap.ai/v1/connections", { headers });

describe("organizer authentication", () => {
  it("keeps local development header scope behavior", async () => {
    await expect(resolveOrganizerScope(
      request({
        "X-TAP-Workspace-Id": "workspace-local",
        "X-TAP-Principal-Id": "principal-local",
      }),
      { LOCAL_DEVELOPMENT: "true" },
    )).resolves.toEqual({
      userId: "principal-local",
      principalId: "principal-local",
      workspaceId: "workspace-local",
    });
  });

  it("rejects a missing production Bearer token", async () => {
    await expect(resolveOrganizerScope(
      request({ "X-TAP-Workspace-Id": "workspace-prod" }),
      {},
    )).rejects.toMatchObject({
      status: 401,
      code: "organizer_auth_required",
    });
  });

  it("uses the verified subject and authz canonical identity, not spoofed headers", async () => {
    const calls: Array<[string, string]> = [];
    await expect(resolveOrganizerScope(
      request({
        Authorization: "Bearer verified-token",
        "X-TAP-Workspace-Id": "workspace-prod",
        "X-TAP-Principal-Id": "attacker-controlled-id",
      }),
      {},
      {
        verifyJwt: async token => {
          expect(token).toBe("verified-token");
          return {
            subject: "jwt-subject",
            email: "zack@example.com",
            emailVerified: true,
          };
        },
        checkWorkspaceAccessBySubject: async (identity, workspaceId) => {
          calls.push([identity.subject, workspaceId]);
          return {
            member: true,
            allowed: true,
            canonicalUserId: "canonical-user",
          };
        },
      },
    )).resolves.toEqual({
      userId: "canonical-user",
      principalId: "canonical-user",
      workspaceId: "workspace-prod",
    });
    expect(calls).toEqual([["jwt-subject", "workspace-prod"]]);
  });

  it("maps an authz denial to 403", async () => {
    await expect(resolveOrganizerScope(
      request({
        Authorization: "Bearer verified-token",
        "X-TAP-Workspace-Id": "workspace-prod",
      }),
      {},
      {
        verifyJwt: async () => ({
          subject: "jwt-subject",
          email: null,
          emailVerified: false,
        }),
        checkWorkspaceAccessBySubject: async () => ({
          member: true,
          allowed: false,
          canonicalUserId: null,
        }),
      },
    )).rejects.toMatchObject({
      status: 403,
      code: "organizer_access_denied",
    });
  });

  it("maps verifier and authz outages to 503", async () => {
    const verifierFailure = resolveOrganizerScope(
      request({
        Authorization: "Bearer verified-token",
        "X-TAP-Workspace-Id": "workspace-prod",
      }),
      {},
      { verifyJwt: async () => { throw new Error("JWKS unavailable"); } },
    );
    await expect(verifierFailure).rejects.toMatchObject({
      status: 503,
      code: "organizer_auth_unavailable",
    });

    const authzFailure = resolveOrganizerScope(
      request({
        Authorization: "Bearer verified-token",
        "X-TAP-Workspace-Id": "workspace-prod",
      }),
      {},
      {
        verifyJwt: async () => ({
          subject: "jwt-subject",
          email: null,
          emailVerified: false,
        }),
        checkWorkspaceAccessBySubject: async () => {
          throw new OrganizerAuthError(
            503,
            "organizer_auth_unavailable",
            "authz unavailable",
          );
        },
      },
    );
    await expect(authzFailure).rejects.toMatchObject({
      status: 503,
      code: "organizer_auth_unavailable",
    });
  });
});
