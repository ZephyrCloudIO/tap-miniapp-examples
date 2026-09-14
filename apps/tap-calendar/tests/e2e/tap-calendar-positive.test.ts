import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  PACKAGE_ID,
  STORAGE_KEY,
  STORAGE_NAMESPACE,
  expectExactProvenance,
  expectReadySurface,
  hasPlatformAuthorizationDecision,
  storageRecord,
} from "./tap-calendar-test-support";

test("hydrates the seeded multi-calendar state through TAP storage", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "tap-calendar-desktop-positive",
    permissionScenario: "default",
    profileId: "tap-calendar-desktop",
    seed: 8141,
    theme: "light",
  });
  await expectReadySurface(surface);
  await expect(
    surface.getByText("Customer architecture call", { exact: true }).first(),
  ).toBeVisible();

  await expect
    .poll(async () => {
      const ledger = await tap.fixture.ledger.read();
      return hasPlatformAuthorizationDecision(ledger.entries, {
        actionId: "storage.read",
        allowed: true,
      });
    })
    .toBe(true);

  const snapshot = await tap.fixture.snapshot();
  expect(storageRecord(snapshot)).toEqual(
    expect.objectContaining({
      packageId: PACKAGE_ID,
      namespace: STORAGE_NAMESPACE,
      key: STORAGE_KEY,
      revision: 1,
      value: expect.objectContaining({
        schemaVersion: 1,
        activeView: "work-week",
      }),
    }),
  );
});

test("shows the Availability Schedule assigned to each booking page", async ({
  surface,
}) => {
  await expectReadySurface(surface);
  await surface.getByRole("button", { name: "Booking pages", exact: true }).click();

  const standard = surface.getByRole("article").filter({
    has: surface.getByRole("heading", { name: "30 minute meeting", exact: true }),
  });
  await expect(standard.getByText("Standard working hours", { exact: true })).toBeVisible();
});

test("renders a month-first public booking page powered by TAP", async ({
  surface,
}) => {
  await expectReadySurface(surface);
  await surface.getByRole("button", { name: "Booking pages", exact: true }).click();

  const eventType = surface.getByRole("article").filter({
    has: surface.getByRole("heading", { name: "30 minute meeting", exact: true }),
  });
  await eventType.getByRole("button", { name: "Preview page", exact: true }).click();

  const bookingPage = surface.getByRole("dialog", {
    name: "30 minute meeting public booking page",
  });
  await expect(
    bookingPage.getByRole("heading", { name: "30 minute meeting", exact: true }),
  ).toBeVisible();
  await expect(
    bookingPage.getByRole("heading", { name: "Select a Date & Time", exact: true }),
  ).toBeVisible();
  await expect(bookingPage.getByRole("navigation", { name: "Booking month" })).toBeVisible();
  await expect(bookingPage.getByRole("combobox", { name: "Viewer time zone" })).toBeVisible();
  const poweredByTap = bookingPage.getByRole("link", { name: /Powered by TAP/u });
  await expect(poweredByTap).toBeVisible();
  await expect(poweredByTap).toHaveAttribute("href", "https://theaiplatform.app/");
  await expect(poweredByTap).toHaveAttribute("target", "_blank");
  const privacy = bookingPage.getByRole("link", { name: "Privacy", exact: true });
  await expect(privacy).toHaveAttribute("href", "https://theaiplatform.app/privacy");
  await expect(privacy).toHaveAttribute("target", "_blank");
  await expect(bookingPage.getByRole("link", { name: "Report abuse", exact: true })).toHaveAttribute("href", "mailto:abuse@theaiplatform.app");
  await expect(bookingPage.getByText("Accessibility", { exact: true })).toHaveCount(0);

  await bookingPage.getByRole("button", { name: /Monday, August 17, 2026, view available times/u }).click();
  await bookingPage.getByRole("button", { name: /Mon, Aug 17, 9:00 AM/u }).click();
  const continueButton = bookingPage.getByRole("button", { name: "Continue", exact: true });
  await expect(continueButton).toHaveCSS("background-color", "rgb(103, 88, 232)");
  await expect(continueButton).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(continueButton).toHaveCSS("font-size", "14px");
  await expect(continueButton).toHaveCSS("font-weight", "500");
  await expect(continueButton).toHaveCSS("height", "44px");
  await expect(continueButton).toHaveCSS("border-radius", "8px");

  await continueButton.click();
  const confirmButton = bookingPage.getByRole("button", { name: "Confirm booking", exact: true });
  await expect(confirmButton).toHaveCSS("background-color", "rgb(103, 88, 232)");
  await expect(confirmButton).toHaveCSS("color", "rgb(255, 255, 255)");
});

