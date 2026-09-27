import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  hasHostAuthorizationDecision,
} from "./tap-calendar-test-support";

const ZOOM_AUTHORIZATION_URL =
  "https://zoom.us/oauth/authorize?client_id=tap-calendar-test&state=test-lab";

test("denies Zoom authorization navigation when all permissions are denied", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "tap-calendar-desktop-zoom-navigation-all-denied",
    permissionScenario: "all-denied",
    profileId: "tap-calendar-desktop-zoom-navigation-all-denied",
    seed: 8148,
    theme: "dark",
  });

  await surface.locator("body").evaluate((body, url) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.testid = "calendar-zoom-navigation-test";
    button.textContent = "Open Zoom authorization";
    const output = document.createElement("output");
    output.dataset.testid = "calendar-zoom-navigation-outcome";
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
  }, ZOOM_AUTHORIZATION_URL);

  await surface.getByTestId("calendar-zoom-navigation-test").click();
  await expect(
    surface.getByTestId("calendar-zoom-navigation-outcome"),
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
