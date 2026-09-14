import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const MAX_IDENTIFIER_LENGTH = 255;
const ASYMMETRIC_JWT_ALGORITHMS = [
  "RS256", "RS384", "RS512", "PS256", "PS384", "PS512",
  "ES256", "ES384", "ES512", "EdDSA",
] as const;

interface AuthzWorkspaceAccessBinding {
  checkWorkspaceAccessBySubject(input: {
    readonly organizationId: string;
    readonly externalSubject: string;
    readonly email: string | null;
    readonly emailVerified: boolean;
    readonly actions: readonly ["workspace:read"];
  }): Promise<unknown>;
}

export interface OrganizerAuthEnv {
  readonly LOCAL_DEVELOPMENT?: string;
  readonly AUTH0_DOMAIN?: string;
  readonly AUTH0_AUDIENCE?: string;
  readonly AUTH0_JWKS_URL?: string;
  readonly AUTHZ_API?: AuthzWorkspaceAccessBinding;
}

export interface OrganizerScope {
  readonly userId: string;
  readonly principalId: string;
  readonly workspaceId: string;
}

export interface OrganizerIdentity {
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
}

export interface WorkspaceAccessDecision {
  readonly member: boolean;
  readonly allowed: boolean;
  readonly canonicalUserId: string | null;
}

export interface OrganizerAuthDependencies {
  readonly verifyJwt?: (token: string, env: OrganizerAuthEnv) => Promise<OrganizerIdentity>;
  readonly checkWorkspaceAccessBySubject?: (
    identity: OrganizerIdentity,
    workspaceId: string,
    env: OrganizerAuthEnv,
  ) => Promise<WorkspaceAccessDecision>;
}

export class OrganizerAuthError extends Error {
  constructor(
    readonly status: 401 | 403 | 503,
    readonly code: "organizer_auth_required" | "organizer_access_denied" | "organizer_auth_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "OrganizerAuthError";
  }
}

const cleanIdentifier = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_IDENTIFIER_LENGTH) return null;
  if ([...normalized].some(character => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  })) return null;
  return normalized;
};

const authUnavailable = (message: string): OrganizerAuthError =>
  new OrganizerAuthError(503, "organizer_auth_unavailable", message);
const authRequired = (message: string): OrganizerAuthError =>
  new OrganizerAuthError(401, "organizer_auth_required", message);
const accessDenied = (): OrganizerAuthError =>
  new OrganizerAuthError(403, "organizer_access_denied", "The organizer is not authorized for this workspace.");

const requiredHeader = (request: Request, name: string): string => {
  const value = cleanIdentifier(request.headers.get(name));
  if (!value) throw authRequired(`${name} is required.`);
  return value;
};

function authToken(request: Request): string {
  const match = /^Bearer ([^\s]+)$/u.exec(request.headers.get("Authorization")?.trim() ?? "");
  if (!match?.[1]) throw authRequired("A valid Bearer token is required.");
  return match[1];
}

function auth0Configuration(env: OrganizerAuthEnv): {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUrl: string;
} {
  const domain = env.AUTH0_DOMAIN?.trim().replace(/^https?:\/\//u, "").replace(/\/$/u, "") ?? "";
  const audience = env.AUTH0_AUDIENCE?.trim() ?? "";
  if (!domain || !audience) throw authUnavailable("Organizer JWT verification is not configured.");
  const issuer = `https://${domain}/`;
  const jwksUrl = env.AUTH0_JWKS_URL?.trim() || `${issuer}.well-known/jwks.json`;
  try {
    if (new URL(jwksUrl).protocol !== "https:") throw new Error("HTTPS required");
  } catch {
    throw authUnavailable("Organizer JWT JWKS URL is invalid.");
  }
  return { issuer, audience, jwksUrl };
}

const remoteJwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const jwksFor = (url: string): ReturnType<typeof createRemoteJWKSet> => {
  const existing = remoteJwks.get(url);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(url), {
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
    timeoutDuration: 5_000,
  });
  remoteJwks.set(url, created);
  return created;
};

