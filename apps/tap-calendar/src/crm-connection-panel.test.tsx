// @rstest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CrmConnectionPanel } from "./crm-connection-panel";
import { createCalendarGatewayClient, type CalendarGatewayCrmConnection, type CalendarGatewayCrmConnectionStatus, type CalendarGatewayTransport } from "./gateway";

const KEY = "tap_bot_secret_value";
let container: HTMLDivElement;
let root: Root;
let status: CalendarGatewayCrmConnectionStatus;
let testResponse: unknown;
let connectResponse: unknown;
let failWith: number | null;
const requests: Parameters<CalendarGatewayTransport>[] = [];
const authorize = rs.fn(async () => {});
const announce = rs.fn();
const connected = (overrides: Partial<CalendarGatewayCrmConnection> = {}): CalendarGatewayCrmConnection => ({
  apiUrl: "https://crm.example.com", status: "connected", reason: null, connectedAt: "2026-10-01T12:00:00.000Z",
  lastVerifiedAt: "2026-10-02T12:00:00.000Z", lastDeliveredAt: null, pendingDeliveries: 0, ...overrides,
});
const response = (body: unknown, code = 200) => ({ status: code, bodyText: JSON.stringify(body) });
const gateway = createCalendarGatewayClient({
  baseUrl: "http://127.0.0.1:8787", workspaceId: "workspace", principalId: "user",
  transport: async (...args) => {
    requests.push(args);
    const [url, request] = args;
    const path = new URL(url).pathname;
    if (failWith && request.method !== "GET") return response({ error: "crm_failed", message: `echo ${KEY}` }, failWith);
    if (path === "/v1/crm/connection" && request.method === "GET") return response(status);
    if (path === "/v1/crm/connection/test") return response(testResponse);
    if (path === "/v1/crm/connection" && request.method === "POST") return response(connectResponse);
    if (path === "/v1/crm/connection" && request.method === "DELETE") return response({ disconnected: true });
    throw new Error(`Unexpected request: ${request.method} ${path}`);
  },
});

