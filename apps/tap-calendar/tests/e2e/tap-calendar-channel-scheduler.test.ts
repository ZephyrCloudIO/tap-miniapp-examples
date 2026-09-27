import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
} from "./tap-calendar-test-support";

test("renders an honest channel scheduler without creating a booking", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "tap-calendar-channel-scheduler",
    permissionScenario: "default",
    profileId: "tap-calendar-channel-scheduler",
    seed: 8144,
    theme: "dark",
    surfaceId: "tap-calendar-channel-scheduler",
    viewport: { width: 520, height: 900 },
  });

  await expect(surface.locator(".channel-scheduler-surface")).toBeVisible();
  await expect(
    surface.getByRole("heading", { name: "Schedule a meeting", exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText(/nobody is selected automatically/u).first(),
  ).toBeVisible();
  const channelInvitees = surface.getByRole("checkbox", { name: /^Invite /u });
  const inviteeCount = await channelInvitees.count();
  for (let index = 0; index < inviteeCount; index += 1) {
    await expect(channelInvitees.nth(index)).not.toBeChecked();
  }

  const submit = surface.getByRole("button", {
    name: "Schedule meeting",
    exact: true,
  });
  await expect(submit).toBeDisabled();
  await surface.getByRole("button", { name: "Add external guest", exact: true }).click();
  await surface.getByRole("textbox", { name: "Name", exact: true }).fill("Jordan Lee");
  await surface.getByRole("textbox", { name: "Email", exact: true }).fill("jordan@example.com");
  await surface.getByRole("textbox", { name: "Meeting title", exact: true }).fill("Channel planning");

  const starts = surface.getByLabel("Starts", { exact: true });
  const duration = surface.getByLabel("Duration", { exact: true });
  const location = surface.getByLabel("Location", { exact: true });
  await expect(starts).toBeVisible();
  await expect(duration).toHaveValue("30");
  await expect(location).toHaveValue("google-meet");
  await expect(location.locator("option")).toHaveCount(1);
  await expect(surface.getByText(
    "Google Meet is included with your Google Destination Calendar. Connect Zoom in Settings to use it.",
    { exact: true },
  )).toBeVisible();
  await duration.selectOption("60");
  await expect(duration).toHaveValue("60");
  await expect(surface.locator(".mutual-slot-summary")).toContainText("60 minutes");

  const sharedControlLayout = await surface.locator(".date-duration-grid").evaluate(element => {
    const startControl = element.querySelector<HTMLElement>('[name="schedule-start"]');
    const durationControl = element.querySelector<HTMLElement>('[name="schedule-duration"]');
    if (!startControl || !durationControl) throw new Error("Scheduling controls were not rendered.");
    const startBounds = startControl.getBoundingClientRect();
    const durationBounds = durationControl.getBoundingClientRect();
    return {
      heightDifference: Math.abs(startBounds.height - durationBounds.height),
      widthDifference: Math.abs(startBounds.width - durationBounds.width),
      stacked: durationBounds.top >= startBounds.bottom,
    };
  });
  expect(sharedControlLayout.stacked).toBe(true);
  expect(sharedControlLayout.heightDifference).toBeLessThanOrEqual(1);
  expect(sharedControlLayout.widthDifference).toBeLessThanOrEqual(1);

  const scroller = surface.locator(".channel-scheduler-main");
  const dimensions = await scroller.evaluate(element => ({
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  await scroller.evaluate(element => element.scrollTo({ top: element.scrollHeight }));
  await expect.poll(() => scroller.evaluate(
    element => element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
  )).toBe(true);

  // Deliberately do not choose a time or submit: Surface Test Lab must never
  // create a real provider booking while validating this channel interaction.
  await expect(submit).toBeDisabled();
});
