const ZOOM_AUTHORIZE_URL = "https://zoom.us/oauth/authorize";
const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
const ZOOM_REVOKE_URL = "https://zoom.us/oauth/revoke";
const ZOOM_API_URL = "https://api.zoom.us/v2";
const MAX_PROVIDER_RESPONSE_BYTES = 512 * 1024;

export const ZOOM_OAUTH_SCOPES = [
  "user:read:user",
  "meeting:write:meeting",
  "meeting:update:meeting",
  "meeting:delete:meeting",
] as const;

export type ZoomOAuthScope = (typeof ZOOM_OAUTH_SCOPES)[number];
export type ZoomFetch = typeof fetch;

export interface ZoomOAuthClientConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface ZoomRequestOptions {
  readonly fetch?: ZoomFetch;
  readonly signal?: AbortSignal;
  readonly nowMs?: number;
}

export interface ZoomTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly tokenType: "Bearer";
  readonly scope: string;
}

export interface ZoomCurrentUser {
  readonly id: string;
  readonly accountId: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: "active" | "inactive" | "pending";
  readonly planType: 1 | 2 | 4 | 99;
  readonly timezone: string | null;
}

export interface ZoomMeetingCreateInput {
  readonly topic: string;
  readonly startTime: string;
  readonly durationMinutes: number;
  readonly agenda?: string;
}

export interface ZoomMeetingUpdateInput {
  readonly topic?: string;
  readonly startTime?: string;
  readonly durationMinutes?: number;
  readonly agenda?: string;
}

export interface ZoomCreatedMeeting {
  readonly id: string;
  readonly uuid: string;
  readonly joinUrl: string;
}

export class ZoomProviderError extends Error {
  readonly code: string;
  readonly providerStatus: number | undefined;
  readonly providerCode: string | number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: string,
    message: string,
    details: {
      readonly providerStatus?: number;
      readonly providerCode?: string | number;
      readonly retryAfterSeconds?: number;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "ZoomProviderError";
    this.code = code;
    this.providerStatus = details.providerStatus;
    this.providerCode = details.providerCode;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const invalidInput = (message: string): never => {
  throw new ZoomProviderError("zoom_invalid_input", message);
};

const requiredOpaqueValue = (
  value: unknown,
  label: string,
  maximumLength: number,
): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    /[\u0000\r\n]/u.test(value)
  ) {
    return invalidInput(`${label} is invalid.`);
  }
  return value;
};

const requiredText = (
  value: unknown,
  label: string,
  maximumLength: number,
): string => {
  if (typeof value !== "string") return invalidInput(`${label} is invalid.`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    return invalidInput(`${label} is invalid.`);
  }
  return normalized;
};

const optionalAgenda = (value: unknown): string => {
  if (typeof value !== "string" || value.length > 2_000) {
    return invalidInput("Zoom meeting agenda is invalid.");
  }
  return value;
};

const redirectUri = (value: unknown): string => {
  const candidate = requiredOpaqueValue(value, "Zoom OAuth redirect URI", 2_048);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return invalidInput("Zoom OAuth redirect URI is invalid.");
  }
  const localDevelopmentHost =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  if (
    (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localDevelopmentHost)) ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    return invalidInput("Zoom OAuth redirect URI is invalid.");
  }
  return parsed.href;
};

const validatedClient = (config: ZoomOAuthClientConfig): ZoomOAuthClientConfig => {
  const clientId = requiredOpaqueValue(config.clientId, "Zoom client ID", 4_096);
  if (clientId.includes(":")) return invalidInput("Zoom client ID is invalid.");
  return {
    clientId,
    clientSecret: requiredOpaqueValue(config.clientSecret, "Zoom client secret", 4_096),
    redirectUri: redirectUri(config.redirectUri),
  };
};

const binaryBase64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const clientAuthorization = (config: ZoomOAuthClientConfig): string =>
  `Basic ${binaryBase64(`${config.clientId}:${config.clientSecret}`)}`;

const requestOptions = (
  options: ZoomRequestOptions,
  init: RequestInit,
): RequestInit => ({
  ...init,
  ...(options.signal ? { signal: options.signal } : {}),
});

const providerFetch = (options: ZoomRequestOptions): ZoomFetch => options.fetch ?? fetch;

const fetchZoom = async (
  url: string,
  init: RequestInit,
  options: ZoomRequestOptions,
): Promise<Response> => {
  try {
    return await providerFetch(options)(url, requestOptions(options, init));
  } catch (error) {
    if (error instanceof ZoomProviderError) throw error;
    throw new ZoomProviderError(
      "zoom_network_error",
      "The Zoom request could not be completed.",
      { cause: error },
    );
  }
};

