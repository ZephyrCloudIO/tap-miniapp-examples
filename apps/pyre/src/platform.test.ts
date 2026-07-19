import { describe, expect, it } from "@rstest/core";
import { validateHttpEvidenceUrl } from "./platform";

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