beforeEach(() => {
  rs.clearAllMocks();
  status = { enabled: true, defaultApiUrl: "https://crm.default.example", canManage: true, connection: null };
  testResponse = { ok: true, reason: null };
  connectResponse = { ok: true, reason: null, connection: connected() };
  failWith = null;
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

const render = async () => act(async () => root.render(<CrmConnectionPanel gateway={gateway} authorize={authorize} announce={announce} />));
const click = async (text: string) => {
  const button = [...container.querySelectorAll("button")].find(element => element.textContent === text);
  expect(button, `Missing button: ${text}`).toBeDefined();
  await act(async () => button!.click());
};
const type = async (name: string, value: string) => act(async () => {
  const field = container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
const field = (name: string) => container.querySelector<HTMLInputElement>(`[name="${name}"]`);
const writes = (method: string, path: string) =>
  requests.filter(([url, request]) => request.method === method && new URL(url).pathname === path);

describe("CRM connection panel", () => {
  it("renders nothing when CRM delivery is disabled for this environment", async () => {
    status = { ...status, enabled: false };
    await render();
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the gateway has no CRM routes", async () => {
    status = undefined as never;
    const missing = createCalendarGatewayClient({
      baseUrl: "http://127.0.0.1:8787", workspaceId: "workspace", principalId: "user",
      transport: async () => response({ error: "not_found" }, 404),
    });
    await act(async () => root.render(<CrmConnectionPanel gateway={missing} authorize={authorize} announce={announce} />));
    expect(container.textContent).toBe("");
  });

  it("prefills the default URL and tests entered values without storing them", async () => {
    await render();
    expect(container.textContent).toContain("Not connected");
    expect(field("crm-api-url")).toBeNull();
    expect(field("crm-bot-key")!.type).toBe("password");
    expect([...container.querySelectorAll("button")].find(button => button.textContent === "Test")!.disabled).toBe(true);
    await type("crm-bot-key", KEY);
    await click("Test");
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(JSON.parse(writes("POST", "/v1/crm/connection/test")[0]![1].body!)).toEqual({ botKey: KEY });
    expect(writes("POST", "/v1/crm/connection")).toHaveLength(0);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Connected");
  });

  it.each([
    ["invalid_key", "didn't accept this bot key"],
    ["missing_scope", "contacts.write scope. Use the CRM's Lead writer preset"],
    ["unreachable", "couldn't reach the CRM"],
    ["rejected", "CRM rejected the request"],
  ])("explains a failed test with %s in plain language", async (reason, text) => {
    testResponse = { ok: false, reason };
    await render();
    await type("crm-bot-key", KEY);
    await click("Test");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(text);
  });

  it("connects, clears the key, and shows the stored connection", async () => {
    await render();
    await type("crm-bot-key", KEY);
    await click("Connect");
    expect(JSON.parse(writes("POST", "/v1/crm/connection")[0]![1].body!)).toEqual({ botKey: KEY });
    expect(announce).toHaveBeenCalledWith("CRM connected.");
    expect(container.textContent).toContain("Connected");
    expect(container.textContent).toContain("Last delivered");
    expect(container.textContent).toContain("Never");
    expect(field("crm-bot-key")).toBeNull();
    expect(container.innerHTML).not.toContain(KEY);
  });

  it("keeps the form, clears the key, and explains why a connection attempt failed", async () => {
    connectResponse = { ok: false, reason: "missing_scope", connection: null };
    await render();
    await type("crm-bot-key", KEY);
    await click("Connect");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Lead writer preset");
    expect(field("crm-bot-key")!.value).toBe("");
    expect(announce).not.toHaveBeenCalled();
  });

  it("shows delivery status and tests or disconnects the stored connection after confirmation", async () => {
    status = { ...status, connection: connected({ lastDeliveredAt: "2026-10-03T08:00:00.000Z", pendingDeliveries: 3 }) };
    await render();
    expect(container.textContent).toContain("https://crm.example.com");
    expect(container.textContent).toContain("Pending3");
    expect(container.textContent).not.toContain("Never");
    expect(field("crm-bot-key")).toBeNull();
    await click("Test");
    expect(JSON.parse(writes("POST", "/v1/crm/connection/test")[0]![1].body!)).toEqual({});
    await click("Disconnect");
    expect(writes("DELETE", "/v1/crm/connection")).toHaveLength(0);
    await click("Cancel");
    expect(writes("DELETE", "/v1/crm/connection")).toHaveLength(0);
    await click("Disconnect");
    await click("Confirm disconnect");
    expect(writes("DELETE", "/v1/crm/connection")).toHaveLength(1);
    expect(announce).toHaveBeenCalledWith("CRM disconnected.");
    expect(container.textContent).toContain("Not connected");
    expect(field("crm-api-url")).toBeNull();
  });

  it("asks for a new key when the connection needs attention", async () => {
    status = { ...status, connection: connected({ status: "attention", reason: "invalid_key" }) };
    await render();
    expect(container.textContent).toContain("Needs attention");
    expect(container.textContent).toContain("didn't accept this bot key");
    expect(container.textContent).toContain("Reconnect with a new bot key");
    expect(field("crm-api-url")).toBeNull();
    await type("crm-bot-key", KEY);
    await click("Reconnect");
    expect(writes("POST", "/v1/crm/connection")).toHaveLength(1);
    expect(container.textContent).toContain("Connected");
  });

  it("shows read-only status for non-admins", async () => {
    status = { ...status, canManage: false, connection: connected({ pendingDeliveries: 1 }) };
    await render();
    expect(container.textContent).toContain("Only workspace admins can change the CRM connection.");
    expect(container.textContent).toContain("Connected");
    expect(container.querySelector("button")).toBeNull();
    expect(field("crm-bot-key")).toBeNull();
  });

  it("never surfaces gateway error text that could echo the key", async () => {
    await render();
    await type("crm-bot-key", KEY);
    failWith = 500;
    await click("Connect");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("couldn't reach the CRM connection service");
    expect(container.innerHTML).not.toContain(KEY);
    failWith = 403;
    await type("crm-bot-key", KEY);
    await click("Test");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Only workspace admins");
  });

  it("does not call the gateway when calendar management is not authorized", async () => {
    authorize.mockRejectedValueOnce(new Error("Permission denied"));
    await render();
    await type("crm-bot-key", KEY);
    await click("Connect");
    expect(writes("POST", "/v1/crm/connection")).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