const readBoundedBody = async (response: Response): Promise<string> => {
  const declaredLength = response.headers.get("Content-Length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new ZoomProviderError(
        "zoom_response_too_large",
        "Zoom returned a response larger than the configured safety limit.",
        { providerStatus: response.status },
      );
    }
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    byteLength += chunk.value.byteLength;
    if (byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel("Zoom response exceeded the safe response limit");
      throw new ZoomProviderError(
        "zoom_response_too_large",
        "Zoom returned a response larger than the configured safety limit.",
        { providerStatus: response.status },
      );
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
};

const parsedJson = (text: string): unknown => {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const retryAfterSeconds = (response: Response): number | undefined => {
  const raw = response.headers.get("Retry-After");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < 0) return undefined;
  return seconds;
};

const providerErrorCode = (
  value: Readonly<Record<string, unknown>>,
): string | number | undefined => {
  if (typeof value.code === "number" || typeof value.code === "string") return value.code;
  if (typeof value.error === "string") return value.error;
  return undefined;
};

const providerErrorMessage = (value: Readonly<Record<string, unknown>>): string | null => {
  const nested = isRecord(value.error) ? value.error : null;
  const candidate =
    (typeof value.message === "string" && value.message) ||
    (typeof value.error_description === "string" && value.error_description) ||
    (typeof value.reason === "string" && value.reason) ||
    (nested && typeof nested.message === "string" && nested.message) ||
    null;
  return candidate ? candidate.slice(0, 500) : null;
};

const throwHttpError = (
  response: Response,
  parsed: unknown,
): never => {
  const body = isRecord(parsed) ? parsed : {};
  const zoomCode = providerErrorCode(body);
  const retryAfter = retryAfterSeconds(response);
  throw new ZoomProviderError(
    "zoom_request_failed",
    providerErrorMessage(body) ?? `Zoom returned HTTP ${response.status}.`,
    {
      providerStatus: response.status,
      ...(zoomCode === undefined ? {} : { providerCode: zoomCode }),
      ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
    },
  );
};

const zoomJson = async (
  url: string,
  init: RequestInit,
  options: ZoomRequestOptions,
): Promise<Readonly<Record<string, unknown>>> => {
  const response = await fetchZoom(url, init, options);
  const text = await readBoundedBody(response);
  const parsed = parsedJson(text);
  if (!response.ok) return throwHttpError(response, parsed);
  if (!isRecord(parsed)) {
    throw new ZoomProviderError(
      "zoom_response_invalid",
      "Zoom returned an invalid JSON response.",
      { providerStatus: response.status },
    );
  }
  return parsed;
};

const zoomNoContent = async (
  url: string,
  init: RequestInit,
  options: ZoomRequestOptions,
): Promise<void> => {
  const response = await fetchZoom(url, init, options);
  const text = await readBoundedBody(response);
  const parsed = parsedJson(text);
  if (!response.ok) return throwHttpError(response, parsed);
};

const tokenSet = (
  value: Readonly<Record<string, unknown>>,
  nowMs: number,
): ZoomTokenSet => {
  const accessToken = requiredOpaqueValue(value.access_token, "Zoom access token", 16_384);
  const refreshToken = requiredOpaqueValue(value.refresh_token, "Zoom refresh token", 16_384);
  if (
    typeof value.expires_in !== "number" ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in <= 0 ||
    value.expires_in > 604_800
  ) {
    throw new ZoomProviderError(
      "zoom_response_invalid",
      "Zoom returned an invalid token lifetime.",
    );
  }
  if (typeof value.token_type !== "string" || value.token_type.toLowerCase() !== "bearer") {
    throw new ZoomProviderError(
      "zoom_response_invalid",
      "Zoom returned an unsupported token type.",
    );
  }
  if (typeof value.scope !== "string" || value.scope.trim().length === 0) {
    throw new ZoomProviderError(
      "zoom_response_invalid",
      "Zoom returned an invalid OAuth scope set.",
    );
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(nowMs + Math.floor(value.expires_in) * 1_000).toISOString(),
    tokenType: "Bearer",
    scope: value.scope.trim(),
  };
};

