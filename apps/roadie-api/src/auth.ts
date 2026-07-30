import { createRemoteJWKSet, jwtVerify } from "jose";

import {
  getPrincipalContextResponseSchema,
  resolveCanonicalUserResponseSchema,
} from "./directory-boundary";
import type { RoadieApiEnv, RoadieRequestIdentity } from "./types";

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function authenticateRoadieRequest(
  request: Request,
  env: RoadieApiEnv,
): Promise<RoadieRequestIdentity> {
  const token = bearerToken(request);
  if (!token) throw new Response("Authentication required", { status: 401 });

  const issuer = `https://${env.AUTH0_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "")}/`;
  const jwks =
    jwksByIssuer.get(issuer) ?? createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`));
  jwksByIssuer.set(issuer, jwks);

  let subject: string | undefined;
  try {
    const verified = await jwtVerify(token, jwks, {
      audience: env.AUTH0_AUDIENCE,
      issuer,
    });
    subject = verified.payload.sub;
  } catch {
    throw new Response("Invalid or expired session", { status: 401 });
  }
  if (!subject) throw new Response("Session has no subject", { status: 401 });

  const resolved = resolveCanonicalUserResponseSchema.parse(
    await env.DIRECTORY_API.resolveCanonicalUser({
      subject,
    }),
  );
  if (!resolved.userId) {
    throw new Response("Canonical user not found", { status: 403 });
  }
  return { userId: resolved.userId };
}

export async function requireJoinedWorkspace(
  env: RoadieApiEnv,
  workspaceId: string,
  userId: string,
) {
  const response = getPrincipalContextResponseSchema.parse(
    await env.DIRECTORY_API.getPrincipalContext({ workspaceId, userId }),
  );
  if (!response.context) {
    throw new Response("Workspace membership required", { status: 403 });
  }
  return response.context;
}
