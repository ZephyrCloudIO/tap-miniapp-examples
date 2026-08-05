import { describe, expect, it } from "@rstest/core";
import { GovernedHttpError, isGovernedUrl } from "./platform";

describe("governed origin boundary", () => {
  it("admits only the declared governed origins", () => {
    expect(isGovernedUrl("https://api.github.com/repos/example/repo/pulls/1")).toBe(true);
    expect(isGovernedUrl("https://api.github.com")).toBe(true);
    expect(isGovernedUrl("http://api.github.com/repos/example/repo")).toBe(false);
    expect(isGovernedUrl("https://github.com/example/repo")).toBe(false);
    expect(isGovernedUrl("https://example.com/api.github.com")).toBe(false);
    expect(isGovernedUrl("not a url")).toBe(false);
  });

  it("fails closed for out-of-origin reads before any host call", async () => {
    const { governedHttpRead } = await import("./platform");
    await expect(
      governedHttpRead({ url: "https://example.com/evidence" }),
    ).rejects.toBeInstanceOf(GovernedHttpError);
  });
});
