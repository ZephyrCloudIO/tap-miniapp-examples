import type {
  MiniAppHttpCredentialMetadata,
  MiniAppPlatformApi,
} from "@theaiplatform/miniapp-sdk/sdk";

export interface ProviderCredentialSummary {
  id: string;
  displayName: string;
  credentialType: MiniAppHttpCredentialMetadata["credentialType"];
}

export interface ProviderCapabilityReport {
  hostHttp: boolean;
  credentialDiscovery: boolean;
  credentials: ProviderCredentialSummary[];
}

export const inspectProviderCapabilities = async (
  platform: Pick<MiniAppPlatformApi, "credentials" | "http">,
): Promise<ProviderCapabilityReport> => {
  const credentials = platform.credentials
    ? await platform.credentials.listHttp()
    : [];

  return {
    hostHttp: platform.http !== undefined,
    credentialDiscovery: platform.credentials !== undefined,
    credentials: credentials.map(({ id, displayName, credentialType }) => ({
      id,
      displayName,
      credentialType,
    })),
  };
};