test("scrolls long Calendar screens inside the locked TAP surface", async ({
  surface,
}) => {
  await expectReadySurface(surface);

  const content = surface.locator(".workspace-content");
  await expect
    .poll(() => surface.locator("body").evaluate(element => getComputedStyle(element).overflowY))
    .toBe("hidden");

  for (const screen of ["Availability", "Settings"] as const) {
    await surface.getByRole("button", { name: screen, exact: true }).click();
    await expect(surface.getByRole("heading", { name: screen, exact: true })).toBeVisible();
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(0);

    const dimensions = await content.evaluate(element => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

    await content.evaluate(element => element.scrollTo({ top: element.scrollHeight }));
    await expect
      .poll(() =>
        content.evaluate(
          element => element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
        ),
      )
      .toBe(true);
  }
});

test("renders and scrolls through the complete 24-hour calendar day", async ({
  surface,
}) => {
  await expectReadySurface(surface);

  const wrap = surface.locator(".time-grid-wrap");
  const firstDay = surface.locator(".day-column").first();
  await expect(firstDay.locator(".hour-line")).toHaveCount(24);
  await expect.poll(() => wrap.evaluate(element => element.scrollTop)).toBeGreaterThan(0);

  const dimensions = await wrap.evaluate(element => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

  await wrap.evaluate(element => element.scrollTo({ top: element.scrollHeight }));
  await expect(surface.locator(".time-labels").getByText("11:00 PM", { exact: true })).toBeVisible();
  const lateEvent = surface.getByRole("button", { name: /Late-night release cutoff/u });
  await expect(lateEvent).toBeVisible();
  await expect.poll(() => lateEvent.evaluate(element => {
    const eventBounds = element.getBoundingClientRect();
    const columnBounds = element.closest(".day-column")?.getBoundingClientRect();
    return columnBounds ? eventBounds.bottom <= columnBounds.bottom + 1 : false;
  })).toBe(true);
  await expect
    .poll(() => wrap.evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 1))
    .toBe(true);
});

test("searches and persists the full IANA time-zone catalog", async ({
  surface,
}) => {
  await expectReadySurface(surface);
  await surface.getByRole("button", { name: "Availability", exact: true }).click();
  await surface.getByRole("button", { name: "Add availability schedule", exact: true }).click();

  const dialog = surface.getByRole("dialog", { name: "Add an Availability Schedule" });
  const timeZone = dialog.getByRole("combobox", { name: "Time zone", exact: true });
  await timeZone.fill("Pacific (USA)");
  const pacificTime = surface.getByRole("option", {
    name: /Pacific Time \(United States\).*GMT-0[78]:00 · P[DS]T · America\/Los_Angeles/u,
  });
  await expect(pacificTime).toBeVisible();
  await timeZone.fill("PST");
  await expect(pacificTime).toBeVisible();
  await pacificTime.click();
  await expect(timeZone).toHaveValue("America/Los_Angeles");

  await timeZone.fill("Pacific Chatham");
  await expect(surface.getByRole("option", { name: /Pacific\/Chatham/u })).toBeVisible();

  await timeZone.press("Escape");
  await expect(dialog).toBeVisible();
  await timeZone.fill("Pacific Chatham");
  await surface.getByRole("option", { name: /Pacific\/Chatham/u }).click();
  await expect(timeZone).toHaveValue("Pacific/Chatham");
  await timeZone.fill("Asia Kathmandu");
  await expect(surface.getByRole("option", {
    name: /GMT\+05:45 · NPT · Asia\/Kathmandu/u,
  })).toBeVisible();
  await timeZone.press("Enter");
  await expect(timeZone).toHaveValue("Asia/Kathmandu");

  await dialog.getByRole("textbox", { name: "Schedule name", exact: true }).fill("Nepal office hours");
  const weekdayStart = dialog.getByLabel("Weekday start", { exact: true });
  await weekdayStart.fill("");
  await dialog.getByRole("button", { name: "Add schedule", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a valid weekday start time.");
  await expect(weekdayStart).toBeFocused();
  await weekdayStart.fill("09:00");
  await dialog.getByRole("button", { name: "Add schedule", exact: true }).click();
  await expect(surface.getByText("Nepal office hours", { exact: true })).toBeVisible();
  await expect(surface.getByText(/GMT\+05:45 · NPT · Asia\/Kathmandu/u).first()).toBeVisible();
});

test("configures and persists the booking policy from Availability", async ({
  surface,
  tap,
}) => {
  await expectReadySurface(surface);
  await surface.getByRole("button", { name: "Availability", exact: true }).click();

  await surface.getByRole("button", {
    name: "Configure preferred window",
    exact: true,
  }).click();
  const policy = surface.getByRole("region", {
    name: "Slot rules & conflict checks",
    exact: true,
  });
  await expect(policy.getByLabel("Preferred start", { exact: true })).toBeFocused();

  const preferredStart = policy.getByLabel("Preferred start", { exact: true });
  await preferredStart.fill("");
  await policy.getByRole("button", { name: "Save booking policy", exact: true }).click();
  await expect(policy.getByRole("alert")).toContainText("Enter a valid preferred start and end time.");
  await expect(preferredStart).toBeFocused();
  await expect(preferredStart).toHaveAttribute("aria-invalid", "true");

  await policy.getByLabel("Preferred end", { exact: true }).fill("17:00");
  await preferredStart.fill("11:00");
  await policy.getByLabel("Minimum notice", { exact: true }).selectOption("1440");
  await policy.getByLabel("Booking horizon", { exact: true }).selectOption("90");
  await policy.getByLabel("Buffer before", { exact: true }).selectOption("15");
  await policy.getByLabel("Buffer after", { exact: true }).selectOption("30");
  await policy.getByLabel("Check Zephyr Cloud for conflicts", { exact: true }).uncheck();
  await expect(policy.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await policy.getByRole("button", { name: "Save booking policy", exact: true }).click();

  await expect(surface.getByText("11:00–17:00", { exact: true })).toBeVisible();
  await expect(surface.getByText("24 hours minimum notice", { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const record = storageRecord(await tap.fixture.snapshot());
    const value = record?.value as {
      availability?: Array<{
        id?: string;
        preferredStart?: string;
        preferredEnd?: string;
        minimumNoticeMinutes?: number;
        bookingHorizonDays?: number;
        bufferBeforeMinutes?: number;
        bufferAfterMinutes?: number;
      }>;
      accounts?: Array<{
        calendars?: Array<{ id?: string; conflicts?: boolean }>;
      }>;
    } | undefined;
    const schedule = value?.availability?.find(
      candidate => candidate.id === "fixture-availability-standard",
    );
    const calendar = value?.accounts
      ?.flatMap(account => account.calendars ?? [])
      .find(candidate => candidate.id === "fixture-calendar-work");
    return { schedule, conflicts: calendar?.conflicts };
  }).toEqual({
    schedule: expect.objectContaining({
      preferredStart: "11:00",
      preferredEnd: "17:00",
      minimumNoticeMinutes: 1440,
      bookingHorizonDays: 90,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 30,
    }),
    conflicts: false,
  });

  await surface.getByRole("button", { name: "Calendar", exact: true }).click();
  await surface.getByRole("button", { name: "Availability", exact: true }).click();
  await expect(surface.getByLabel("Preferred start", { exact: true })).toHaveValue("11:00");
  await expect(surface.getByLabel("Booking horizon", { exact: true })).toHaveValue("90");
});

test("adds, edits, persists, and removes multiple daily time ranges", async ({
  surface,
  tap,
}) => {
  await expectReadySurface(surface);
  await surface.getByRole("button", { name: "Availability", exact: true }).click();

  let monday = surface.getByRole("group", { name: "Monday availability", exact: true });
  await monday.getByRole("button", { name: "Add Monday time range", exact: true }).click();
  let secondRange = monday.getByRole("group", { name: "Monday time range 2", exact: true });
  await expect(secondRange).toBeVisible();
  await expect(monday.getByText(/^Range \d+$/u)).toHaveCount(0);
  await expect(secondRange.getByLabel("Monday time range 2 start", { exact: true })).toBeFocused();

  await secondRange.getByLabel("Monday time range 2 end", { exact: true }).fill("19:00");
  await secondRange.getByLabel("Monday time range 2 start", { exact: true }).fill("18:00");
  await expect(monday.getByLabel("Monday time range 1 start", { exact: true })).toHaveValue("09:00");
  await expect.poll(async () => {
    const record = storageRecord(await tap.fixture.snapshot());
    const value = record?.value as {
      availability?: Array<{ id?: string; windows?: Array<{ day?: number; start?: string; end?: string }> }>;
    } | undefined;
    return value?.availability
      ?.find(schedule => schedule.id === "fixture-availability-standard")
      ?.windows
      ?.filter(window => window.day === 1)
      .map(window => `${window.start}-${window.end}`)
      .sort();
  }).toEqual(["09:00-17:00", "18:00-19:00"]);

  await surface.getByRole("button", { name: "Calendar", exact: true }).click();
  await surface.getByRole("button", { name: "Availability", exact: true }).click();
  monday = surface.getByRole("group", { name: "Monday availability", exact: true });
  secondRange = monday.getByRole("group", { name: "Monday time range 2", exact: true });
  await expect(secondRange.getByLabel("Monday time range 2 start", { exact: true })).toHaveValue("18:00");
  await expect(secondRange.getByLabel("Monday time range 2 end", { exact: true })).toHaveValue("19:00");

  await secondRange.getByRole("button", { name: "Remove Monday time range 2", exact: true }).click();
  await expect(monday.getByRole("group", { name: "Monday time range 2", exact: true })).toHaveCount(0);
  await expect(monday.getByRole("button", { name: "Add Monday time range", exact: true })).toBeFocused();

  const undo = surface.getByRole("button", { name: "Undo removal", exact: true });
  await expect(undo).toBeVisible();
  await undo.click();
  secondRange = monday.getByRole("group", { name: "Monday time range 2", exact: true });
  await expect(secondRange.getByLabel("Monday time range 2 start", { exact: true })).toHaveValue("18:00");
  await expect(secondRange.getByLabel("Monday time range 2 start", { exact: true })).toBeFocused();
});

test("persists date-specific travel hours in their destination time zone", async ({
  surface,
  tap,
}) => {
  await expectReadySurface(surface);
  await surface.getByRole("button", { name: "Availability", exact: true }).click();
  await surface.getByRole("button", { name: "Add override", exact: true }).click();

  const dialog = surface.getByRole("dialog", { name: "Add availability override" });
  const timeZone = dialog.getByRole("combobox", {
    name: "Override time zone",
    exact: true,
  });
  await expect(timeZone).toHaveValue("America/New_York");
  await dialog.getByLabel("Date", { exact: true }).fill("2026-08-22");
  await dialog.getByRole("textbox", { name: "Label", exact: true }).fill("London customer week");

  await timeZone.fill("Europe London");
  await surface.getByRole("option", {
    name: /GMT\+01:00 · BST · Europe\/London/u,
  }).click();
  await dialog.getByRole("checkbox", { name: "Available with custom hours" }).check();
  await dialog.getByLabel("Starts", { exact: true }).fill("10:00");
  await dialog.getByLabel("Ends", { exact: true }).fill("15:00");
  await dialog.getByRole("button", { name: "Save override", exact: true }).click();

  await expect(surface.getByText("London customer week", { exact: true })).toBeVisible();
  await expect(surface.getByText("10:00–15:00", { exact: true })).toBeVisible();
  await expect(surface.getByText(/GMT\+01:00 · BST · Europe\/London/u)).toBeVisible();
  await expect(surface.getByText("Travel hours", { exact: true })).toBeVisible();

  await expect.poll(async () => {
    const record = storageRecord(await tap.fixture.snapshot());
    const value = record?.value as {
      availability?: Array<{
        id?: string;
        overrides?: Array<{ date?: string; timezone?: string }>;
      }>;
    } | undefined;
    return value?.availability
      ?.find(schedule => schedule.id === "fixture-availability-standard")
      ?.overrides
      ?.find(override => override.date === "2026-08-22")
      ?.timezone;
  }).toBe("Europe/London");

  await surface.getByRole("button", { name: "Edit London customer week", exact: true }).click();
  await expect(
    surface.getByRole("dialog", { name: "Edit availability override" })
      .getByRole("combobox", { name: "Override time zone", exact: true }),
  ).toHaveValue("Europe/London");
});

test("manages a connected account from its accessible actions menu", async ({
  surface,
  tap,
}) => {
  await expectReadySurface(surface);
  await surface.getByRole("button", { name: "Settings", exact: true }).click();

  const trigger = surface.getByRole("button", {
    name: "Account actions for alex@example.com",
    exact: true,
  });
  await expect(trigger).toBeEnabled();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const menu = surface.getByRole("menu", {
    name: "Actions for alex@example.com",
    exact: true,
  });
  const firstItem = menu.getByRole("menuitem", {
    name: "Add calendars…",
    exact: true,
  });
  await expect(firstItem).toBeFocused();

  await firstItem.press("End");
  const removeItem = menu.getByRole("menuitem", {
    name: "Remove from TAP Calendar…",
    exact: true,
  });
  await expect(removeItem).toBeFocused();
  await removeItem.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.click();
  await menu.getByRole("menuitem", { name: "Hide all calendars", exact: true }).click();
  await expect(surface.getByLabel("Show Zephyr Cloud", { exact: true })).not.toBeChecked();

  await trigger.click();
  await menu.getByRole("menuitem", { name: "Edit display name…", exact: true }).click();
  const displayName = surface.getByRole("textbox", { name: /^Display name/u });
  await displayName.fill("Main Microsoft 365");
  await surface.getByRole("button", { name: "Save display name", exact: true }).click();

  const renamedTrigger = surface.getByRole("button", {
    name: "Account actions for Main Microsoft 365",
    exact: true,
  });
  await expect(renamedTrigger).toBeVisible();
  await renamedTrigger.click();
  await surface
    .getByRole("menu", { name: "Actions for Main Microsoft 365", exact: true })
    .getByRole("menuitem", { name: "Remove from TAP Calendar…", exact: true })
    .click();
  await expect(
    surface.getByText("Provider authorization is not revoked", { exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText(
      "This removes the last writable calendar. Scheduling will stay unavailable, and affected Event Types will pause until you add another Destination Calendar.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(surface.getByRole("button", { name: "Remove account", exact: true })).toBeEnabled();
  await surface.getByRole("button", { name: "Cancel", exact: true }).click();

  const snapshot = await tap.fixture.snapshot();
  expect(storageRecord(snapshot)).toEqual(
    expect.objectContaining({
      revision: 3,
      value: expect.objectContaining({
        accounts: expect.arrayContaining([
          expect.objectContaining({
            id: "fixture-account-microsoft",
            label: "Main Microsoft 365",
            calendars: expect.arrayContaining([
              expect.objectContaining({
                id: "fixture-calendar-work",
                visible: false,
              }),
            ]),
          }),
        ]),
      }),
    }),
  );
});

test("opens per-calendar removal from pointer and keyboard context menus", async ({
  surface,
}) => {
  await expectReadySurface(surface);

  const checkbox = surface.getByLabel("Hide Zephyr Cloud", { exact: true });
  const row = surface.locator(".calendar-toggle").filter({ has: checkbox });
  await row.click({ button: "right" });

  const menu = surface.getByRole("menu", {
    name: "Actions for Zephyr Cloud",
    exact: true,
  });
  const hideItem = menu.getByRole("menuitem", {
    name: "Hide Zephyr Cloud",
    exact: true,
  });
  const removeItem = menu.getByRole("menuitem", {
    name: "Remove from TAP Calendar…",
    exact: true,
  });
  await expect(hideItem).toBeFocused();
  await hideItem.press("End");
  await expect(removeItem).toBeFocused();
  await removeItem.press("Escape");
  await expect(checkbox).toBeFocused();

  await checkbox.press("Shift+F10");
  await menu.getByRole("menuitem", {
    name: "Remove from TAP Calendar…",
    exact: true,
  }).click();
  await expect(
    surface.getByRole("heading", { name: "Remove Zephyr Cloud?", exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText("Nothing is deleted from Microsoft 365", { exact: true }),
  ).toBeVisible();
  const confirmRemoval = surface.getByRole("button", {
    name: "Remove calendar",
    exact: true,
  });
  await expect(confirmRemoval).toBeFocused();
  await surface.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(checkbox).toBeVisible();
});

test("moves calendar ranges with one horizontal gesture", async ({ page, surface }) => {
  await expectReadySurface(surface);

  const monthButton = surface.getByRole("button", { name: "Month", exact: true });
  await monthButton.click();
  await expect(monthButton).toHaveAttribute("aria-pressed", "true");
  await expect(surface.getByRole("heading", { name: "August 2026" })).toBeVisible();

  const calendar = surface.locator(".calendar-board-gesture-surface");
  await calendar.hover();
  await page.mouse.wheel(80, 2);
  await expect(surface.getByRole("heading", { name: "September 2026" })).toBeVisible();

  await page.mouse.wheel(80, 2);
  await expect(surface.getByRole("heading", { name: "September 2026" })).toBeVisible();

  await new Promise(resolve => globalThis.setTimeout(resolve, 260));
  await page.mouse.wheel(-80, 2);
  await expect(surface.getByRole("heading", { name: "August 2026" })).toBeVisible();

  await new Promise(resolve => globalThis.setTimeout(resolve, 260));
  await page.mouse.wheel(2, 80);
  await expect(surface.getByRole("heading", { name: "August 2026" })).toBeVisible();
});
