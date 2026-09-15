import { describe, expect, it, vi } from "vitest";
import {
  ZOOM_OAUTH_SCOPES,
  ZoomProviderError,
  buildZoomAuthorizationUrl,
  createZoomMeeting,
  deleteZoomMeeting,
  exchangeZoomAuthorizationCode,
  getZoomCurrentUser,
  missingZoomOAuthScopes,
  normalizeZoomJoinUrl,
  refreshZoomAccessToken,
  revokeZoomToken,
  type ZoomFetch,
  type ZoomOAuthClientConfig,
  updateZoomMeeting,
} from "../src/zoom-provider";

const config: ZoomOAuthClientConfig = {
  clientId: "zoom-client-id",
  clientSecret: "zoom-client-secret",
  redirectUri: "https://calendar-gateway.test/v1/oauth/zoom/callback",
};

const challenge = "c".repeat(43);
const verifier = "v".repeat(64);
const allScopes = ZOOM_OAUTH_SCOPES.join(" ");

const responseJson = (value: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(value), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });

const tokenResponse = (accessToken: string, refreshToken: string): Response =>
  responseJson({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 3_600,
    token_type: "bearer",
    scope: allScopes,
    api_url: "https://api.zoom.us",
  });

describe("Zoom OAuth helpers", () => {
  it("builds a PKCE authorization URL with an exact redirect URI and state", () => {
    const value = buildZoomAuthorizationUrl(config, {
      state: "state-value",
      codeChallenge: challenge,
    });
    const url = new URL(value);

    expect(url.origin + url.pathname).toBe("https://zoom.us/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "zoom-client-id",
      redirect_uri: config.redirectUri,
      state: "state-value",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
  });

  it("rejects insecure non-local redirect URIs and malformed PKCE challenges", () => {
    expect(() =>
      buildZoomAuthorizationUrl(
        { ...config, redirectUri: "http://calendar-gateway.test/callback" },
        { state: "state", codeChallenge: challenge },
      ),
    ).toThrowError(ZoomProviderError);
    expect(() =>
      buildZoomAuthorizationUrl(config, { state: "state", codeChallenge: "too-short" }),
    ).toThrowError(ZoomProviderError);

    expect(
      buildZoomAuthorizationUrl(
        { ...config, redirectUri: "http://localhost:8787/v1/oauth/zoom/callback" },
        { state: "state", codeChallenge: challenge },
      ),
    ).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A8787");
  });

  it("exchanges a code using HTTP Basic and never places client credentials in the form body", async () => {
    const provider = vi.fn<ZoomFetch>(async () => tokenResponse("access-1", "refresh-1"));

    const token = await exchangeZoomAuthorizationCode(
      config,
      { code: "authorization-code", codeVerifier: verifier },
      { fetch: provider, nowMs: Date.parse("2026-09-14T12:00:00.000Z") },
    );

    expect(token).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: "2026-09-14T13:00:00.000Z",
      tokenType: "Bearer",
      scope: allScopes,
    });
    expect(provider).toHaveBeenCalledOnce();
    const [requestUrl, init] = provider.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    const body = new URLSearchParams(String(init?.body));
    expect(String(requestUrl)).toBe("https://zoom.us/oauth/token");
    expect(init?.method).toBe("POST");
    expect(headers.get("Authorization")).toBe(
      `Basic ${btoa("zoom-client-id:zoom-client-secret")}`,
    );
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("authorization-code");
    expect(body.get("code_verifier")).toBe(verifier);
    expect(body.get("redirect_uri")).toBe(config.redirectUri);
    expect(body.has("client_id")).toBe(false);
    expect(body.has("client_secret")).toBe(false);
  });

  it("returns Zoom's newest rotating refresh token", async () => {
    const provider = vi.fn<ZoomFetch>(async () => tokenResponse("access-2", "refresh-2"));

    const token = await refreshZoomAccessToken(config, "refresh-1", {
      fetch: provider,
      nowMs: Date.parse("2026-09-14T13:00:00.000Z"),
    });

    expect(token.refreshToken).toBe("refresh-2");
    expect(token.expiresAt).toBe("2026-09-14T14:00:00.000Z");
    const body = new URLSearchParams(String(provider.mock.calls[0]![1]?.body));
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
    });
  });

  it("revokes a token using HTTP Basic and a form body", async () => {
    const provider = vi.fn<ZoomFetch>(async () => new Response(null, { status: 204 }));

    await revokeZoomToken(config, "access-token", { fetch: provider });

    const [requestUrl, init] = provider.mock.calls[0]!;
    expect(String(requestUrl)).toBe("https://zoom.us/oauth/revoke");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Basic ${btoa("zoom-client-id:zoom-client-secret")}`,
    );
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      token: "access-token",
    });
  });

  it("reports missing granular scopes", () => {
    expect(missingZoomOAuthScopes(allScopes)).toEqual([]);
    expect(missingZoomOAuthScopes("user:read:user meeting:write:meeting")).toEqual([
      "meeting:update:meeting",
      "meeting:delete:meeting",
    ]);
  });
});

describe("Zoom API helpers", () => {
  it("discovers only the allowlisted current-user identity fields", async () => {
    const provider = vi.fn<ZoomFetch>(async () =>
      responseJson({
        id: "zoom-user-1",
        account_id: "zoom-account-1",
        email: "Host@Example.COM",
        display_name: "Zoom Host",
        status: "active",
        type: 2,
        timezone: "America/New_York",
        host_key: "must-not-escape",
      }),
    );

    const user = await getZoomCurrentUser("access-token", { fetch: provider });

    expect(user).toEqual({
      id: "zoom-user-1",
      accountId: "zoom-account-1",
      email: "host@example.com",
      displayName: "Zoom Host",
      status: "active",
      planType: 2,
      timezone: "America/New_York",
    });
    expect(user).not.toHaveProperty("hostKey");
    const [requestUrl, init] = provider.mock.calls[0]!;
    expect(String(requestUrl)).toBe("https://api.zoom.us/v2/users/me");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer access-token");
  });

  it("creates a scheduled UTC meeting and never exposes the host start URL", async () => {
    const provider = vi.fn<ZoomFetch>(async () =>
      responseJson(
        {
          id: 12_345_678_901,
          uuid: "meeting-uuid",
          join_url: "https://us06web.zoom.us/j/12345678901?pwd=abc_123",
          start_url: "https://zoom.us/s/host-secret",
          password: "secret",
        },
        { status: 201 },
      ),
    );

    const meeting = await createZoomMeeting(
      "access-token",
      {
        topic: "Architecture call",
        agenda: "Discuss the deployment.",
        startTime: "2026-09-20T10:00:00-04:00",
        durationMinutes: 45,
      },
      { fetch: provider },
    );

    expect(meeting).toEqual({
      id: "12345678901",
      uuid: "meeting-uuid",
      joinUrl: "https://us06web.zoom.us/j/12345678901?pwd=abc_123",
    });
    expect(meeting).not.toHaveProperty("startUrl");
    const [requestUrl, init] = provider.mock.calls[0]!;
    expect(String(requestUrl)).toBe("https://api.zoom.us/v2/users/me/meetings");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer access-token");
    expect(JSON.parse(String(init?.body))).toEqual({
      topic: "Architecture call",
      type: 2,
      start_time: "2026-09-20T14:00:00.000Z",
      duration: 45,
      timezone: "UTC",
      default_password: true,
      agenda: "Discuss the deployment.",
      settings: { push_change_to_calendar: false },
    });
  });

  it("updates and deletes an exact numeric meeting ID", async () => {
    const provider = vi.fn<ZoomFetch>(async () => new Response(null, { status: 204 }));

    await updateZoomMeeting(
      "access-token",
      "12345678901",
      {
        topic: "Updated call",
        agenda: "",
        startTime: "2026-09-21T15:00:00.000Z",
        durationMinutes: 60,
      },
      { fetch: provider },
    );
    await deleteZoomMeeting("access-token", "12345678901", { fetch: provider });

    expect(provider).toHaveBeenCalledTimes(2);
    expect(String(provider.mock.calls[0]![0])).toBe(
      "https://api.zoom.us/v2/meetings/12345678901",
    );
    expect(provider.mock.calls[0]![1]?.method).toBe("PATCH");
    expect(JSON.parse(String(provider.mock.calls[0]![1]?.body))).toEqual({
      topic: "Updated call",
      start_time: "2026-09-21T15:00:00.000Z",
      timezone: "UTC",
      duration: 60,
      agenda: "",
      settings: { push_change_to_calendar: false },
    });
    expect(String(provider.mock.calls[1]![0])).toBe(
      "https://api.zoom.us/v2/meetings/12345678901",
    );
    expect(provider.mock.calls[1]![1]?.method).toBe("DELETE");
  });

  it("rejects an empty update and path-shaped meeting IDs before fetching", async () => {
    const provider = vi.fn<ZoomFetch>(async () => new Response(null, { status: 204 }));

    await expect(
      updateZoomMeeting("access-token", "12345678901", {}, { fetch: provider }),
    ).rejects.toMatchObject({ code: "zoom_invalid_input" });
    await expect(
      deleteZoomMeeting("access-token", "../users/me", { fetch: provider }),
    ).rejects.toMatchObject({ code: "zoom_invalid_input" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("preserves bounded provider error metadata without returning raw bodies", async () => {
    const provider = vi.fn<ZoomFetch>(async () =>
      responseJson(
        { code: 4_711, message: "Invalid refresh token." },
        { status: 400, headers: { "Retry-After": "17" } },
      ),
    );

    await expect(refreshZoomAccessToken(config, "refresh-1", { fetch: provider })).rejects
      .toMatchObject({
        code: "zoom_request_failed",
        providerStatus: 400,
        providerCode: 4_711,
        retryAfterSeconds: 17,
        message: "Invalid refresh token.",
      });
  });
});

describe("normalizeZoomJoinUrl", () => {
  it.each([
    "https://zoom.us/j/123456789",
    "https://us06web.zoom.us/j/12345678901?pwd=abc_DEF-123",
    "https://acme.zoom.us/j/12345678901?omn=987654321",
  ])("accepts a Zoom-created join URL: %s", value => {
    expect(normalizeZoomJoinUrl(value)).toBe(value);
  });

  it.each([
    "http://zoom.us/j/12345678901",
    "https://zoom.us.evil.example/j/12345678901",
    "https://evilzoom.us/j/12345678901",
    "https://user:password@zoom.us/j/12345678901",
    "https://zoom.us:444/j/12345678901",
    "https://zoom.us/j/not-a-meeting",
    "https://zoom.us/wc/12345678901/join",
    "https://zoom.us/j/12345678901?redirect=https://evil.example",
    "https://zoom.us/j/12345678901#fragment",
    " https://zoom.us/j/12345678901",
  ])("rejects an untrusted or noncanonical URL: %s", value => {
    expect(normalizeZoomJoinUrl(value)).toBeNull();
  });
});
