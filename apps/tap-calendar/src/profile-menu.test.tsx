// @rstest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as actualSdk from "@theaiplatform/miniapp-sdk/sdk" with { rstest: "importActual" };
import type { CalendarAccount } from "./domain";
import { ProfileMenu } from "./profile-menu";

rs.mock("@theaiplatform/miniapp-sdk/sdk", () => ({
  ...actualSdk,
  sdk: { user: { current: async () => ({ displayName: "Alex Rivera" }) } },
}));

const account = (status: CalendarAccount["status"]): CalendarAccount => ({
  id: "account-main", provider: "google", label: "alex@example.com", status, calendars: [],
});
const onOpenSettings = rs.fn();
const onConnectCalendar = rs.fn();
const onRefresh = rs.fn();
let container: HTMLDivElement;
let root: Root;

const render = async (accounts: readonly CalendarAccount[], refreshing = false) => act(async () => root.render(
  <ProfileMenu accounts={accounts} refreshing={refreshing} onOpenSettings={onOpenSettings}
    onConnectCalendar={onConnectCalendar} onRefresh={onRefresh} />,
));
const trigger = () => container.querySelector<HTMLButtonElement>(".avatar-button")!;
const menu = () => container.querySelector('[role="menu"]');
const item = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  .find(element => element.textContent?.includes(text))!;
const openMenu = async () => act(async () => trigger().click());

beforeEach(() => {
  rs.clearAllMocks();
  rs.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  rs.unstubAllGlobals();
});

describe("Calendar account menu", () => {
  it("shows the signed-in user's initials and stays open after the avatar is clicked", async () => {
    await render([account("connected")]);
    expect(trigger().textContent).toBe("AR");
    expect(menu()).toBeNull();

    await openMenu();
    expect(menu()).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Alex Rivera");
  });

  it("runs the chosen action and closes the menu", async () => {
    await render([account("connected")]);
    for (const [label, action] of [
      ["Calendar settings", onOpenSettings],
      ["Connect a calendar", onConnectCalendar],
      ["Refresh calendars", onRefresh],
    ] as const) {
      await openMenu();
      await act(async () => item(label).click());
      expect(action).toHaveBeenCalledTimes(1);
      expect(menu()).toBeNull();
    }
  });

  it("closes on Escape and on a click outside the menu", async () => {
    await render([account("connected")]);
    await openMenu();
    await act(async () => menu()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(menu()).toBeNull();

    await openMenu();
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(menu()).toBeNull();
  });

  it("offers a reconnect shortcut for an account that needs attention", async () => {
    await render([account("attention")]);
    expect(trigger().getAttribute("aria-label")).toContain("1 account needs attention");
    await openMenu();
    await act(async () => item("Reconnect alex@example.com").click());
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("disables refresh while syncing or when no calendar is connected", async () => {
    await render([account("connected")], true);
    await openMenu();
    expect(item("Refreshing calendars").disabled).toBe(true);

    await act(async () => trigger().click());
    await render([]);
    await openMenu();
    expect(item("Refresh calendars").disabled).toBe(true);
    expect(container.textContent).toContain("No calendars connected");
  });
});
