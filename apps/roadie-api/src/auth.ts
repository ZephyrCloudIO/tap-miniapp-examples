import { HTTPException } from "hono/http-exception";
import {
  createPlatformSessionVerifier,
  verifyPlatformSessionToken,
  type VerifyPlatformSessionOptions,
} from "@theaiplatform/miniapp-sdk/auth/server";
import {
  ROADIE_MINIAPP_PACKAGE_ID,
  ROADIE_PLATFORM_SESSION_BACKEND,
} from "@tap-examples/roadie-contract/platform-session";

import {
  getPrincipalContextResponseSchema,
  resolveCanonicalUserResponseSchema,
} from "./directory-boundary";
import type {
  RoadieApiEnv,
  RoadieRequestIdentity,
  RoadieSessionIdentity,
} from "./types";

type PlatformSessionJwks = NonNullable<VerifyPlatformSessionOptions["jwks"]>;
type PlatformSessionVerifier = ReturnType<
  typeof createPlatformSessionVerifier
>;

let cachedVerifier:
  | { issuer: string; verifier: PlatformSessionVerifier }
  | undefined;

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function verifierForIssuer(issuer: string): PlatformSessionVerifier {
  if (cachedVerifier?.issuer === issuer) return cachedVerifier.verifier;
  const verifier = createPlatformSessionVerifier({
    backend: ROADIE_PLATFORM_SESSION_BACKEND,
    issuer,
    packageId: ROADIE_MINIAPP_PACKAGE_ID,
  });
  cachedVerifier = { issuer, verifier };
  return verifier;
}

export async function authenticateRoadieRequest(
  request: Request,
  env: RoadieApiEnv,
): Promise<RoadieRequestIdentity> {
  const token = bearerToken(request);
  if (!token) throw new HTTPException(401, { message: "Authentication required" });

  const identity = await verifyMiniAppSessionToken(token, env);

  const resolved = resolveCanonicalUserResponseSchema.parse(
    await env.DIRECTORY_API.resolveCanonicalUser({
      subject: identity.accountSubject,
    }),
  );
  if (!resolved.userId) {
    throw new HTTPException(403, { message: "Canonical user not found" });
  }
  return { ...identity, userId: resolved.userId };
}

export async function verifyMiniAppSessionToken(
  token: string,
  env: RoadieApiEnv,
  providedJwks?: PlatformSessionJwks,
): Promise<RoadieSessionIdentity> {
  try {
    return providedJwks
      ? await verifyPlatformSessionToken(token, {
          backend: ROADIE_PLATFORM_SESSION_BACKEND,
          issuer: env.TAP_MINIAPP_SESSION_ISSUER,
          jwks: providedJwks,
          packageId: ROADIE_MINIAPP_PACKAGE_ID,
        })
      : await verifierForIssuer(env.TAP_MINIAPP_SESSION_ISSUER)(token);
  } catch {
    throw new HTTPException(401, { message: "Invalid or expired miniapp session" });
  }
}

export async function requireJoinedWorkspace(
  env: RoadieApiEnv,
  workspaceId: string,
  identity: RoadieRequestIdentity,
) {
  if (workspaceId !== identity.workspaceId) {
    throw new HTTPException(403, { message: "Workspace session mismatch" });
  }
  const response = getPrincipalContextResponseSchema.parse(
    await env.DIRECTORY_API.getPrincipalContext({ workspaceId, userId: identity.userId }),
  );
  if (
    !response.context ||
    response.context.workspaceId !== workspaceId ||
    response.context.userId !== identity.userId
  ) {
    throw new HTTPException(403, { message: "Workspace membership required" });
  }
  return response.context;
}
