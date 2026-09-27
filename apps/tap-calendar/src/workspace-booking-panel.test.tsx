// @rstest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WorkspaceBookingPanel } from "./workspace-booking-panel";
import { createCalendarGatewayClient } from "./gateway";
import { createInitialCalendarState } from "./test-fixtures";
import type { WorkspaceBookings, WorkspaceBookingProfileInput } from "./workspace-bookings";

let root: Root;
let container: HTMLDivElement;
let data: WorkspaceBookings;
let failSave: boolean;
const saves: WorkspaceBookingProfileInput[] = [];
const claimed = (): WorkspaceBookings => ({
  canManage: true, pendingApprovals: [], self: null, hosts: [], publicBaseUrl: "https://cal.with-tap.ai",
  definition: { version: 1, profileSlug: "zephyr", displayName: "Zephyr", published: true, events: [] },
  publication: { current_slug: "zephyr", display_name: "Zephyr", status: "published", publication_generation: 1, definition_version: 1, hosts_current: true },
});
const gateway = createCalendarGatewayClient({
  baseUrl: "https://calendar-api.example.com", workspaceId: "workspace", principalId: "user-alex",
  transport: async (_url, init) => {
    if (init.method === "POST") {
      const input = JSON.parse(init.body!) as WorkspaceBookingProfileInput;
      if (failSave) return { status: 503, headers: [], bodyText: JSON.stringify({ error: "unavailable", message: "Could not save the workspace profile. Try again." }) };
      saves.push(input);
      data = { ...data,
        definition: { ...input, version: input.expectedVersion + 1 },
        publication: { current_slug: input.profileSlug, display_name: input.displayName, status: input.published ? "published" : "unpublished", publication_generation: (data.publication?.publication_generation ?? 0) + 1, definition_version: input.expectedVersion + 1, hosts_current: true },
      };
    }
    return { status: 200, headers: [], bodyText: JSON.stringify(data) };
  },
});
const render = async () => {
  await act(async () => root.render(<WorkspaceBookingPanel gateway={gateway} state={createInitialCalendarState()} authorize={async () => {}} />));
};
const button = (label: string) => [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label);
const click = async (label: string) => { expect(button(label), `Missing ${label}`).toBeDefined(); await act(async () => button(label)!.click()); };
const input = async (name: string, value: string) => {
  const field = container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  expect(field).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
beforeEach(() => {
  data = claimed(); failSave = false; saves.length = 0;
  rs.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); rs.unstubAllGlobals(); });

describe("workspace profile claimed state", () => {
  it("replaces initial setup with a claimed summary only after a confirmed claim", async () => {
    data = { ...data, definition: null, publication: null };
    await render();
    expect(container.textContent).not.toContain("Name claimed");
    await input("workspace-display-name", "Zephyr");
    await input("workspace-profile-slug", "zephyr");
    await click("Claim workspace name");
    expect(saves[0]).toMatchObject({ profileSlug: "zephyr", displayName: "Zephyr", published: true, events: [] });
    expect(container.querySelector('.workspace-profile-summary')?.textContent).toContain("Name claimed");
    expect(container.querySelector('.workspace-profile-summary a')?.getAttribute("href")).toBe("https://cal.with-tap.ai/zephyr");
    expect(container.querySelector('[name="workspace-display-name"]')).toBeNull();
    expect(container.querySelector('[name="workspace-profile-slug"]')).toBeNull();
    expect(container.textContent).toContain("Setup needed");
    expect(container.textContent).not.toContain("Accepting bookings");
    expect(container.textContent).toContain("Next, enable your shared availability above");
  });

  it("requires Edit profile and discards edits when cancelled", async () => {
    await render();
    expect(container.querySelector('.workspace-profile-form')).toBeNull();
    await click("Edit profile");
    expect(document.activeElement).toBe(container.querySelector('[name="workspace-display-name"]'));
    expect(container.querySelector('[name="workspace-profile-slug"]')).toBeNull();
    await input("workspace-display-name", "Unsaved name");
    await click("Cancel");
    expect(saves).toHaveLength(0);
    expect(document.activeElement).toBe(button("Edit profile"));
    expect(container.textContent).not.toContain("Unsaved name");
    await click("Edit profile");
    expect(container.querySelector<HTMLInputElement>('[name="workspace-display-name"]')!.value).toBe("Zephyr");
  });

  it("saves the display name while keeping the reserved URL", async () => {
    await render(); await click("Edit profile"); await input("workspace-display-name", "Zephyr Cloud"); await click("Save changes");
    expect(saves[0]).toMatchObject({ displayName: "Zephyr Cloud", profileSlug: "zephyr", expectedVersion: 1, published: true });
    expect(container.querySelector('.workspace-profile-summary h4')?.textContent).toBe("Zephyr Cloud");
    expect(container.querySelector('.workspace-profile-form')).toBeNull();
    expect(document.activeElement).toBe(button("Edit profile"));
  });

  it("keeps an offline profile offline when its display name changes", async () => {
    data = { ...data, definition: { ...data.definition!, published: false }, publication: { ...data.publication!, status: "unpublished" } };
    await render();
    expect(container.textContent).toContain("Name claimed");
    expect(container.querySelector('.workspace-profile-summary a')).toBeNull();
    await click("Edit profile"); await input("workspace-display-name", "Zephyr Cloud"); await click("Save changes");
    expect(saves[0]!.published).toBe(false);
    expect(container.textContent).toContain("Offline");
    expect(button("Publish profile")).toBeDefined();
  });

  it("keeps failed edits open with their values for retry", async () => {
    await render(); await click("Edit profile"); await input("workspace-display-name", "Zephyr Cloud"); failSave = true; await click("Save changes");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
    expect(container.querySelector<HTMLInputElement>('[name="workspace-display-name"]')!.value).toBe("Zephyr Cloud");
    expect(container.querySelector('.workspace-profile-summary h4')?.textContent).toBe("Zephyr");
    failSave = false; await click("Save changes");
    expect(container.querySelector('.workspace-profile-summary h4')?.textContent).toBe("Zephyr Cloud");
  });

  it("does not claim success when the initial request fails", async () => {
    data = { ...data, definition: null, publication: null }; failSave = true;
    await render(); await input("workspace-display-name", "Zephyr"); await input("workspace-profile-slug", "zephyr"); await click("Claim workspace name");
    expect(container.querySelector('.workspace-profile-summary')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('[name="workspace-profile-slug"]')!.value).toBe("zephyr");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("shows confirmed meetings without edit fields and distinguishes stale publications", async () => {
    data = { ...data, hosts: [{ principalId: "alex", displayName: "Alex", email: "alex@example.com", version: 1 }],
      definition: { ...data.definition!, events: [{ id: "team", slug: "meet-us", title: "Meet the team", description: "", durationMinutes: 30, hostIds: ["alex"], organizerId: "alex", location: "google-meet", approvalRequired: false }] },
    };
    await render();
    expect(container.textContent).toContain("Accepting bookings");
    expect(container.querySelector('.workspace-profile-meetings')?.textContent).toContain("Meet the team");
    expect(container.querySelector('.shared-booking-event')).toBeNull();
    await click("Add shared meeting");
    expect(container.querySelectorAll('.shared-booking-event')).toHaveLength(2);
    await click("Cancel");
    data = { ...data, publication: { ...data.publication!, hosts_current: false } };
    await click("Refresh");
    expect(container.textContent).toContain("Update needed");
    expect(container.textContent).not.toContain("Accepting bookings");
    expect(button("Refresh shared links")).toBeDefined();
    expect(container.querySelector('.workspace-profile-meetings button')).toBeNull();
  });
});
