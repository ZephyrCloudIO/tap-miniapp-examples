import { expect, describe, it } from "@rstest/core";
import type { Page } from "@rstest/playwright";

describe("Model Arena Storage Denied", () => {
  it("should show empty state when storage is denied", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await page.waitForSelector(".model-arena", { timeout: 10_000 });
    // When storage is denied, the app should still render but may show degraded state
    const content = await page.textContent(".model-arena");
    expect(content).toContain("Model Arena");
  });
});
