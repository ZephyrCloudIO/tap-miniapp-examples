import { ApiError } from "./policy";

export const SESSION_TOKEN_HEADER = "X-Agent-Browser-Session-Token";
export const BROWSER_SNAPSHOT_CAPTURE_SCOPE =
  "browser.snapshot.capture" as const;

export type BrowserAssertionScope =
  | typeof BROWSER_SNAPSHOT_CAPTURE_SCOPE
  | "browser.session.create"
  | "browser.session.read"
  | "browser.session.renew"
  | "browser.session.close"
  | "browser.session.control";

export interface BrowserOwner {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly packageId: string;
  readonly installationId: string;
  readonly contributionId: string;
}

export interface VerifiedBrowserAssertion {
  readonly owner: BrowserOwner;
  readonly assertionId: string | null;
  readonly expiresAt: number;
}

type AssertionEnv = Pick<
  Env,
  | "TAP_BROWSER_ASSERTION_PUBLIC_JWK"
  | "TAP_BROWSER_ASSERTION_ISSUER"
  | "TAP_BROWSER_ASSERTION_AUDIENCE"
>;

type WorkflowAuthEnv = Pick<
  Env,
  | "WORKFLOW_SERVICE_TOKEN"
  | "WORKFLOW_SERVICE_ACTOR_ID"
  | "WORKFLOW_SERVICE_WORKSPACE_ID"
  | "WORKFLOW_SERVICE_PACKAGE_ID"
  | "WORKFLOW_SERVICE_INSTALLATION_ID"
  | "WORKFLOW_SERVICE_CONTRIBUTION_ID"
>;

const MAX_ASSERTION_BYTES = 12 * 1024;
const MAX_ASSERTION_LIFETIME_SECONDS = 60;
const CLOCK_SKEW_SECONDS = 5;
const OWNER_ID = /^[0-9A-Za-z][0-9A-Za-z._:@-]{0,127}$/u;
const ASSERTION_ID = /^[0-9A-Za-z_-]{16,192}$/u;

type TimingSafeSubtleCrypto = SubtleCrypto & {
  timingSafeEqual(
    left: ArrayBuffer | ArrayBufferView,
    right: ArrayBuffer | ArrayBufferView,
  ): boolean;
};

function timingSafeEqual(
  left: ArrayBuffer | ArrayBufferView,
  right: ArrayBuffer | ArrayBufferView,
): boolean {
  return (crypto.subtle as TimingSafeSubtleCrypto).timingSafeEqual(left, right);
}

function copiedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function asRecord(value: unknown, message: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(401, "invalid_assertion", message);
  }
  return value as Readonly<Record<string, unknown>>;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[0-9A-Za-z_-]*$/u.test(value)) {
    throw new ApiError(401, "invalid_assertion", "The browser assertion is malformed.");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  let decoded: string;
  try {
    decoded = atob(value.replace(/-/gu, "+").replace(/_/gu, "/") + padding);
  } catch {
    throw new ApiError(401, "invalid_assertion", "The browser assertion is malformed.");
  }
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function decodeJsonSegment(value: string): Readonly<Record<string, unknown>> {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      decodeBase64Url(value),
    );
    return asRecord(JSON.parse(decoded), "The browser assertion is malformed.");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, "invalid_assertion", "The browser assertion is malformed.");
  }
}

function requiredBoundedString(
  value: unknown,
  claim: string,
  pattern = OWNER_ID,
): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new ApiError(
      401,
      "invalid_assertion",
      `The browser assertion has an invalid ${claim} claim.`,
    );
  }
  return value;
}

function integerClaim(value: unknown, claim: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new ApiError(
      401,
      "invalid_assertion",
      `The browser assertion has an invalid ${claim} claim.`,
    );
  }
  return Number(value);
}

