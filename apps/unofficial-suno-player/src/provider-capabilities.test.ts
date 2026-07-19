import { describe, expect, it } from "@rstest/core";
import { inspectProviderCapabilities } from "./provider-capabilities";

describe("inspectProviderCapabilities", () => {
  it("reports portable hosts without optional HTTP capabilities", async () => {
    await expect(inspectProviderCapabilities({})).resolves.toEqual({
      hostHttp: false,
      credentialDiscovery: false,
      credentials: [],
    });
  });

  it("returns metadata-only credential summaries without copying metadata fields", async () => {
    const report = await inspectProviderCapabilities({
      http: { request: async () => { throw new Error("not called"); } },
      credentials: {
        listHttp: async () => [{
          id: "credential-ref-1",
          displayName: "Approved provider account",
          credentialType: "http_bearer",
          metadataFields: { account: "workspace-account", secret: "must-not-be-copied" },
        }],
      },
    });

    expect(report).toEqual({
      hostHttp: true,
      credentialDiscovery: true,
      credentials: [{
        id: "credential-ref-1",
        displayName: "Approved provider account",
        credentialType: "http_bearer",
      }],
    });
    expect(JSON.stringify(report)).not.toContain("must-not-be-copied");
  });
});
