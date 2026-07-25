import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
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
  await expect(surface.getByRole("alert")).toContainText(
    /Governed HTTP evidence collection failed.*not grant this platform action/iu,
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
      allowed: false,
      kind: "platform",
    }),
  ).toBe(true);
});