export const buildZoomAuthorizationUrl = (
  config: ZoomOAuthClientConfig,
  input: {
    readonly state: string;
    readonly codeChallenge: string;
  },
): string => {
  const client = validatedClient(config);
  const state = requiredOpaqueValue(input.state, "Zoom OAuth state", 1_024);
  const challenge = requiredOpaqueValue(input.codeChallenge, "Zoom PKCE challenge", 128);
  if (!/^[A-Za-z0-9_-]{43,128}$/u.test(challenge)) {
    return invalidInput("Zoom PKCE challenge is invalid.");
  }
  const url = new URL(ZOOM_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", client.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.href;
};

const oauthRequestHeaders = (config: ZoomOAuthClientConfig): HeadersInit => ({
  Accept: "application/json",
  Authorization: clientAuthorization(config),
  "Content-Type": "application/x-www-form-urlencoded",
});

export const exchangeZoomAuthorizationCode = async (
  config: ZoomOAuthClientConfig,
  input: {
    readonly code: string;
    readonly codeVerifier: string;
  },
  options: ZoomRequestOptions = {},
): Promise<ZoomTokenSet> => {
  const client = validatedClient(config);
  const code = requiredOpaqueValue(input.code, "Zoom authorization code", 16_384);
  const verifier = requiredOpaqueValue(input.codeVerifier, "Zoom PKCE verifier", 128);
  if (!/^[A-Za-z0-9._~-]{43,128}$/u.test(verifier)) {
    return invalidInput("Zoom PKCE verifier is invalid.");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: client.redirectUri,
    code_verifier: verifier,
  });
  const response = await zoomJson(
    ZOOM_TOKEN_URL,
    {
      method: "POST",
      headers: oauthRequestHeaders(client),
      body: body.toString(),
    },
    options,
  );
  return tokenSet(response, options.nowMs ?? Date.now());
};

export const refreshZoomAccessToken = async (
  config: ZoomOAuthClientConfig,
  refreshToken: string,
  options: ZoomRequestOptions = {},
): Promise<ZoomTokenSet> => {
  const client = validatedClient(config);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: requiredOpaqueValue(refreshToken, "Zoom refresh token", 16_384),
  });
  const response = await zoomJson(
    ZOOM_TOKEN_URL,
    {
      method: "POST",
      headers: oauthRequestHeaders(client),
      body: body.toString(),
    },
    options,
  );
  return tokenSet(response, options.nowMs ?? Date.now());
};

export const revokeZoomToken = async (
  config: ZoomOAuthClientConfig,
  token: string,
  options: ZoomRequestOptions = {},
): Promise<void> => {
  const client = validatedClient(config);
  const body = new URLSearchParams({
    token: requiredOpaqueValue(token, "Zoom OAuth token", 16_384),
  });
  await zoomNoContent(
    ZOOM_REVOKE_URL,
    {
      method: "POST",
      headers: oauthRequestHeaders(client),
      body: body.toString(),
    },
    options,
  );
};

export const missingZoomOAuthScopes = (scope: string): readonly ZoomOAuthScope[] => {
  const granted = new Set(scope.trim().split(/\s+/u).filter(Boolean));
  return ZOOM_OAUTH_SCOPES.filter(candidate => !granted.has(candidate));
};

const bearerToken = (value: unknown): string =>
  requiredOpaqueValue(value, "Zoom access token", 16_384);

const apiHeaders = (accessToken: string, json = false): HeadersInit => ({
  Accept: "application/json",
  Authorization: `Bearer ${bearerToken(accessToken)}`,
  ...(json ? { "Content-Type": "application/json" } : {}),
});

export const getZoomCurrentUser = async (
  accessToken: string,
  options: ZoomRequestOptions = {},
): Promise<ZoomCurrentUser> => {
  const response = await zoomJson(
    `${ZOOM_API_URL}/users/me`,
    { method: "GET", headers: apiHeaders(accessToken) },
    options,
  );
  const id = requiredOpaqueValue(response.id, "Zoom user ID", 255);
  const accountId = requiredOpaqueValue(response.account_id, "Zoom account ID", 255);
  const email = requiredText(response.email, "Zoom user email", 320).toLowerCase();
  const status = response.status;
  if (status !== "active" && status !== "inactive" && status !== "pending") {
    throw new ZoomProviderError(
      "zoom_response_invalid",
      "Zoom returned an invalid user status.",
    );
  }
  const planType = response.type;
  if (planType !== 1 && planType !== 2 && planType !== 4 && planType !== 99) {
    throw new ZoomProviderError(
      "zoom_response_invalid",
      "Zoom returned an invalid user plan type.",
    );
  }
  const displayName =
    typeof response.display_name === "string" && response.display_name.trim()
      ? requiredText(response.display_name, "Zoom display name", 255)
      : email;
  const timezone =
    typeof response.timezone === "string" && response.timezone.trim()
      ? requiredText(response.timezone, "Zoom timezone", 255)
      : null;
  return { id, accountId, email, displayName, status, planType, timezone };
};

