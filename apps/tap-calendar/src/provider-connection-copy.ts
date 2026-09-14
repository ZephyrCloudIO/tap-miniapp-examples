import { CalendarGatewayError } from "./gateway";

export type ProviderConnectionStep = "connect" | "import" | "refresh";

export function providerUnavailableDescription(localConnectorAvailable: boolean): string {
  return localConnectorAvailable
    ? "Use the local test connection below."
    : "Choose another provider to continue.";
}

export function providerConnectionErrorMessage(
  cause: unknown,
  providerName: string,
  step: ProviderConnectionStep,
): string {
  if (cause instanceof CalendarGatewayError) {
    if (cause.code === "authorization_pending") {
      return `Finish connecting ${providerName} in your browser, then try again.`;
    }
    if (cause.code === "oauth_state_invalid") {
      return `This ${providerName} connection request expired. Start the connection again.`;
    }
    if (cause.code === "provider_unconfigured" || cause.code === "provider_adapter_unavailable") {
      return `${providerName} isn't available right now. Try again later.`;
    }
    if (cause.code === "provider_access_denied") {
      return `${providerName} denied calendar access. Review the requested access and try again.`;
    }
    if (cause.code === "provider_rate_limited") {
      return `${providerName} is receiving too many requests. Wait a moment and try again.`;
    }
    if (
      cause.code === "organizer_auth_required" ||
      cause.code === "host_http_unavailable" ||
      cause.code === "credentials_use_denied"
    ) {
      return "Your TAP session couldn't authorize this connection. Reopen TAP Calendar and try again.";
    }
  }

  const action = step === "connect"
    ? "start the connection"
    : step === "refresh"
      ? "look for new calendars"
      : "import your calendars";
  return `TAP Calendar couldn't ${action} with ${providerName}. Try again.`;
}
