import { isMiniAppHostActionError } from "@theaiplatform/miniapp-sdk/sdk";

export type OAuthNavigationProvider = "google" | "microsoft";

export type ProviderExternalNavigationErrorCode =
  | "unsupported-host"
  | "authorization-denied"
  | "authorization-unavailable"
  | "user-gesture-required"
  | "stale-installation"
  | "origin-rejected"
  | "request-expired"
  | "native-open-failed";

export type ProviderExternalNavigationOutcome =
  | "opened"
  | ProviderExternalNavigationErrorCode;

/** Narrow dependency boundary for host feature detection and unit tests. */
export interface ProviderExternalNavigationApi {
  readonly openExternal?: (options: {
    readonly url: string;
  }) => void | Promise<void>;
}

const PROVIDER_AUTHORIZATION_ORIGINS = Object.freeze({
  google: "https://accounts.google.com",
  microsoft: "https://login.microsoftonline.com",
} satisfies Record<OAuthNavigationProvider, string>);

const boundedExternalNavigationError = (
  error: unknown,
): ProviderExternalNavigationErrorCode => {
  if (!isMiniAppHostActionError(error)) return "native-open-failed";
  switch (error.code) {
    case "authorization-denied":
    case "authorization-unavailable":
    case "native-open-failed":
    case "origin-rejected":
    case "request-expired":
    case "stale-installation":
    case "unsupported-host":
    case "user-gesture-required":
      return error.code;
    default:
      return "native-open-failed";
  }
};

export function isProviderAuthorizationUrl(
  provider: OAuthNavigationProvider,
  url: string,
): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.origin === PROVIDER_AUTHORIZATION_ORIGINS[provider] &&
      parsed.href === url
    );
  } catch {
    return false;
  }
}

export async function openProviderAuthorization(
  navigation: ProviderExternalNavigationApi,
  provider: OAuthNavigationProvider,
  url: string,
): Promise<ProviderExternalNavigationOutcome> {
  if (!isProviderAuthorizationUrl(provider, url)) return "origin-rejected";
  const openExternal = navigation.openExternal;
  if (typeof openExternal !== "function") return "unsupported-host";
  try {
    await openExternal({ url });
    return "opened";
  } catch (error: unknown) {
    return boundedExternalNavigationError(error);
  }
}

export function providerExternalNavigationErrorMessage(
  outcome: Exclude<ProviderExternalNavigationOutcome, "opened">,
  providerName: string,
): string {
  switch (outcome) {
    case "authorization-denied":
      return `Allow TAP to open ${providerName} in your browser, then try again.`;
    case "authorization-unavailable":
      return `TAP couldn't check permission to open ${providerName}. Try again.`;
    case "origin-rejected":
      return `${providerName} returned a sign-in link TAP can't safely open. Start the connection again.`;
    case "request-expired":
      return `The request to open ${providerName} expired. Try again.`;
    case "stale-installation":
    case "unsupported-host":
      return `Update TAP to open ${providerName} in your browser.`;
    case "user-gesture-required":
      return `Click Open ${providerName} again to continue in your browser.`;
    case "native-open-failed":
      return `TAP couldn't open ${providerName} in your browser. Try again.`;
  }
}
