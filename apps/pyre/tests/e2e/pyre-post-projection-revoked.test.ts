import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  hasAuthorizationDecision,
} from "./pyre-test-support";

test("fails closed when runtime authority is revoked after surface projection", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    allowedOrigins: [],
    matrixEntryId: "pyre-desktop-post-projection-revoked",
    permissionScenario: "synthetic:post-projection-all-denied",
    profileId: "pyre-desktop-post-projection-revoked",
    seed: 6930,
    theme: "dark",
  });
  await expect(
    surface.getByText("Turn uncertainty into durable learning.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(surface.getByRole("alert")).toContainText(
    /Pyre could not load this workspace.*not grant this platform action/iu,
  );

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "storage.read",
      allowed: false,
      kind: "platform",
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      (entry) =>
        entry.kind === "platform" && entry.operation === "storage.get",
    ),
  ).toBe(false);
  expect((await tap.fixture.http.requests()).requests).toEqual([]);
});
