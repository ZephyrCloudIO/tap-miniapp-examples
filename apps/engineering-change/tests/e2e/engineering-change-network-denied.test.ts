import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  GITHUB_DIFF_URL,
  hasAuthorizationDecision,
  readStoredChanges,
} from "./engineering-change-test-support";

test("blocks denied governed HTTP before consuming a route or writing state", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    allowedOrigins: [],
    matrixEntryId: "engineering-change-desktop-network-denied",
    permissionScenario: "http-denied",
    profileId: "engineering-change-desktop-network-denied",
    seed: 7117,
    theme: "dark",
  });
  await surface.getByRole("button", { name: "Evidence", exact: true }).click();
  await surface
    .getByTestId("engineering-change-evidence-diff-url")
    .fill(GITHUB_DIFF_URL);
  await surface.getByTestId("engineering-change-evidence-capture").click();
  await expect(
    surface.getByTestId("engineering-change-evidence-error"),
  ).toBeVisible();

  expect((await tap.fixture.http.requests()).requests).toEqual([]);
  const { changes, revision } = await readStoredChanges(tap);
  const change = changes[0] as { impactEvidence: unknown };
  expect(change.impactEvidence).toBeNull();
  expect(revision).toBe(1);

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "network.request",
      allowed: true,
      autonomy: "do",
      kind: "platform",
    }),
  ).toBe(true);
});