function parsePublicJwk(env: AssertionEnv, keyId: unknown): JsonWebKey {
  const serialized = env.TAP_BROWSER_ASSERTION_PUBLIC_JWK.trim();
  if (!serialized || serialized.length > 8 * 1024) {
    throw new ApiError(
      503,
      "gateway_not_configured",
      "The TAP browser assertion public key is not configured.",
    );
  }
  let parsed: Readonly<Record<string, unknown>>;
  try {
    parsed = asRecord(
      JSON.parse(serialized),
      "The TAP browser assertion public key is invalid.",
    );
  } catch (error) {
    if (error instanceof ApiError) {
      throw new ApiError(
        503,
        "gateway_not_configured",
        "The TAP browser assertion public key is invalid.",
      );
    }
    throw error;
  }
  if (
    parsed.kty !== "OKP" ||
    parsed.crv !== "Ed25519" ||
    typeof parsed.x !== "string" ||
    !parsed.x ||
    parsed.d !== undefined ||
    (keyId !== undefined && parsed.kid !== keyId)
  ) {
    throw new ApiError(
      503,
      "gateway_not_configured",
      "The TAP browser assertion public key is invalid.",
    );
  }
  return parsed;
}

function bearerAssertion(request: Request): string {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/iu.exec(authorization);
  if (!match?.[1] || match[1].length > MAX_ASSERTION_BYTES) {
    throw new ApiError(
      401,
      "unauthorized",
      "A valid host-minted browser assertion is required.",
    );
  }
  return match[1];
}

async function secretsMatch(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return timingSafeEqual(leftHash, rightHash);
}

function configuredOwner(env: WorkflowAuthEnv): BrowserOwner {
  const entries = [
    ["WORKFLOW_SERVICE_ACTOR_ID", env.WORKFLOW_SERVICE_ACTOR_ID],
    ["WORKFLOW_SERVICE_WORKSPACE_ID", env.WORKFLOW_SERVICE_WORKSPACE_ID],
    ["WORKFLOW_SERVICE_PACKAGE_ID", env.WORKFLOW_SERVICE_PACKAGE_ID],
    ["WORKFLOW_SERVICE_INSTALLATION_ID", env.WORKFLOW_SERVICE_INSTALLATION_ID],
    ["WORKFLOW_SERVICE_CONTRIBUTION_ID", env.WORKFLOW_SERVICE_CONTRIBUTION_ID],
  ] as const;
  for (const [name, value] of entries) {
    if (!OWNER_ID.test(value)) {
      throw new ApiError(
        503,
        "gateway_not_configured",
        `${name} is not configured with a valid owner identifier.`,
      );
    }
  }
  return {
    actorId: env.WORKFLOW_SERVICE_ACTOR_ID,
    workspaceId: env.WORKFLOW_SERVICE_WORKSPACE_ID,
    packageId: env.WORKFLOW_SERVICE_PACKAGE_ID,
    installationId: env.WORKFLOW_SERVICE_INSTALLATION_ID,
    contributionId: env.WORKFLOW_SERVICE_CONTRIBUTION_ID,
  };
}

