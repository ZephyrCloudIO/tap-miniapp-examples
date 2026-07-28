import { describe, expect, it } from "@rstest/core";

import {
  parsePyreViewHash,
  withPyreViewHash,
} from "./view-location";

describe("Pyre view location", () => {
  it("reads only a bounded view from the document fragment", () => {
    expect(parsePyreViewHash("#view=evidence")).toBe("evidence");
    expect(parsePyreViewHash("view=audit")).toBe("audit");
    expect(parsePyreViewHash("#view=unknown")).toBe("overview");
    expect(parsePyreViewHash("")).toBe("overview");
  });

  it("preserves the host-owned query while changing only the fragment", () => {
    const href = withPyreViewHash(
      "https://miniapp.example/tap.surface.html?packageId=pyre&instanceId=fixture#view=overview",
      "timeline",
    );
    const url = new URL(href);

    expect(url.pathname).toBe("/tap.surface.html");
    expect(url.search).toBe("?packageId=pyre&instanceId=fixture");
    expect(url.hash).toBe("#view=timeline");
  });
});
