import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  expectReadySurface,
  storageRecord,
} from "./tap-calendar-test-support";

test("renders honest first-run states without demo customer data", async ({ surface, tap }) => {
  expectExactProvenance(tap, {
    matrixEntryId: "tap-calendar-desktop-empty",
    permissionScenario: "default",
    profileId: "tap-calendar-desktop-empty",
    seed: 8143,
    theme: "light",
  });
  await expectReadySurface(surface);
  await expect(surface.getByRole("heading", { name: "Connect your first calendar", exact: true })).toBeVisible();
  await expect(surface.getByText("Customer architecture call", { exact: true })).toHaveCount(0);
  await expect(surface.getByText("Alex Morgan", { exact: true })).toHaveCount(0);

  for (const [screen, emptyHeading] of [
    ["Availability", "Set your availability"],
    ["Booking pages", "Create your first booking page"],
    ["Notifications", "Create your personal TAP Calendar channel"],
    ["Settings", "No calendar accounts connected"],
  ] as const) {
    await surface.getByRole("button", { name: screen, exact: true }).click();
    await expect(surface.getByRole("heading", { name: emptyHeading, exact: true })).toBeVisible();
  }
});

test("adds several calendars and persists another calendar on the same account", async ({ surface, tap }) => {
  await expectReadySurface(surface);
  await surface.getByRole("button", { name: "Add calendar account", exact: true }).first().click();
  await expect(surface.getByRole("dialog", { name: "Add a calendar account" })).toBeVisible();
  await surface.locator('input[name="account-label"]').fill("me@example.com");
  await surface.locator('input[name="calendar-name-0"]').fill("Primary");
  await surface.getByRole("button", { name: "Add another calendar", exact: true }).click();
  await surface.locator('input[name="calendar-name-1"]').fill("Shared availability");
  await surface.locator(".calendar-draft-card").nth(1).getByRole("combobox", { name: "Access" }).selectOption("reader");
  await surface.getByRole("button", { name: "Add account & calendars", exact: true }).click();

  await expect(surface.getByText("me@example.com", { exact: true }).first()).toBeVisible();
  await expect(surface.getByText("Primary", { exact: true }).first()).toBeVisible();
  await expect(surface.getByText("Shared availability", { exact: true }).first()).toBeVisible();

  await surface.getByRole("button", { name: "Settings", exact: true }).click();
  await surface.getByRole("button", { name: "Account actions for me@example.com", exact: true }).click();
  await surface.getByRole("menuitem", { name: "Add calendars…", exact: true }).click();
  await surface.locator('input[name="calendar-name-0"]').fill("Projects");
  await surface.getByRole("button", { name: "Add calendars", exact: true }).click();
  await expect(surface.getByText("Projects", { exact: true }).first()).toBeVisible();

  const snapshot = await tap.fixture.snapshot();
  expect(storageRecord(snapshot)).toEqual(expect.objectContaining({
    revision: 3,
    value: expect.objectContaining({
      accounts: [expect.objectContaining({
        label: "me@example.com",
        calendars: expect.arrayContaining([
          expect.objectContaining({ name: "Primary", destination: true }),
          expect.objectContaining({ name: "Shared availability", writable: false }),
          expect.objectContaining({ name: "Projects", destination: false }),
        ]),
      })],
    }),
  }));
});
