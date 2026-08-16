import { describe, expect, it, rs } from "@rstest/core";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  ROADIE_API_ORIGIN,
  ROADIE_MINIAPP_PACKAGE_ID,
  ROADIE_PLATFORM_SESSION_BACKEND,
} from "@tap-examples/roadie-contract/platform-session";

import { requireJoinedWorkspace, verifyMiniAppSessionToken } from "./auth";
import type { RoadieApiEnv, RoadieRequestIdentity } from "./types";

const AUDIENCE = ROADIE_API_ORIGIN;
const ISSUER = "https://miniapp-session-api-dev.zephyrwmf.workers.dev";
const PACKAGE_ID = ROADIE_MINIAPP_PACKAGE_ID;

function sessionEnv(): RoadieApiEnv {
  return {
    TAP_MINIAPP_SESSION_ISSUER: ISSUER,
  } as RoadieApiEnv;
}

async function signedSession(
  overrides: Record<string, unknown> = {},
): Promise<{ token: string; jwks: ReturnType<typeof createLocalJWKSet> }> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.alg = "EdDSA";
  publicJwk.kid = "test-key";
  publicJwk.use = "sig";
  const payload = {
    disclosurePurpose: ROADIE_PLATFORM_SESSION_BACKEND.purpose,
    installationId: "installation-roadie-1",
    packageId: PACKAGE_ID,
    profileClaims: ROADIE_PLATFORM_SESSION_BACKEND.profile,
    purpose: "miniapp-session",
    user: {
      name: "Roadie User",
      picture: "https://images.example.test/roadie.png",
    },
    workspaceId: "workspace-a",
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "aud")),
  };
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key", typ: "JWT" })
    .setAudience(typeof overrides.aud === "string" ? overrides.aud : AUDIENCE)
    .setIssuer(ISSUER)
    .setSubject("auth0|roadie-user")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return { token, jwks: createLocalJWKSet({ keys: [publicJwk] }) };
}

function requestIdentity(
  overrides: Partial<RoadieRequestIdentity> = {},
): RoadieRequestIdentity {
  return {
    accountSubject: "auth0|roadie-user",
    disclosurePurpose: ROADIE_PLATFORM_SESSION_BACKEND.purpose,
    installationId: "installation-roadie-1",
    packageId: PACKAGE_ID,
    user: { name: "Roadie User" },
    userId: "user-a",
    workspaceId: "workspace-a",
    ...overrides,
  };
}

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
  it("accepts only the declared profile for this package and exact backend origin", async () => {
    const { token, jwks } = await signedSession();

    await expect(verifyMiniAppSessionToken(token, sessionEnv(), jwks)).resolves.toEqual({
      accountSubject: "auth0|roadie-user",
      disclosurePurpose: ROADIE_PLATFORM_SESSION_BACKEND.purpose,
      installationId: "installation-roadie-1",
      packageId: PACKAGE_ID,
      user: {
        name: "Roadie User",
        picture: "https://images.example.test/roadie.png",
      },
      workspaceId: "workspace-a",
    });
  });

  it("rejects another audience, package, profile, or missing installation binding", async () => {
    const wrongAudience = await signedSession({ aud: "https://other.example.test" });
    await expect(
      verifyMiniAppSessionToken(wrongAudience.token, sessionEnv(), wrongAudience.jwks),
    ).rejects.toMatchObject({ status: 401 });

    const wrongPackage = await signedSession({ packageId: "tap_pkg_other" });
    await expect(
      verifyMiniAppSessionToken(wrongPackage.token, sessionEnv(), wrongPackage.jwks),
    ).rejects.toMatchObject({ status: 401 });

    const wrongProfile = await signedSession({ profileClaims: ["name"] });
    await expect(
      verifyMiniAppSessionToken(wrongProfile.token, sessionEnv(), wrongProfile.jwks),
    ).rejects.toMatchObject({ status: 401 });

    const missingInstallation = await signedSession({ installationId: undefined });
    await expect(
      verifyMiniAppSessionToken(
        missingInstallation.token,
        sessionEnv(),
        missingInstallation.jwks,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("accepts a joined principal only for the requested workspace and user", async () => {
    await expect(
      requireJoinedWorkspace(
        envWithPrincipal(principal()),
        "workspace-a",
        requestIdentity(),
      ),
    ).resolves.toMatchObject({ workspaceId: "workspace-a", userId: "user-a" });
  });

  it("rejects an absent membership context", async () => {
    await expect(
      requireJoinedWorkspace(
        envWithPrincipal(undefined),
        "workspace-a",
        requestIdentity(),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a principal returned for another workspace", async () => {
    await expect(
      requireJoinedWorkspace(
        envWithPrincipal(principal({ workspaceId: "workspace-b" })),
        "workspace-a",
        requestIdentity(),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a principal returned for another user", async () => {
    await expect(
      requireJoinedWorkspace(
        envWithPrincipal(principal({ userId: "user-b" })),
        "workspace-a",
        requestIdentity(),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a request body for another workspace before Directory lookup", async () => {
    const directory = { getPrincipalContext: rs.fn() };
    await expect(
      requireJoinedWorkspace(
        { DIRECTORY_API: directory } as unknown as RoadieApiEnv,
        "workspace-b",
        requestIdentity(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(directory.getPrincipalContext).not.toHaveBeenCalled();
  });
});
