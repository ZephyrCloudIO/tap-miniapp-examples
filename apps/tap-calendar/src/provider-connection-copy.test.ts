import { describe, expect, it } from "@rstest/core";
import { CalendarGatewayError } from "./gateway";
import {
  providerConnectionErrorMessage,
  providerUnavailableDescription,
} from "./provider-connection-copy";

describe("provider connection copy", () => {
  it("turns pending and expired authorization errors into actionable copy", () => {
    expect(
      providerConnectionErrorMessage(
        new CalendarGatewayError(409, "authorization_pending", "Provider authorization is not complete."),
        "Google Calendar",
        "import",
      ),
    ).toBe("Finish connecting Google Calendar in your browser, then try again.");
    expect(
      providerConnectionErrorMessage(
        new CalendarGatewayError(400, "oauth_state_invalid", "The provider authorization has expired."),
        "Google Calendar",
        "connect",
      ),
    ).toBe("This Google Calendar connection request expired. Start the connection again.");
  });

  it("never exposes gateway implementation details", () => {
    const message = providerConnectionErrorMessage(
      new CalendarGatewayError(
        503,
        "gateway_request_failed",
        "TOKEN_ENCRYPTION_KEY failed while writing the Worker D1 OAuth row with PKCE.",
      ),
      "Google Calendar",
      "connect",
    );

    expect(message).toBe("TAP Calendar couldn't start the connection with Google Calendar. Try again.");
    expect(message).not.toMatch(/PKCE|D1|Worker|TOKEN_ENCRYPTION_KEY/i);
  });

  it("gives provider-specific retry guidance for refresh failures", () => {
    expect(providerConnectionErrorMessage(new Error("network down"), "Microsoft 365", "refresh"))
      .toBe("TAP Calendar couldn't look for new calendars with Microsoft 365. Try again.");
  });

  it("keeps unavailable-provider guidance free of gateway diagnostics", () => {
    expect(providerUnavailableDescription(false)).toBe("Choose another provider to continue.");
    expect(providerUnavailableDescription(true)).toBe("Use the local test connection below.");
    expect(JSON.stringify([
      providerUnavailableDescription(false),
      providerUnavailableDescription(true),
    ])).not.toMatch(/PKCE|D1|Worker|gateway|adapter|\.dev\.vars/i);
  });
});
