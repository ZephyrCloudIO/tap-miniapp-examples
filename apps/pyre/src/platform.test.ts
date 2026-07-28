import { describe, expect, it } from "@rstest/core";
import {
  normalizePyreVfsRoot,
  pyreVfsRoot,
  settleCapability,
  validateHttpEvidenceUrl,
} from "./platform";

describe("optional platform capability isolation", () => {
  it("preserves a successful capability result", async () => {
    await expect(
      settleCapability(async () => ({ workflows: [] })),
    ).resolves.toEqual({ value: { workflows: [] } });
  });

  it("captures synchronous and asynchronous capability failures", async () => {
    await expect(
      settleCapability(() => {
        throw new Error("profile unavailable");
      }),
    ).resolves.toEqual({ error: "Error: profile unavailable" });
    await expect(
      settleCapability(async () => {
        throw new Error("presence unavailable");
      }),
    ).resolves.toEqual({ error: "Error: presence unavailable" });
  });
});

describe("governed HTTP evidence policy", () => {
  it("accepts HTTPS GitHub API endpoints", () => {
    expect(validateHttpEvidenceUrl("https://api.github.com/repos/example/service/commits/main?per_page=1").origin).toBe("https://api.github.com");
  });

  it("rejects origins that are not declared in the signed package", () => {
    expect(() => validateHttpEvidenceUrl("https://example.com/evidence")).toThrow(/authorized only/);
  });

  it("rejects unsafe endpoint forms", () => {
    expect(() => validateHttpEvidenceUrl("http://api.github.com/repos/example/service")).toThrow(/must use HTTPS/);
    expect(() => validateHttpEvidenceUrl("https://token@api.github.com/repos/example/service")).toThrow(/embedded credentials/);
    expect(() => validateHttpEvidenceUrl("https://api.github.com/repos/example/service#fragment")).toThrow(/fragments/);
  });
});

describe("Pyre VFS path contract", () => {
  it("creates host-valid relative roots and upgrades the legacy leading slash", () => {
    expect(pyreVfsRoot("inc fixture/checkout")).toBe(
      "pyre/inc%20fixture%2Fcheckout",
    );
    expect(normalizePyreVfsRoot("/pyre/inc_fixture_checkout")).toBe(
      "pyre/inc_fixture_checkout",
    );
  });

  it("rejects foreign, empty, and traversing roots", () => {
    for (const value of [
      "",
      "/",
      "other/inc_fixture_checkout",
      "pyre/../outside",
      "pyre//incident",
      "pyre\\incident",
    ]) {
      expect(() => normalizePyreVfsRoot(value)).toThrow(
        "The Pyre VFS root is invalid.",
      );
    }
    expect(() => pyreVfsRoot("..")).toThrow(
      "The Pyre VFS root is invalid.",
    );
  });
});
