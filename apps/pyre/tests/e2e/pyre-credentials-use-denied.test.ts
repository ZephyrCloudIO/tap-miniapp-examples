import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  expectMatchingAlert,
  hasAuthorizationDecision,
  openHttpCollection,
  openPlatform,
  requireSingleCredentialAlias,
  selectFixtureCredential,
  STORAGE_KEY,
  STORAGE_NAMESPACE,
} from "./pyre-test-support";

test("denies the selected credential before HTTP or VFS side effects", async ({
  surface,
  tap,
}) => {
  const credentialAlias = requireSingleCredentialAlias(tap);
  expectExactProvenance(tap, {
    matrixEntryId: "pyre-desktop-credentials-use-denied",
    permissionScenario: "deny:credentials.use",
    profileId: "pyre-desktop-credentials-use-denied",
    seed: 6942,
    theme: "dark",
    allowedOrigins: ["https://api.github.com"],
    credentialAliases: [credentialAlias],
  });
  await openPlatform(surface);
  await openHttpCollection(surface);

  await selectFixtureCredential(surface, credentialAlias);
  await surface
    .getByRole("checkbox", {
      name: /Approve this exact read-only request/u,
    })
    .check();
  await expect(
    surface.getByRole("button", { name: "Collect & Capture", exact: true }),
  ).toBeEnabled();
  await surface
    .getByRole("button", { name: "Collect & Capture", exact: true })
    .click();
  await expectMatchingAlert(
    surface,
    /Governed HTTP evidence collection failed.*platform permission is not granted/iu,
  );

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "credentials.read",
      allowed: true,
      autonomy: "listen",
      kind: "platform",
    }),
  ).toBe(true);
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "network.request",
      allowed: true,
      autonomy: "do",
      kind: "platform",
    }),
  ).toBe(true);
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "credentials.use",
      allowed: false,
      autonomy: "do",
      kind: "host-action",
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
  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.vfsFiles).toEqual([]);
  expect(
    snapshot.state.storage.find(
      (entry) =>
        entry.namespace === STORAGE_NAMESPACE && entry.key === STORAGE_KEY,
    )?.revision,
  ).toBe(1);
});
