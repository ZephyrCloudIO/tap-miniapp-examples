import { describe, expect, it } from "@rstest/core";
import type { CalendarGatewayProviderCatalog } from "./gateway";
import { providerConnectionCapabilities } from "./provider-connection-capabilities";

const catalog = (
  localConnector: boolean,
): CalendarGatewayProviderCatalog => ({
  localConnector,
  providers: [
    { id: "google", authorization: "oauth", configured: true },
    { id: "microsoft", authorization: "oauth", configured: false },
    {
      id: "icloud",
      authorization: "app-specific-password",
      configured: true,
    },
  ],
});

describe("provider connection capabilities", () => {
  it("fails closed while the provider catalog is unavailable", () => {
    expect(providerConnectionCapabilities(null, "google", false)).toEqual({
      localConnectorAvailable: false,
      oauthAvailable: false,
      providerRefreshAvailable: false,
    });
  });

  it("hides manual connectors in production while preserving configured OAuth", () => {
    expect(
      providerConnectionCapabilities(catalog(false), "google", false),
    ).toEqual({
      localConnectorAvailable: false,
      oauthAvailable: true,
      providerRefreshAvailable: false,
    });
    expect(
      providerConnectionCapabilities(catalog(false), "microsoft", false)
        .oauthAvailable,
    ).toBe(false);
    expect(
      providerConnectionCapabilities(catalog(false), "icloud", false)
        .oauthAvailable,
    ).toBe(false);
  });

  it("uses provider rediscovery instead of manual rows for existing production accounts", () => {
    expect(providerConnectionCapabilities(catalog(false), "google", true)).toEqual({
      localConnectorAvailable: false,
      oauthAvailable: false,
      providerRefreshAvailable: true,
    });
  });

  it("exposes manual calendar rows only when the gateway explicitly advertises them", () => {
    expect(providerConnectionCapabilities(catalog(true), "google", false)).toEqual({
      localConnectorAvailable: true,
      oauthAvailable: true,
      providerRefreshAvailable: false,
    });
  });
});