const normalizedStartTime = (value: unknown): string => {
  const candidate = requiredOpaqueValue(value, "Zoom meeting start time", 64);
  const timestamp = Date.parse(candidate);
  if (!Number.isFinite(timestamp)) return invalidInput("Zoom meeting start time is invalid.");
  return new Date(timestamp).toISOString();
};

const durationMinutes = (value: unknown): number => {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > 1_440) {
    return invalidInput("Zoom meeting duration is invalid.");
  }
  return value;
};

const meetingIdentifier = (value: unknown): string => {
  let candidate: string;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      return invalidInput("Zoom meeting ID is invalid.");
    }
    candidate = String(value);
  } else {
    candidate = requiredOpaqueValue(value, "Zoom meeting ID", 11);
  }
  if (!/^\d{9,11}$/u.test(candidate)) return invalidInput("Zoom meeting ID is invalid.");
  return candidate;
};

export const normalizeZoomJoinUrl = (value: unknown): string | null => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4_096 ||
    value.trim() !== value
  ) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const zoomHost = url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !zoomHost ||
    !/^\/j\/\d{9,11}\/?$/u.test(url.pathname)
  ) return null;
  for (const key of url.searchParams.keys()) {
    if (key !== "pwd" && key !== "omn") return null;
  }
  return url.href;
};

const createdMeeting = (value: Readonly<Record<string, unknown>>): ZoomCreatedMeeting => {
  const id = meetingIdentifier(value.id);
  const uuid = requiredOpaqueValue(value.uuid, "Zoom meeting UUID", 255);
  const joinUrl = normalizeZoomJoinUrl(value.join_url);
  if (!joinUrl) {
    throw new ZoomProviderError(
      "zoom_response_invalid",
      "Zoom returned an invalid meeting join URL.",
    );
  }
  return { id, uuid, joinUrl };
};

export const createZoomMeeting = async (
  accessToken: string,
  input: ZoomMeetingCreateInput,
  options: ZoomRequestOptions = {},
): Promise<ZoomCreatedMeeting> => {
  const body = {
    topic: requiredText(input.topic, "Zoom meeting topic", 200),
    type: 2,
    start_time: normalizedStartTime(input.startTime),
    duration: durationMinutes(input.durationMinutes),
    timezone: "UTC",
    default_password: true,
    ...(input.agenda === undefined ? {} : { agenda: optionalAgenda(input.agenda) }),
    // TAP owns the Google Calendar event and attendee notifications. Do not let
    // Zoom's optional calendar integration create or mutate a second event.
    settings: { push_change_to_calendar: false },
  };
  const response = await zoomJson(
    `${ZOOM_API_URL}/users/me/meetings`,
    {
      method: "POST",
      headers: apiHeaders(accessToken, true),
      body: JSON.stringify(body),
    },
    options,
  );
  return createdMeeting(response);
};

export const updateZoomMeeting = async (
  accessToken: string,
  meetingId: string,
  input: ZoomMeetingUpdateInput,
  options: ZoomRequestOptions = {},
): Promise<void> => {
  const changes = {
    ...(input.topic === undefined
      ? {}
      : { topic: requiredText(input.topic, "Zoom meeting topic", 200) }),
    ...(input.startTime === undefined
      ? {}
      : { start_time: normalizedStartTime(input.startTime), timezone: "UTC" }),
    ...(input.durationMinutes === undefined
      ? {}
      : { duration: durationMinutes(input.durationMinutes) }),
    ...(input.agenda === undefined ? {} : { agenda: optionalAgenda(input.agenda) }),
  };
  if (Object.keys(changes).length === 0) {
    return invalidInput("At least one Zoom meeting field must be updated.");
  }
  const body = {
    ...changes,
    settings: { push_change_to_calendar: false },
  };
  await zoomNoContent(
    `${ZOOM_API_URL}/meetings/${meetingIdentifier(meetingId)}`,
    {
      method: "PATCH",
      headers: apiHeaders(accessToken, true),
      body: JSON.stringify(body),
    },
    options,
  );
};

export const deleteZoomMeeting = async (
  accessToken: string,
  meetingId: string,
  options: ZoomRequestOptions = {},
): Promise<void> => {
  await zoomNoContent(
    `${ZOOM_API_URL}/meetings/${meetingIdentifier(meetingId)}`,
    { method: "DELETE", headers: apiHeaders(accessToken) },
    options,
  );
};
