import {
  expect,
  type TapMiniappTestFixture,
  type TapMiniappTestFixtureLedger,
  type TapMiniappTestFixtureSnapshot,
  type TapRstestFixtures,
} from "@theaiplatform/miniapp-sdk/testing/rstest";

export const PACKAGE_ID = "github-notify";
export const SURFACE_ID = "github-notify-dashboard";
export const TARGET = "desktop";
export const STORAGE_NAMESPACE = "github-notify";
export const SETTINGS_KEY = "settings";

type TapSurface = TapRstestFixtures["surface"];

export function expectDeniedRun(
  tap: TapMiniappTestFixture,
  expected: {
    readonly matrixEntryId: string;
    readonly profileId: string;
    readonly permissionScenario: string;
  },
): void {
  expect({
    matrixEntryId: tap.matrixEntryId,
    mode: tap.mode,
    packageId: tap.packageId,
    permissionScenario: tap.permissionScenario,
    profileId: tap.profileId,
    surfaceId: tap.surfaceId,
    target: tap.target,
  }).toEqual({
    ...expected,
    mode: "surface",
    packageId: PACKAGE_ID,
    surfaceId: SURFACE_ID,
    target: TARGET,
  });
}

/** Wait for the access dialog that opens on mount, then ask to use TAP's GitHub connection. */
export async function allowTapGithubAccess(surface: TapSurface): Promise<void> {
  await expect(surface.getByTestId("pr-radar-shell")).toBeVisible();
  await expect(surface.getByTestId("pr-radar-access-choices")).toBeVisible();
  // The button stays disabled while the mount-time connection probe is in flight.
  await expect(surface.getByTestId("pr-radar-use-tap")).toBeEnabled();
  await surface.getByTestId("pr-radar-use-tap").click();
}

/** Access was refused: the dialog keeps offering the choice and the app body stays locked. */
export async function expectAccessStillRequired(surface: TapSurface): Promise<void> {
  await expect(surface.getByTestId("pr-radar-access-choices")).toBeVisible();
  await expect(surface.getByTestId("pr-radar-access-btn")).toHaveAttribute(
    "data-connected",
    "false",
  );
  await expect(surface.getByTestId("pr-radar-tracking")).toBeHidden();
  await expect(surface.getByTestId("pr-radar-pulls")).toBeHidden();
}

export function settingsRecord(
  snapshot: TapMiniappTestFixtureSnapshot,
): TapMiniappTestFixtureSnapshot["state"]["storage"][number] | undefined {
  return snapshot.state.storage.find(
    (entry) =>
      entry.packageId === PACKAGE_ID &&
      entry.namespace === STORAGE_NAMESPACE &&
      entry.key === SETTINGS_KEY,
  );
}

export function hasAuthorizationDecision(
  entries: TapMiniappTestFixtureLedger["entries"],
  expected: {
    readonly actionId: string;
    readonly allowed: boolean;
    readonly kind: "host-action" | "platform";
  },
): boolean {
  return entries.some(
    (entry) =>
      entry.kind === expected.kind &&
      entry.operation === "authorization.check" &&
      typeof entry.detail === "object" &&
      entry.detail !== null &&
      !Array.isArray(entry.detail) &&
      Reflect.get(entry.detail, "actionId") === expected.actionId &&
      Reflect.get(entry.detail, "allowed") === expected.allowed,
  );
}
