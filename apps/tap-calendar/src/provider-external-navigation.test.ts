import { describe, expect, it, rs } from "@rstest/core";
import {
  isProviderAuthorizationUrl,
  openProviderAuthorization,
  providerExternalNavigationErrorMessage,
} from "./provider-external-navigation";

const googleUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?client_id=tap&state=state-1";
const microsoftUrl =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=tap&state=state-2";

const hostActionError = (code: string): Error => {
  const error = new Error("Bounded host error");
  error.name = "MiniAppHostActionError";
  Object.defineProperty(error, "code", { value: code });
  return error;
};

describe("provider external navigation", () => {
  it("accepts only canonical HTTPS authorization URLs for the selected provider", () => {
    expect(isProviderAuthorizationUrl("google", googleUrl)).toBe(true);
    expect(isProviderAuthorizationUrl("microsoft", microsoftUrl)).toBe(true);
    expect(isProviderAuthorizationUrl("google", microsoftUrl)).toBe(false);
    expect(isProviderAuthorizationUrl("google", googleUrl.replace("https:", "http:"))).toBe(false);
    expect(isProviderAuthorizationUrl("google", "https://user:pass@accounts.google.com/oauth")).toBe(false);
    expect(isProviderAuthorizationUrl("google", "https://ACCOUNTS.GOOGLE.COM/oauth")).toBe(false);
  });

  it("passes the exact gateway URL to the host external-navigation action", async () => {
    const openExternal = rs.fn(async () => undefined);

    await expect(openProviderAuthorization({ openExternal }, "google", googleUrl))
      .resolves.toBe("opened");
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith({ url: googleUrl });
  });

  it("fails closed without invoking the host for a mismatched origin", async () => {
    const openExternal = rs.fn(async () => undefined);

    await expect(openProviderAuthorization({ openExternal }, "google", microsoftUrl))
      .resolves.toBe("origin-rejected");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("feature-detects unsupported hosts and keeps host failures bounded", async () => {
    await expect(openProviderAuthorization({}, "google", googleUrl))
      .resolves.toBe("unsupported-host");
    await expect(openProviderAuthorization({
      openExternal: () => Promise.reject(hostActionError("user-gesture-required")),
    }, "google", googleUrl)).resolves.toBe("user-gesture-required");
    await expect(openProviderAuthorization({
      openExternal: () => Promise.reject(hostActionError("authorization-denied")),
    }, "google", googleUrl)).resolves.toBe("authorization-denied");
    await expect(openProviderAuthorization({
      openExternal: () => Promise.reject(hostActionError("authorization-unavailable")),
    }, "google", googleUrl)).resolves.toBe("authorization-unavailable");
    await expect(openProviderAuthorization({
      openExternal: () => Promise.reject(hostActionError("unexpected-secret-error")),
    }, "google", googleUrl)).resolves.toBe("native-open-failed");
  });

  it("provides actionable copy without exposing host diagnostics", () => {
    expect(providerExternalNavigationErrorMessage(
      "user-gesture-required",
      "Google Calendar",
    )).toBe("Click Open Google Calendar again to continue in your browser.");
    expect(providerExternalNavigationErrorMessage(
      "unsupported-host",
      "Microsoft 365",
    )).toBe("Update TAP to open Microsoft 365 in your browser.");
    expect(providerExternalNavigationErrorMessage(
      "authorization-unavailable",
      "Google Calendar",
    )).toBe("TAP couldn't check permission to open Google Calendar. Try again.");
  });
});
