import { describe, expect, it } from "vitest";
import { crmBookingPage, resolveCrmApiUrl } from "../src/crm-config";

describe("resolveCrmApiUrl", () => {
  it("returns the production CRM origin", () => {
    expect(resolveCrmApiUrl("https://crm-api.zephyr-cloud.io")).toBe(
      "https://crm-api.zephyr-cloud.io",
    );
    expect(resolveCrmApiUrl(" https://crm-api.zephyr-cloud.io/ ")).toBe(
      "https://crm-api.zephyr-cloud.io",
    );
  });

  it("turns delivery off when unset or blank", () => {
    expect(resolveCrmApiUrl(undefined)).toBeNull();
    expect(resolveCrmApiUrl("")).toBeNull();
    expect(resolveCrmApiUrl("   ")).toBeNull();
  });

  it("rejects malformed, insecure, and credentialed URLs", () => {
    expect(resolveCrmApiUrl("not a url")).toBeNull();
    expect(resolveCrmApiUrl("http://crm-api.zephyr-cloud.io")).toBeNull();
    expect(resolveCrmApiUrl("https://user:pass@crm-api.zephyr-cloud.io")).toBeNull();
    expect(resolveCrmApiUrl("https://crm-api.zephyr-cloud.io/?key=1")).toBeNull();
  });

  it("allows plain http for a local CRM", () => {
    expect(resolveCrmApiUrl("http://localhost:8788")).toBe("http://localhost:8788");
  });
});

describe("crmBookingPage", () => {
  it("is the path below the booking origin", () => {
    expect(crmBookingPage("ada", "intro-call")).toBe("ada/intro-call");
  });
});
