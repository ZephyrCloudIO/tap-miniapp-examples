import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  expectReadySurface,
  hasHostAuthorizationDecision,
} from "./tap-calendar-test-support";

const GOOGLE_AUTHORIZATION_URL =
  "https://accounts.google.com/o/oauth2/v2/auth?client_id=tap-calendar-test&state=test-lab";

test("denies provider browser navigation before leaving TAP", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "tap-calendar-desktop-external-navigation-denied",
    permissionScenario: "deny:navigation.open-external",
    profileId: "tap-calendar-desktop-external-navigation-denied",
    seed: 8147,
    theme: "dark",
  });
  await expectReadySurface(surface);

  await surface.locator("body").evaluate((body, url) => {
    const existing = body.querySelector("[data-testid='calendar-external-navigation-test']");
    existing?.remove();
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.testid = "calendar-external-navigation-test";
    button.textContent = "Open provider authorization";
    const output = document.createElement("output");
    output.dataset.testid = "calendar-external-navigation-outcome";
    output.textContent = "idle";
    button.addEventListener("click", () => {
      const platform = Reflect.get(
        globalThis,
        Symbol.for("tap.internal.v1"),
      ) as {
        readonly navigation?: {
          readonly openExternal?: (options: {
            readonly url: string;
          }) => void | Promise<void>;
        };
      } | undefined;
      const openExternal = platform?.navigation?.openExternal;
      if (typeof openExternal !== "function") {
        output.textContent = "unsupported-host";
        return;
      }
      output.textContent = "pending";
      void Promise.resolve(openExternal({ url })).then(
        () => {
          output.textContent = "opened";
        },
        (error: unknown) => {
          const code = typeof error === "object" && error !== null
            ? Reflect.get(error, "code")
            : undefined;
          output.textContent = typeof code === "string" ? code : "unknown-error";
        },
      );
    });
    body.append(button, output);
  }, GOOGLE_AUTHORIZATION_URL);

  await surface
    .getByTestId("calendar-external-navigation-test")
    .click();
  await expect(
    surface.getByTestId("calendar-external-navigation-outcome"),
  ).toHaveText("authorization-denied");

  await expect.poll(async () => hasHostAuthorizationDecision(
    (await tap.fixture.ledger.read()).entries,
    { actionId: "navigation.open-external", allowed: false },
  )).toBe(true);
  expect(
    (await tap.fixture.ledger.read()).entries.filter(
      entry => entry.operation === "navigation.open-external",
    ),
  ).toHaveLength(0);
});
