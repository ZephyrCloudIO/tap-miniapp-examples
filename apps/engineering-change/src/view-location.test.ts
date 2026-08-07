import { describe, expect, it } from "@rstest/core";
import {
  parseEngineeringChangeViewHash,
  withEngineeringChangeViewHash,
} from "./view-location";

describe("view location", () => {
  it("parses known views and falls back to overview", () => {
    expect(parseEngineeringChangeViewHash("#view=ledger")).toBe("ledger");
    expect(parseEngineeringChangeViewHash("#view=review")).toBe("review");
    expect(parseEngineeringChangeViewHash("#view=unknown")).toBe("overview");
    expect(parseEngineeringChangeViewHash("")).toBe("overview");
  });

  it("round-trips the view hash", () => {
    const href = "https://example.test/app#view=overview";
    expect(withEngineeringChangeViewHash(href, "policies")).toBe(
      "https://example.test/app#view=policies",
    );
    expect(parseEngineeringChangeViewHash("#view=change-detail")).toBe("change-detail");
  });
});
