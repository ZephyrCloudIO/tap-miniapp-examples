// @rstest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import * as actualSdk from "@theaiplatform/miniapp-sdk/sdk" with { rstest: "importActual" };
import { ConnectCalendarDialog, ScheduleDialog, ZoomConnectionDialog } from "./app";
import { createCalendarGatewayClient, type CalendarGatewayMeetingProviderConnection, type CalendarGatewayTransport } from "./gateway";
import { createInitialCalendarState } from "./test-fixtures";
import { updateCalendar } from "./domain";

rs.mock("@theaiplatform/miniapp-sdk/sdk", () => ({
  ...actualSdk,
  sdk: { navigation: { openExternal: rs.fn() } },
}));

let container: HTMLDivElement;
let root: Root;
let connections: CalendarGatewayMeetingProviderConnection[];
let approved: boolean;
let calendarServiceUnavailable: boolean;
let startError: string | null;
let verifyError: string | null;
let disconnectError: string | null;
let authorizationUrl: string;
const requests: Parameters<CalendarGatewayTransport>[] = [];
const requireManage = rs.fn(async () => {});
const announce = rs.fn();
const submitMeeting = rs.fn(async () => ({ error: null, retrySameAttempt: false }));
const submitAccount = rs.fn(async () => null);
const state = updateCalendar(createInitialCalendarState(), "cal-google-main", { destination: true });
const principalAccess = {
  status: "ready" as const,
  value: { calendarIds: ["cal-google-main"], writableGoogleDestinationIds: ["cal-google-main"] },
};
const zoomConnection = (status: CalendarGatewayMeetingProviderConnection["status"]): CalendarGatewayMeetingProviderConnection => ({
  id: "zoom-account", workspaceId: "workspace", ownerPrincipalId: "user", provider: "zoom", mode: "oauth",
  label: "alex@example.com", status, createdAt: "2026-09-27T12:00:00.000Z", updatedAt: "2026-09-27T12:00:00.000Z",
});
const response = (body: unknown, status = 200) => ({ status, bodyText: JSON.stringify(body) });
const gateway = createCalendarGatewayClient({
  baseUrl: "http://127.0.0.1:8787", workspaceId: "workspace", principalId: "user",
  transport: async (...args) => {
    requests.push(args);
    const [url, request] = args;
    const path = new URL(url).pathname;
    if (path === "/health") return response({ ok: true });
    if (path === "/v1/providers") return calendarServiceUnavailable
      ? response({ error: "unavailable" }, 503)
      : response({ providers: [{ id: "google", configured: true, authorization: "oauth" }], localConnector: false });
    if (path === "/v1/oauth/zoom/start") {
      if (startError) return response({ error: startError }, 503);
      connections = [zoomConnection("pending")];
      return response({ connectionId: "zoom-account", authorizationUrl, expiresAt: "2026-09-27T12:10:00.000Z" }, 201);
    }
    if (path === "/v1/meeting-providers/connections") return response({ connections });
    if (path.endsWith("/zoom-account/verify")) {
      connections = [zoomConnection(verifyError ? "attention" : approved ? "connected" : "pending")];
      return verifyError ? response({ error: verifyError }, 409) : response({ connection: connections[0] });
    }
    if (path.endsWith("/zoom-account") && request.method === "DELETE") {
      if (disconnectError) return response({ error: disconnectError }, 409);
      connections = [];
      return { status: 204, bodyText: null };
    }
    throw new Error(`Unexpected request: ${request.method} ${path}`);
  },
});

function ConnectionHarness({ initial = "account" }: { initial?: "account" | "zoom" }) {
  const [screen, setScreen] = useState<"account" | "zoom" | "schedule">(initial);
  const [savedConnections, setSavedConnections] = useState<readonly CalendarGatewayMeetingProviderConnection[]>(connections);
  if (screen === "account") return <ConnectCalendarDialog gateway={gateway} destinationExists={true} existingAccount={null}
    onClose={() => setScreen("schedule")} onConnectZoom={() => setScreen("zoom")}
    onSubmitAccount={submitAccount} onSubmitCalendars={rs.fn(async () => null)} />;
  if (screen === "zoom") return <ZoomConnectionDialog gateway={gateway}
    connectionsState={{ status: "ready", connections: savedConnections, message: null }}
    onRefresh={async () => {
      const refreshed = await gateway.listMeetingProviderConnections();
      setSavedConnections(refreshed);
      return refreshed;
    }} onRequireManage={requireManage} onClose={() => setScreen("schedule")} announce={announce} />;
  return <ScheduleDialog state={state} principalAccess={principalAccess}
    zoomConnected={savedConnections.some(connection => connection.status === "connected")}
    initialStart="2026-10-01T09:30" onClose={() => setScreen("zoom")} onSubmit={submitMeeting} />;
}

