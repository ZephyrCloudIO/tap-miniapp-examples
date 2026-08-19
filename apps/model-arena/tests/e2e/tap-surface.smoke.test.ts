import { expect, describe, it } from "@rstest/core";
import type { Page } from "@rstest/playwright";

describe("Model Arena Surface Smoke Test", () => {
  it("should render the Model Arena surface", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await page.waitForSelector(".model-arena", { timeout: 10_000 });
    const title = await page.textContent("h1");
    expect(title).toContain("Model Arena");
  });

  it("should show the session ledger", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await page.waitForSelector(".session-ledger", { timeout: 10_000 });
    const ledgerText = await page.textContent(".session-ledger");
    expect(ledgerText).toBeTruthy();
  });

  it("should navigate to the composer", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await page.waitForSelector(".model-arena", { timeout: 10_000 });
    await page.click('button:has-text("New Comparison")');
    await page.waitForSelector(".session-composer", { timeout: 5_000 });
    const composerText = await page.textContent(".session-composer");
    expect(composerText).toContain("Prompt");
  });
});
