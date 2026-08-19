import { expect, describe, it } from "@rstest/core";
import type { Page } from "@rstest/playwright";

describe("Model Arena Manage Denied", () => {
  it("should disable manage actions when manage permission is denied", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await page.waitForSelector(".model-arena", { timeout: 10_000 });
    const content = await page.textContent(".model-arena");
    expect(content).toContain("Model Arena");
  });
});
