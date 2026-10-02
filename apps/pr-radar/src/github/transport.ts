/**
 * The one narrow seam between this package and the host.
 *
 * Everything above this file is pure logic over plain objects, so the poller,
 * the store, and the conflict/approval rules are exercised by tests without a
 * live host, a live GitHub account, or a network. The default implementation
 * is the only place that reaches `sdk.http`.
 */
import { sdk, type MiniAppHttpRequestOptions } from "@theaiplatform/miniapp-sdk/sdk";
import { isUsableCredentialId, type GithubAuthChoice } from "./settings";

export interface GithubHttpHeader {
  readonly name: string;
  readonly value: string;
}

export interface GithubHttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers?: readonly GithubHttpHeader[];
  readonly timeoutMs?: number;
  readonly responseBodyLimitBytes?: number;
  readonly followRedirects?: boolean;
}

export interface GithubHttpResponse {
  readonly status: number;
  readonly headers: readonly GithubHttpHeader[];
  readonly bodyText: string | null;
}

/** Everything this package may ask of GitHub, scoped to read-only requests. */
export interface GithubTransport {
  request(input: GithubHttpRequest): Promise<GithubHttpResponse>;
}

export class GithubTransportUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubTransportUnavailableError";
  }
}

export class GithubAuthRequiredError extends Error {
  constructor() {
    super("Choose how PR Radar may access GitHub before it reads anything.");
    this.name = "GithubAuthRequiredError";
  }
}

/** TAP has no GitHub connection to attach, so no GitHub request can be made. */
export class GithubNotConnectedError extends Error {
  constructor() {
    super("TAP is not connected to GitHub.");
    this.name = "GithubNotConnectedError";
  }
}

const NOT_CONNECTED_CODES = new Set([
  "github_token_unavailable",
  "github_credential_authority_unavailable",
]);

const isNotConnectedFailure = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && NOT_CONNECTED_CODES.has(code)) return true;
  // The host bridge may pass only the message text through.
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    (message.includes("github_token_unavailable") ||
      message.includes("No GitHub token is configured"))
  );
};

const requestOptions = (auth: GithubAuthChoice): MiniAppHttpRequestOptions =>
  auth.mode === "tap" ? { auth: "github" } : { credentialRef: auth.credentialId };

/**
 * Host-mediated transport. The host attaches the credential the user approved
 * -- TAP's GitHub connection or a separate token saved in TAP Settings -- and
 * never exposes it to this realm, so package code holds no secret.
 *
 * Neither credential is guaranteed to be read-only and the host does not
 * restrict the method (https://github.com/ZephyrCloudIO/ze-agency-tauri/issues/11097),
 * so this transport refuses anything but GET.
 */
export const createHostGithubTransport = (
  currentAuth: () => GithubAuthChoice | null,
): GithubTransport => ({
  async request(input) {
    if (!sdk.http || sdk.hasHostHttpRequest !== true) {
      throw new GithubTransportUnavailableError(
        "This host does not provide host-mediated HTTP requests.",
      );
    }
    if (input.method !== "GET") {
      throw new Error(`PR Radar only sends GET requests, not ${input.method}.`);
    }
    const auth = currentAuth();
    if (!auth) throw new GithubAuthRequiredError();
    const http = sdk.http;
    let response: Awaited<ReturnType<typeof http.request>>;
    try {
      response = await http.request(
        {
          method: "GET",
          url: input.url,
          headers: [...(input.headers ?? [])],
          timeoutMs: input.timeoutMs ?? 20_000,
          responseBodyLimitBytes: input.responseBodyLimitBytes ?? 4 * 1024 * 1024,
          followRedirects: input.followRedirects ?? false,
        },
        requestOptions(auth),
      );
    } catch (error) {
      if (isNotConnectedFailure(error)) throw new GithubNotConnectedError();
      throw error;
    }
    return {
      status: response.status,
      headers: response.headers.map((header) => ({
        name: header.name,
        value: header.value,
      })),
      bodyText: response.bodyText,
    };
  },
});

export interface GithubTokenCredential {
  readonly id: string;
  readonly displayName: string;
}

/**
 * HTTP Bearer Token credentials saved in TAP Settings; GitHub accepts a personal access token as a Bearer token.
 * Returns metadata only; the host never sends secret material to this realm.
 */
export const listGithubTokenCredentials = async (): Promise<
  readonly GithubTokenCredential[] | null
> => {
  if (!sdk.credentials) return null;
  const credentials = await sdk.credentials.listHttp();
  return credentials
    .filter(
      (credential) =>
        credential.credentialType === "http_bearer" && isUsableCredentialId(credential.id),
    )
    .map((credential) => ({
      id: credential.id,
      displayName: credential.displayName.trim() || credential.id,
    }));
};
