import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectMatchingAlert,
  hasAuthorizationDecision,
  STORAGE_KEY,
  STORAGE_NAMESPACE,
} from "./pyre-test-support";

test("keeps a denied file and receipt outside VFS and durable state", async ({
  surface,
  tap,
}) => {
  await surface
    .getByRole("button", { name: /^Evidence(?:\s+\d+)?$/u })
    .click();
  await surface
    .getByRole("button", { name: "Add Evidence", exact: true })
    .click();
  await surface.getByLabel("Evidence title").fill("Denied fixture upload");
  await surface.getByLabel("Capture file").setInputFiles({
    name: "denied-evidence.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("deterministic denied evidence"),
  });
  await surface
    .getByRole("button", { name: "Capture Evidence", exact: true })
    .click();
  await expectMatchingAlert(
    surface,
    /File capture failed.*permission is not granted/iu,
  );

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
      actionId: "vfs.write",
      allowed: false,
      kind: "host-action",
    }),
  ).toBe(true);
});
