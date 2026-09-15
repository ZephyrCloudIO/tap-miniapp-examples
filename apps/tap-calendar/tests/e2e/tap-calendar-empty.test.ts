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

  const meetingProviders = surface.locator(".meeting-provider-settings");
  await expect(meetingProviders.getByRole("heading", { name: "Meeting providers", exact: true })).toBeVisible();
  await expect(meetingProviders.getByText("Google Meet", { exact: true })).toBeVisible();
  await expect(meetingProviders.getByText("Zoom", { exact: true })).toBeVisible();
  await expect(meetingProviders.getByText(
    "Included automatically with your Google Destination Calendar.",
    { exact: true },
  )).toBeVisible();
});

test("guides Event Type creation to the missing Availability Schedule", async ({ surface }) => {
  await expectReadySurface(surface);

  await surface.getByRole("button", { name: "Add calendar account", exact: true }).first().click();
  const accountDialog = surface.getByRole("dialog", { name: "Add a calendar account" });
  await expect(accountDialog).toBeVisible();
  await accountDialog.locator('input[name="account-label"]').fill("me@example.com");
  await accountDialog.locator('input[name="calendar-name-0"]').fill("Primary");
  await accountDialog.getByRole("button", { name: "Add account & calendars", exact: true }).click();
  await expect(accountDialog).not.toBeVisible();

  await surface.getByRole("button", { name: "Booking pages", exact: true }).click();
  await surface.getByRole("button", { name: "New Booking Profile", exact: true }).first().click();
  const profileDialog = surface.getByRole("dialog", { name: "New Booking Profile" });
  await profileDialog.getByLabel("Display name", { exact: true }).fill("Zack");
  await profileDialog.locator('input[name="profile-slug"]').fill("zack");
  await profileDialog.getByRole("button", { name: "Create profile", exact: true }).click();

  const profile = surface.locator(".profile-panel").filter({
    has: surface.getByRole("heading", { name: "Zack", exact: true }),
  });
  await expect(profile.getByText(
    "Claim cal.with-tap.ai/zack now. You can add Event Types later.",
    { exact: true },
  )).toBeVisible();
  await expect(profile.getByRole("button", {
    name: "Claim profile",
    exact: true,
  })).toBeEnabled();
  const newEventType = profile.getByRole("button", {
    name: "New Event Type",
    exact: true,
  }).first();
  await expect(newEventType).toBeEnabled();
  await newEventType.click();

  const prerequisiteDialog = surface.getByRole("dialog", {
    name: "Availability Schedule required",
  });
  await expect(prerequisiteDialog).toBeVisible();
  await prerequisiteDialog.getByRole("button", {
    name: "Create Availability Schedule",
    exact: true,
  }).click();

  await expect(prerequisiteDialog).not.toBeVisible();
  await expect(surface.getByRole("heading", {
    name: "Availability",
    exact: true,
    level: 1,
  })).toBeVisible();
  await expect(surface.getByRole("heading", {
    name: "Set your availability",
    exact: true,
  })).toBeVisible();

  await surface.getByRole("button", {
    name: "Add availability schedule",
    exact: true,
  }).click();
  const scheduleDialog = surface.getByRole("dialog", {
    name: "Add an Availability Schedule",
  });
  await scheduleDialog.getByRole("textbox", {
    name: "Schedule name",
    exact: true,
  }).fill("Working hours");
  await scheduleDialog.getByRole("button", {
    name: "Add schedule",
    exact: true,
  }).click();

  await surface.getByRole("button", { name: "Booking pages", exact: true }).click();
  await profile.getByRole("button", {
    name: "New Event Type",
    exact: true,
  }).first().click();
  const eventTypeDialog = surface.getByRole("dialog", {
    name: "New Event Type for Zack",
  });
  const meetingProvider = eventTypeDialog.getByRole("combobox", {
    name: "Meeting provider",
    exact: true,
  });
  await expect(meetingProvider).toHaveValue("google-meet");
  await expect(meetingProvider.locator("option")).toHaveCount(1);
  await expect(eventTypeDialog.getByText(
    "Google Meet is included with your Google Destination Calendar. Connect Zoom in Settings to use it.",
    { exact: true },
  )).toBeVisible();
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