const verifierUnavailable = (error: unknown): boolean => {
  if (!(error instanceof Error)) return true;
  const code = Reflect.get(error, "code");
  return code === "ERR_JWKS_TIMEOUT" || code === "ERR_JWKS_INVALID" ||
    code === "ERR_JWKS_NO_MATCHING_KEY" || error.name === "TypeError";
};

const stringClaim = (payload: JWTPayload, ...names: string[]): string | null => {
  for (const name of names) {
    const value = payload[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

export async function verifyOrganizerJwt(token: string, env: OrganizerAuthEnv): Promise<OrganizerIdentity> {
  const { issuer, audience, jwksUrl } = auth0Configuration(env);
  let payload: JWTPayload;
  try {
    payload = (await jwtVerify(token, jwksFor(jwksUrl), {
      issuer,
      audience,
      algorithms: [...ASYMMETRIC_JWT_ALGORITHMS],
      requiredClaims: ["sub", "exp", "iat"],
      clockTolerance: 30,
    })).payload;
  } catch (error) {
    if (verifierUnavailable(error)) throw authUnavailable("Organizer JWT verifier is unavailable.");
    throw authRequired("The organizer Bearer token is invalid.");
  }
  const subject = cleanIdentifier(payload.sub);
  if (!subject) throw authRequired("The organizer token has no valid subject.");
  const normalizedAudience = audience.replace(/\/$/u, "");
  return {
    subject,
    email: stringClaim(
      payload,
      "https://zephyr.agency/claims/email",
      "email",
      `${normalizedAudience}/email`,
    ),
    emailVerified: payload.email_verified === true ||
      payload[`${normalizedAudience}/email_verified`] === true,
  };
}

function parseAccessDecision(value: unknown): WorkspaceAccessDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw authUnavailable("Workspace authorization returned an invalid response.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.member !== "boolean" || typeof record.allowed !== "boolean") {
    throw authUnavailable("Workspace authorization returned an invalid response.");
  }
  const canonicalUserId = cleanIdentifier(record.canonicalUserId);
  if (record.member && record.allowed && !canonicalUserId) {
    throw authUnavailable("Workspace authorization omitted the canonical TAP user.");
  }
  return { member: record.member, allowed: record.allowed, canonicalUserId };
}

export async function checkWorkspaceAccessBySubject(
  identity: OrganizerIdentity,
  workspaceId: string,
  env: OrganizerAuthEnv,
): Promise<WorkspaceAccessDecision> {
  const binding = env.AUTHZ_API;
  if (!binding || typeof binding.checkWorkspaceAccessBySubject !== "function") {
    throw authUnavailable("Workspace authorization is not configured.");
  }
  try {
    return parseAccessDecision(await binding.checkWorkspaceAccessBySubject({
      organizationId: workspaceId,
      externalSubject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerified,
      actions: ["workspace:read"],
    }));
  } catch (error) {
    if (error instanceof OrganizerAuthError) throw error;
    throw authUnavailable("Workspace authorization is unavailable.");
  }
}

export async function resolveOrganizerScope(
  request: Request,
  env: OrganizerAuthEnv,
  dependencies: OrganizerAuthDependencies = {},
): Promise<OrganizerScope> {
  const workspaceId = requiredHeader(request, "X-TAP-Workspace-Id");
  if (env.LOCAL_DEVELOPMENT === "true") {
    const principalId = requiredHeader(request, "X-TAP-Principal-Id");
    return { userId: principalId, principalId, workspaceId };
  }
  const identity = await (dependencies.verifyJwt ?? verifyOrganizerJwt)(authToken(request), env)
    .catch(error => {
      if (error instanceof OrganizerAuthError) throw error;
      throw authUnavailable("Organizer JWT verifier is unavailable.");
    });
  const decision = await (
    dependencies.checkWorkspaceAccessBySubject ?? checkWorkspaceAccessBySubject
  )(identity, workspaceId, env).catch(error => {
    if (error instanceof OrganizerAuthError) throw error;
    throw authUnavailable("Workspace authorization is unavailable.");
  });
  if (!decision.member || !decision.allowed || !decision.canonicalUserId) throw accessDenied();
  return {
    userId: decision.canonicalUserId,
    principalId: decision.canonicalUserId,
    workspaceId,
  };
}
