import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";

const PACKAGE_ID = "tap_pkg_theaiplatform_roadie_0001";
const SDK_VERSION = "0.5.0";
const SURFACE_TARGET_CELLS = new Set(["roadie\u0000desktop"]);
const PROFILE_IDS = new Set([
  "roadie-desktop-647b6525651418f87448b77f",
  "roadie-denied",
  "roadie-chat-denied",
]);
const MATRIX_ENTRY_IDS = new Set([
  "roadie-desktop-647b6525651418f87448b77f",
  "roadie-denied",
  "roadie-chat-denied",
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

test("mounts the exact declared TAP cell with reproducible provenance", async ({
  surface,
  tap,
}) => {
  expect(tap.packageId).toBe(PACKAGE_ID);
  expect(SURFACE_TARGET_CELLS.has(`${tap.surfaceId}\0${tap.target}`)).toBe(true);
  expect(PROFILE_IDS.has(tap.profileId)).toBe(true);
  expect(MATRIX_ENTRY_IDS.has(tap.matrixEntryId)).toBe(true);
  expect(tap.seed).toBe(tap.environment.seed);
  expect(tap.adapterVersion).toBe(SDK_VERSION);
  expect(tap.hostVersion).toMatch(SEMVER);
  expect(tap.hostContractVersion).toMatch(/^\d+$/u);
  expect(tap.runnerName).toBe("rstest");
  expect(tap.runnerVersion).toMatch(SEMVER);
  expect(tap.sourceDigest).toMatch(SHA256);
  expect(tap.testBundleDigest).toMatch(SHA256);
  expect(tap.descriptorDigest).toMatch(SHA256);
  expect(tap.policyDigest).toMatch(SHA256);
  if (tap.mode === "surface") expect(tap.fixtureDigest).toMatch(SHA256);
  else expect(tap.fixtureDigest).toBeUndefined();

  await tap.control.remountSurface();
  await expect(surface.locator("body")).toBeVisible();
});

test("completes the persisted Roadie journey or fails closed when storage is denied", async ({
  surface,
  tap,
}) => {
  await surface.locator('[data-testid="roadie-add-first-trip-btn"]').click();
  await surface
    .locator('[data-testid="roadie-new-trip-title"]')
    .fill("React Summit 2026 · Amsterdam");
  await surface.locator('[data-testid="roadie-confirm-new-trip-btn"]').click();

  if (tap.profileId === "roadie-denied") {
    await expect(surface.locator('[data-testid="roadie-action-error"]')).toBeVisible();
    await expect(surface.locator('[data-testid="roadie-add-pasted-item-btn"]')).toHaveCount(0);
    return;
  }

  await expect(surface.locator('[data-testid="roadie-trip-details"]')).toBeVisible();
  await surface.locator('[data-testid="roadie-load-example-btn"]').click();
  await surface.locator('[data-testid="roadie-add-pasted-item-btn"]').click();
  await expect(surface.locator('[data-testid^="roadie-timeline-item-"]')).toHaveCount(1);

  await surface.locator('[data-testid^="roadie-edit-item-btn-"]').click();
  await surface.locator('[data-testid="roadie-edit-item-title"]').fill("Updated conference talk");
  await surface.locator('[data-testid="roadie-save-edit-item-btn"]').click();
  await expect(surface.locator("body")).toContainText("Updated conference talk");

  await tap.control.remountSurface();
  await expect(surface.locator('[data-testid="roadie-trips-home"]')).toBeVisible();
  await surface.locator('[data-testid^="roadie-open-trip-btn-"]').click();
  await expect(surface.locator('[data-testid^="roadie-timeline-item-"]')).toHaveCount(1);
  await expect(surface.locator("body")).toContainText("Updated conference talk");

  await surface.locator('[data-testid="roadie-share-to-chat-btn"]').click();
  await expect(surface.locator('[data-testid="roadie-share-draft"]')).toBeVisible();
  await surface.locator('[data-testid="roadie-send-share-btn"]').click();

  if (tap.profileId === "roadie-chat-denied") {
    await expect(surface.locator('[data-testid="roadie-share-status"]')).toBeVisible();
  } else {
    await expect(surface.locator('[data-testid="roadie-share-status"]')).toContainText("Sent to");
    await expect(surface.locator('[data-testid="roadie-share-dialog"]')).toBeVisible();
    await expect(surface.locator('[data-testid="roadie-send-share-btn"]')).toContainText(
      "Send to another chat",
    );
    await surface.locator('[data-testid="roadie-cancel-share-btn"]').click();
  }

  await surface.locator('[data-testid^="roadie-delete-item-btn-"]').click();
  await surface.locator('[data-testid="roadie-confirm-delete-item-btn"]').click();
  await expect(surface.locator('[data-testid^="roadie-timeline-item-"]')).toHaveCount(0);
});