beforeEach(() => {
  rs.clearAllMocks();
  requireManage.mockResolvedValue(undefined);
  rs.mocked(sdk.navigation.openExternal!).mockResolvedValue(undefined);
  connections = [];
  approved = false;
  calendarServiceUnavailable = false;
  startError = verifyError = disconnectError = null;
  authorizationUrl = "https://zoom.us/oauth/authorize?response_type=code&client_id=calendar&state=one";
  requests.length = 0;
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

const render = async (initial: "account" | "zoom" = "account") => act(async () => root.render(<ConnectionHarness initial={initial} />));
const click = async (text: string) => {
  const button = [...container.querySelectorAll("button")].find(element => element.textContent === text);
  expect(button, `Missing button: ${text}`).toBeDefined();
  await act(async () => button!.click());
};
const openSelect = async (name: string) => act(async () => {
  const trigger = container.querySelector<HTMLButtonElement>(`#${name}`)!;
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
});
const select = async (name: string, label: string) => {
  await openSelect(name);
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    .find(element => element.textContent === label)!;
  await act(async () => option.click());
};
const expectZoomDisabled = async () => {
  await openSelect("schedule-location");
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    .find(element => element.textContent?.startsWith("Zoom"));
  expect(option?.hasAttribute("data-disabled")).toBe(true);
};
const requestsTo = (path: string) => requests.filter(([url]) => new URL(url).pathname === path);

describe("Zoom account connection", () => {
  it("connects from the account chooser and makes Zoom usable for a scheduled meeting", async () => {
    await render();
    expect(container.textContent).toContain("Add an account");
    await select("calendar-account-provider", "Zoom");
    expect(container.textContent).toContain("Connect Zoom");
    expect(container.querySelector('[name="account-label"]')).toBeNull();
    await click("Connect Zoom");
    const start = requestsTo("/v1/oauth/zoom/start");
    expect(start).toHaveLength(1);
    expect(JSON.parse(start[0]![1].body!)).toMatchObject({ id: expect.stringMatching(/^zoom-/), label: "Zoom" });
    expect(requireManage).toHaveBeenCalledTimes(1);
    await click("Open Zoom");
    expect(sdk.navigation.openExternal).toHaveBeenCalledWith({ url: authorizationUrl });
    await click("Check connection");
    expect(container.textContent).toContain("Zoom is still waiting for authorization");
    expect(announce).not.toHaveBeenCalled();

    approved = true;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(requestsTo("/v1/meeting-providers/connections/zoom-account/verify")).toHaveLength(2);
    expect(container.textContent).toContain("Manage Zoom");
    expect(container.textContent).toContain("alex@example.com");
    expect(announce).toHaveBeenCalledWith("Zoom connected.");
    expect(submitAccount).not.toHaveBeenCalled();
    await click("Close");
    await select("schedule-location", "Zoom");
    await act(async () => {
      const title = container.querySelector<HTMLInputElement>('[name="meeting-title"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Zoom planning");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Save event");
    expect(submitMeeting).toHaveBeenCalledWith(expect.objectContaining({ title: "Zoom planning", location: "zoom" }));
  });

  it("offers Zoom when the calendar provider catalog is unavailable", async () => {
    calendarServiceUnavailable = true;
    await render();
    expect(container.textContent).toContain("Calendar service unavailable");
    await select("calendar-account-provider", "Zoom");
    await click("Connect Zoom");
    expect(requestsTo("/v1/oauth/zoom/start")).toHaveLength(1);
  });

  it("shows an existing Zoom account without starting a duplicate authorization", async () => {
    connections = [zoomConnection("connected")];
    await render();
    await select("calendar-account-provider", "Zoom");
    expect(container.textContent).toContain("Manage Zoom");
    expect(requestsTo("/v1/oauth/zoom/start")).toHaveLength(0);
    await click("Disconnect Zoom");
    expect(announce).toHaveBeenCalledWith("Zoom disconnected.");
    await expectZoomDisabled();
  });

  it("requires calendar management permission before starting Zoom authorization", async () => {
    requireManage.mockRejectedValue(new Error("Permission denied"));
    await render("zoom");
    await click("Connect Zoom");
    expect(requestsTo("/v1/oauth/zoom/start")).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("couldn't start the connection");
  });

  it("leaves Zoom disconnected when its OAuth app is unavailable", async () => {
    startError = "provider_unconfigured";
    await render("zoom");
    await click("Connect Zoom");
    expect(container.textContent).toContain("Zoom isn't available right now");
    expect(sdk.navigation.openExternal).not.toHaveBeenCalled();
    await click("Close");
    await expectZoomDisabled();
  });

  it("rejects an unsafe authorization link and can restart with a fresh link", async () => {
    authorizationUrl = "https://zoom.us.attacker.example/oauth/authorize";
    await render("zoom");
    await click("Connect Zoom");
    await click("Open Zoom");
    expect(sdk.navigation.openExternal).not.toHaveBeenCalled();
    expect(container.textContent).toContain("TAP can't safely open");
    authorizationUrl = "https://zoom.us/oauth/authorize?state=restarted";
    await click("Restart connection");
    await click("Open Zoom");
    expect(sdk.navigation.openExternal).toHaveBeenCalledWith({ url: authorizationUrl });
  });

  it("refreshes revoked access and offers reconnection after verification fails", async () => {
    connections = [zoomConnection("pending")];
    verifyError = "zoom_reauthorization_required";
    await render("zoom");
    await click("Check connection");
    expect(container.textContent).toContain("Reconnect Zoom before creating another meeting");
    expect(container.textContent).toContain("Zoom needs attention");
    await click("Restart connection");
    expect(requestsTo("/v1/oauth/zoom/start")).toHaveLength(1);
  });

  it("explains why upcoming Zoom bookings prevent disconnecting", async () => {
    connections = [zoomConnection("connected")];
    disconnectError = "zoom_connection_in_use";
    await render("zoom");
    await click("Disconnect Zoom");
    expect(container.textContent).toContain("Cancel upcoming Zoom bookings before disconnecting this account");
    expect(container.textContent).toContain("Manage Zoom");
    expect(announce).not.toHaveBeenCalled();
  });
});
