// @rstest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BookingProfileDialog } from "./app";
import type { BookingProfile } from "./domain";
import { createInitialCalendarState } from "./test-fixtures";

let root: Root;
let container: HTMLDivElement;
const save = rs.fn<(profile: BookingProfile) => Promise<string | null>>();
const profile = (): BookingProfile => ({ ...createInitialCalendarState().bookingProfiles[0]!,
  publication: { generation: 1, status: "published", reservedSlug: "alex", updatedAt: "2026-09-27T20:30:00.000Z" },
});
beforeEach(() => {
  rs.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  save.mockReset().mockResolvedValue(null);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); rs.unstubAllGlobals(); });
const render = async (value: BookingProfile | undefined) => { await act(async () => root.render(<BookingProfileDialog profile={value} onSubmit={save} onClose={() => {}} />)); };
const click = async (label: string) => {
  const button = [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label);
  expect(button, `Missing ${label}`).toBeDefined(); await act(async () => button!.click());
};
const input = async (name: string, value: string) => {
  const field = container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
};

describe("booking profile settings", () => {
  it("keeps a claimed URL locked while saving editable profile details", async () => {
    const existing = profile();
    await render(existing);
    expect(container.textContent).toContain("Name claimed");
    expect(container.querySelector('[name="profile-slug"]')).toBeNull();
    expect(container.textContent).not.toContain("Change address");
    expect(container.textContent).not.toContain("other profile slugs");
    await input("profile-name", "Alex Rivers"); await click("Save profile");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Alex Rivers", slug: "alex", publication: existing.publication, eventTypes: existing.eventTypes }));
  });
  it("keeps the reserved URL locked when taking the profile offline or editing offline", async () => {
    const existing = profile(); await render(existing);
    await act(async () => container.querySelector<HTMLInputElement>('[name="profile-published"]')!.click());
    expect(container.textContent).toContain("Saving takes this profile and its booking pages offline");
    await click("Save profile");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ published: false, slug: "alex", publication: existing.publication }));
    await render({ ...existing, published: false, publication: { ...existing.publication!, status: "unpublished" } });
    expect(container.querySelector('[name="profile-slug"]')).toBeNull();
    expect(container.textContent).toContain("Name claimed");
  });
  it("requires an explicit action to change a draft address and supports cancelling it", async () => {
    const { publication: _receipt, ...draft } = profile();
    await render({ ...draft, published: false });
    expect(container.querySelector('[name="profile-slug"]')).toBeNull();
    await click("Change address");
    expect(document.activeElement).toBe(container.querySelector('[name="profile-slug"]'));
    await input("profile-slug", "new-address"); await click("Cancel address change");
    expect(document.activeElement?.textContent).toBe("Change address");
    expect(container.querySelector('[name="profile-slug"]')).toBeNull();
    await click("Save profile");
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ slug: draft.slug, published: false }));
    await click("Change address"); await input("profile-slug", "new-address"); await click("Save profile");
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ slug: "new-address", published: false }));
  });
  it("explains permanence before a first claim and retains the draft after a failed claim", async () => {
    await render(undefined);
    expect(container.textContent).toContain("your address becomes permanent once claimed");
    await input("profile-name", "Alex"); await input("profile-slug", "alex");
    await act(async () => container.querySelector<HTMLInputElement>('[name="profile-published"]')!.click());
    save.mockResolvedValueOnce("This booking address is already claimed. Choose another.");
    await click("Claim and publish");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("already claimed");
    expect(container.querySelector<HTMLInputElement>('[name="profile-slug"]')!.value).toBe("alex");
    await input("profile-slug", "alex-rivers"); await click("Claim and publish");
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ slug: "alex-rivers", published: true }));
  });
});
