// @rstest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BookingProfileDialog } from "./app";
import type { BookingProfile } from "./domain";
import { createInitialCalendarState } from "./test-fixtures";

let root: Root;
let container: HTMLDivElement;
const save = rs.fn<(profile: BookingProfile) => Promise<string | null>>();
const rename = rs.fn<(slug: string) => Promise<BookingProfile>>();
const profile = (): BookingProfile => ({ ...createInitialCalendarState().bookingProfiles[0]!, slug: "alex",
  publication: { generation: 1, status: "published", reservedSlug: "alex", updatedAt: "2026-09-27T20:30:00.000Z" },
});
function Harness({ initial }: {initial: BookingProfile | undefined}) {
  const [value, setValue] = useState(initial);
  return <BookingProfileDialog profile={value} onSubmit={save} onClose={() => {}} onRename={async slug => { const updated = await rename(slug); setValue(updated); return updated; }} />;
}
beforeEach(() => {
  rs.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  save.mockReset().mockResolvedValue(null);
  rename.mockReset().mockImplementation(async slug => ({ ...profile(), slug, publication: { ...profile().publication!, reservedSlug: slug, generation: 2 } }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); rs.unstubAllGlobals(); });
const render = async (value: BookingProfile | undefined) => { await act(async () => root.render(<Harness initial={value} />)); };
const button = (label: string) => [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label)!;
const click = async (label: string) => { expect(button(label), `Missing ${label}`).toBeDefined(); await act(async () => button(label).click()); };
const input = async (name: string, value: string) => {
  const field = container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
};
const acknowledge = async () => { await act(async () => container.querySelector<HTMLInputElement>('.booking-address-confirm input')!.click()); };

describe("booking profile settings", () => {
  it("keeps the address behind an explicit action and saves details without changing publication", async () => {
    const existing = profile(); await render(existing);
    expect(container.querySelector('[name="profile-slug"]')).toBeNull();
    expect(container.textContent).toContain("Change address");
    expect(container.textContent).not.toContain("permanent");
    expect(container.textContent).not.toContain("other profile slugs");
    expect(container.textContent).not.toContain("Publish this profile");
    await input("profile-name", "Alex Rivers"); await click("Save profile");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Alex Rivers", slug: "alex", published: true, publication: existing.publication }));
    expect(rename).not.toHaveBeenCalled();
  });
  it("requires acknowledgement and an explicit rename, then saves the confirmed address", async () => {
    await render(profile()); await click("Change address");
    expect(document.activeElement).toBe(container.querySelector('[name="profile-slug"]'));
    await input("profile-slug", "alex-rivers");
    expect(button("Confirm address change").disabled).toBe(true);
    expect(button("Save profile").disabled).toBe(true);
    expect(container.textContent).toContain("someone else can claim my old address");
    await acknowledge(); await input("profile-slug", "alex-new");
    expect(button("Confirm address change").disabled).toBe(true);
    await acknowledge(); await click("Confirm address change");
    expect(rename).toHaveBeenCalledWith("alex-new");
    expect(container.querySelector('[name="profile-slug"]')).toBeNull();
    expect(document.activeElement).toBe(button("Change address"));
    await click("Save profile");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ slug: "alex-new", publication: expect.objectContaining({ reservedSlug: "alex-new", generation: 2 }) }));
  });
  it("preserves the original profile after a failed rename and lets the user cancel", async () => {
    rename.mockRejectedValueOnce(new Error("That address is already claimed. Your current address has not changed."));
    await render(profile()); await click("Change address"); await input("profile-slug", "taken"); await acknowledge(); await click("Confirm address change");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("already claimed");
    expect(container.querySelector<HTMLInputElement>('[name="profile-slug"]')!.value).toBe("taken");
    await click("Cancel address change"); await click("Save profile");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ slug: "alex" }));
  });
  it("keeps an offline profile offline while editing details", async () => {
    const existing = { ...profile(), published: false, publication: { ...profile().publication!, status: "unpublished" as const } };
    await render(existing); await input("profile-name", "Alex offline"); await click("Save profile");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ published: false, slug: "alex", publication: existing.publication }));
  });
  it("requires an explicit action to change a draft and restores its address on cancel", async () => {
    const { publication: _receipt, ...draft } = profile(); await render({ ...draft, published: false });
    await click("Change address"); await input("profile-slug", "new-address"); await click("Cancel address change");
    expect(document.activeElement).toBe(button("Change address")); await click("Save profile");
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ slug: "alex", published: false }));
    await click("Change address"); await input("profile-slug", "new-address"); await click("Save profile");
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ slug: "new-address", published: false }));
  });
  it("creates a draft without publishing controls or unrelated namespace information", async () => {
    await render(undefined); await input("profile-name", "Alex"); await input("profile-slug", "alex"); await click("Save draft");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ slug: "alex", published: false }));
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(rename).not.toHaveBeenCalled();
  });
});
