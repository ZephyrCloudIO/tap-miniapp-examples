import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";
import { hasHostAuthorizationDecision } from "./tap-calendar-test-support";

test("denies workspace member disclosure before looking up the roster", async ({ surface, tap }) => {
  expect(tap.packageId).toBe("tap-calendar");
  expect(tap.surfaceId).toBe("tap-calendar");
  expect(tap.target).toBe("desktop");
  expect(tap.matrixEntryId).toBe("tap-calendar-desktop-workspace-members-all-denied");
  expect(tap.profileId).toBe("tap-calendar-desktop-workspace-members-all-denied");
  expect(tap.permissionScenario).toBe("all-denied");

  // All-denied also blocks Calendar hydration. Exercise the actual host bridge
  // directly so the test reaches roster authorization without weakening that policy.
  await surface.locator("body").evaluate((body, workspaceId) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.testid = "calendar-workspace-members-test";
    button.textContent = "Read workspace members";
    const output = document.createElement("output");
    output.dataset.testid = "calendar-workspace-members-outcome";
    output.textContent = "idle";
    button.addEventListener("click", () => {
      const platform = Reflect.get(globalThis, Symbol.for("tap.internal.v1")) as {
        readonly workspace?: {
          readonly listMembers?: (options: { readonly workspaceId: string }) => unknown;
        };
      } | undefined;
      if (typeof platform?.workspace?.listMembers !== "function") {
        output.textContent = "unsupported-host";
        return;
      }
      output.textContent = "pending";
      void Promise.resolve().then(() => platform.workspace!.listMembers!({ workspaceId })).then(
        () => { output.textContent = "roster-disclosed"; },
        (error: unknown) => {
          const code = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
          output.textContent = typeof code === "string" ? code : "unknown-error";
        },
      );
    });
    body.append(button, output);
  }, tap.workspaceId);

  await surface.getByTestId("calendar-workspace-members-test").click();
  await expect(surface.getByTestId("calendar-workspace-members-outcome")).toHaveText("authorization-denied");
  const ledger = await tap.fixture.ledger.read();
  expect(hasHostAuthorizationDecision(ledger.entries, {
    actionId: "workspace.read-members", allowed: false,
  })).toBe(true);
  expect(ledger.entries.filter(entry => entry.operation === "workspace.list-members")).toHaveLength(0);
});
