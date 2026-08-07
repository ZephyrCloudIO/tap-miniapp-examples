import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  hasHostAuthorizationDecision,
  hasPlatformAuthorizationDecision,
} from "./kart-royale-test-support";

test("denies platform-session use before native HTTP and keeps solo play", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, "credentials-use-denied");

  const host = surface.locator("#tap-root .kart-host");
  await expect(host).toBeAttached();
  await expect(surface.locator("#tap-error")).toBeHidden();

  const toggle = surface.locator(".kr-lobby-toggle");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(
    surface.getByText("The race server is unreachable — solo play is unaffected."),
  ).toBeVisible();

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    hasPlatformAuthorizationDecision(ledger.entries, {
      action: "tap.platform.http.request",
      actionId: "network.request",
      autonomy: "do",
      allowed: true,
    }),
  ).toBe(true);
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: "credentials.use",
      autonomy: "do",
      allowed: false,
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