export async function verifyBrowserAssertion(
  request: Request,
  env: AssertionEnv,
  requiredScope: BrowserAssertionScope,
  nowMs = Date.now(),
): Promise<VerifiedBrowserAssertion> {
  const assertion = bearerAssertion(request);
  const segments = assertion.split(".");
  if (segments.length !== 3 || segments.some((segment) => !segment)) {
    throw new ApiError(401, "invalid_assertion", "The browser assertion is malformed.");
  }
  const [encodedHeader = "", encodedPayload = "", encodedSignature = ""] = segments;
  const header = decodeJsonSegment(encodedHeader);
  if (
    header.alg !== "EdDSA" ||
    (header.typ !== undefined && header.typ !== "JWT") ||
    (header.kid !== undefined && typeof header.kid !== "string")
  ) {
    throw new ApiError(
      401,
      "invalid_assertion",
      "The browser assertion uses an unsupported signing algorithm.",
    );
  }

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      parsePublicJwk(env, header.kid),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      503,
      "gateway_not_configured",
      "The TAP browser assertion public key could not be loaded.",
    );
  }
  const verified = await crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    copiedBuffer(decodeBase64Url(encodedSignature)),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!verified) {
    throw new ApiError(401, "invalid_assertion", "The browser assertion signature is invalid.");
  }

  const claims = decodeJsonSegment(encodedPayload);
  if (
    claims.iss !== env.TAP_BROWSER_ASSERTION_ISSUER ||
    claims.aud !== env.TAP_BROWSER_ASSERTION_AUDIENCE
  ) {
    throw new ApiError(
      401,
      "invalid_assertion",
      "The browser assertion issuer or audience is invalid.",
    );
  }
  const issuedAt = integerClaim(claims.iat, "iat");
  const notBefore = integerClaim(claims.nbf, "nbf");
  const expiresAtSeconds = integerClaim(claims.exp, "exp");
  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    issuedAt > nowSeconds + CLOCK_SKEW_SECONDS ||
    notBefore > nowSeconds + CLOCK_SKEW_SECONDS ||
    expiresAtSeconds <= nowSeconds - CLOCK_SKEW_SECONDS ||
    expiresAtSeconds <= issuedAt ||
    notBefore > expiresAtSeconds ||
    expiresAtSeconds - issuedAt > MAX_ASSERTION_LIFETIME_SECONDS
  ) {
    throw new ApiError(401, "expired_assertion", "The browser assertion is expired or not yet valid.");
  }
  if (
    !Array.isArray(claims.scope) ||
    !claims.scope.every((scope) => typeof scope === "string") ||
    !claims.scope.includes(requiredScope)
  ) {
    throw new ApiError(403, "insufficient_scope", "The browser assertion does not grant this operation.");
  }

  return {
    owner: {
      actorId: requiredBoundedString(claims.sub, "sub"),
      workspaceId: requiredBoundedString(claims.workspace_id, "workspace_id"),
      packageId: requiredBoundedString(claims.package_id, "package_id"),
      installationId: requiredBoundedString(claims.installation_id, "installation_id"),
      contributionId: requiredBoundedString(claims.contribution_id, "contribution_id"),
    },
    assertionId: requiredBoundedString(claims.jti, "jti", ASSERTION_ID),
    // Verification accepts a small expiry skew, so replay state must outlive
    // that same window or an assertion could be replayed just after `exp`.
    expiresAt: (expiresAtSeconds + CLOCK_SKEW_SECONDS) * 1000,
  };
}

/**
 * Workflows cannot mint interactive host assertions. A distinct bearer may
 * therefore call only the stateless snapshot route, and its complete owner is
 * fixed in gateway configuration rather than accepted from request headers.
 */
export async function authenticateSnapshotRequest(
  request: Request,
  env: AssertionEnv & WorkflowAuthEnv,
  nowMs = Date.now(),
): Promise<VerifiedBrowserAssertion> {
  const bearer = bearerAssertion(request);
  if (
    env.WORKFLOW_SERVICE_TOKEN.trim() &&
    await secretsMatch(bearer, env.WORKFLOW_SERVICE_TOKEN)
  ) {
    return {
      owner: configuredOwner(env),
      assertionId: null,
      expiresAt: nowMs + 60_000,
    };
  }
  return verifyBrowserAssertion(
    request,
    env,
    BROWSER_SNAPSHOT_CAPTURE_SCOPE,
    nowMs,
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

export function randomSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function hexBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/u.test(value)) return new Uint8Array(32);
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export async function secretMatchesHash(
  provided: string,
  expectedHash: string,
): Promise<boolean> {
  const providedHash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(provided),
  );
  return timingSafeEqual(providedHash, hexBytes(expectedHash));
}

export function sessionTokenFromRequest(request: Request): string {
  const token = request.headers.get(SESSION_TOKEN_HEADER)?.trim() ?? "";
  if (!token || token.length > 256) {
    throw new ApiError(
      401,
      "session_unauthorized",
      "A valid session-scoped browser capability is required.",
    );
  }
  return token;
}
