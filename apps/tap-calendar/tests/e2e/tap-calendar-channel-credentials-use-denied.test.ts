import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  hasHostAuthorizationDecision,
  hasPlatformAuthorizationDecision,
} from "./tap-calendar-test-support";

test("denies the channel scheduler platform session before native HTTP", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "tap-calendar-channel-scheduler-credentials-use-denied",
    permissionScenario: "deny:credentials.use",
    profileId: "tap-calendar-channel-scheduler-credentials-use-denied",
    seed: 8146,
    theme: "dark",
    surfaceId: "tap-calendar-channel-scheduler",
    viewport: { width: 520, height: 900 },
  });
  await expect(surface.locator(".channel-scheduler-surface")).toBeVisible();

  await expect
    .poll(async () => {
      const ledger = await tap.fixture.ledger.read();
      return hasHostAuthorizationDecision(ledger.entries, {
        actionId: "credentials.use",
        allowed: false,
      });
    })
    .toBe(true);

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasPlatformAuthorizationDecision(ledger.entries, {
      actionId: "network.request",
      allowed: true,
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      (entry) =>
        entry.kind === "native" && entry.operation === "http.request",
    ),
  ).toBe(false);
  expect(await tap.fixture.http.requests()).toEqual({
    dropped: 0,
    requests: [],
  });
});
