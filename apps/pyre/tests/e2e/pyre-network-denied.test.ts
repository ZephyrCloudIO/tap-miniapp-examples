import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectMatchingAlert,
  hasAuthorizationDecision,
  openHttpCollection,
  openPlatform,
  STORAGE_KEY,
  STORAGE_NAMESPACE,
} from "./pyre-test-support";

test("blocks denied GitHub HTTP before consuming a route or writing VFS", async ({
  surface,
  tap,
}) => {
  await openPlatform(surface);
  await openHttpCollection(surface);
  await surface
    .getByRole("button", { name: "Collect & Capture", exact: true })
    .click();
  await expectMatchingAlert(
    surface,
    /Governed HTTP evidence collection failed.*did not allow this network origin/iu,
  );

  expect((await tap.fixture.http.requests()).requests).toEqual([]);
  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.vfsFiles).toEqual([]);
  expect(
    snapshot.state.storage.find(
      (entry) =>
        entry.namespace === STORAGE_NAMESPACE && entry.key === STORAGE_KEY,
    )?.revision,
  ).toBe(1);
  expect(
    hasAuthorizationDecision((await tap.fixture.ledger.read()).entries, {
      actionId: "network.request",
      allowed: true,
      autonomy: "do",
      kind: "platform",
    }),
  ).toBe(true);
});
