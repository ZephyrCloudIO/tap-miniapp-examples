import type { CalendarProvider } from "./domain";
import type { CalendarGatewayProviderCatalog } from "./gateway";

export interface ProviderConnectionCapabilities {
  readonly localConnectorAvailable: boolean;
  readonly oauthAvailable: boolean;
  readonly providerRefreshAvailable: boolean;
}

export function providerConnectionCapabilities(
  catalog: CalendarGatewayProviderCatalog | null,
  provider: CalendarProvider,
  addingToExisting: boolean,
): ProviderConnectionCapabilities {
  const localConnectorAvailable = catalog?.localConnector === true;
  const providerStatus = catalog?.providers.find(item => item.id === provider);
  const oauthProvider = provider === "google" || provider === "microsoft";

  return {
    localConnectorAvailable,
    oauthAvailable:
      catalog !== null &&
      !addingToExisting &&
      oauthProvider &&
      providerStatus?.configured === true,
    providerRefreshAvailable:
      catalog !== null &&
      !localConnectorAvailable &&
      addingToExisting,
  };
}
