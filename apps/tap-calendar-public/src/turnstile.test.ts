import { describe, expect, it } from "@rstest/core";
import { publicTurnstileWidgetConfiguration } from "./turnstile";

describe("public Turnstile widget configuration", () => {
  it("keeps booking and rescheduling actions distinct", () => {
    expect(publicTurnstileWidgetConfiguration("site-key", "public_booking")).toEqual({
      sitekey: "site-key",
      action: "public_booking",
      appearance: "always",
    });
    expect(
      publicTurnstileWidgetConfiguration("site-key", "public_booking_reschedule"),
    ).toEqual({
      sitekey: "site-key",
      action: "public_booking_reschedule",
      appearance: "always",
    });
  });
});
