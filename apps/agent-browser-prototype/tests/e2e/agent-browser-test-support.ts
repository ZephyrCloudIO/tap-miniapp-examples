import {
  type TapMiniappTestFixtureLedger,
} from "@theaiplatform/miniapp-sdk/testing/rstest";

export function hasHostAuthorizationDecision(
  entries: TapMiniappTestFixtureLedger["entries"],
  actionId: string,
  allowed: boolean,
): boolean {
  return entries.some(
    (entry) =>
      entry.kind === "host-action" &&
      entry.operation === "authorization.check" &&
      typeof entry.detail === "object" &&
      entry.detail !== null &&
      !Array.isArray(entry.detail) &&
      Reflect.get(entry.detail, "actionId") === actionId &&
      Reflect.get(entry.detail, "allowed") === allowed,
  );
}

export function hasHostOperation(
  entries: TapMiniappTestFixtureLedger["entries"],
  operation: string,
): boolean {
  return entries.some(
    (entry) =>
      entry.kind === "host-action" && entry.operation === operation,
  );
}
