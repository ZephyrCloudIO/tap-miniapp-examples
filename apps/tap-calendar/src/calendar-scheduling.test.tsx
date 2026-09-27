// @rstest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CalendarBoard } from "./calendar-board";
import { EventDrawer, ScheduleDialog } from "./app";
import { createInitialCalendarState } from "./test-fixtures";
import { updateCalendar, type CalendarView } from "./domain";

let container: HTMLDivElement;
let root: Root;
const state = updateCalendar(createInitialCalendarState(), "cal-google-main", { destination: true });
const principalAccess = {
  status: "ready" as const,
  value: { calendarIds: ["cal-google-main"], writableGoogleDestinationIds: ["cal-google-main"] },
};

beforeEach(() => {
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

const render = async (node: ReactNode) => act(async () => root.render(node));
const click = async (element: HTMLElement) => act(async () => element.click());
const field = (name: string) => container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
const input = async (name: string, value: string) => act(async () => {
  const element = field(name);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
});
const button = (text: string) => [...container.querySelectorAll("button")].find(element => element.textContent === text)!;

describe("calendar slot scheduling", () => {
  for (const view of ["day", "work-week", "week"] as const) {
    it(`opens the selected local date and time in ${view} view`, async () => {
      const selectSlot = rs.fn();
      const selectEvent = rs.fn();
      await render(<CalendarBoard state={{ ...state, activeView: view }} anchorDate="2026-08-14" onSelectSlot={selectSlot} onSelectEvent={selectEvent} />);
      const slot = container.querySelector<HTMLButtonElement>('[aria-label="Schedule on Friday, August 14 at 9:30 AM"]')!;
      await click(slot);
      expect(selectSlot).toHaveBeenCalledWith("2026-08-14T09:30");
      expect(selectEvent).not.toHaveBeenCalled();
    });
  }

  it("allows keyboard navigation to a later slot without hundreds of tab stops", async () => {
    const selectSlot = rs.fn();
    await render(<CalendarBoard state={{ ...state, activeView: "day" }} anchorDate="2026-08-14" onSelectSlot={selectSlot} onSelectEvent={rs.fn()} />);
    const slot = container.querySelector<HTMLButtonElement>('.calendar-time-slot[tabindex="0"]')!;
    await act(async () => {
      slot.focus();
      slot.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Schedule on Friday, August 14 at 9:30 AM");
    expect(container.querySelectorAll('.calendar-time-slot[tabindex="0"]')).toHaveLength(1);
    await click(document.activeElement as HTMLElement);
    expect(selectSlot).toHaveBeenCalledWith("2026-08-14T09:30");
  });

  it("opens a month date at 9 AM and keeps existing event clicks separate", async () => {
    const selectSlot = rs.fn();
    const selectEvent = rs.fn();
    const withEvent = { ...state, events: [{ id: "existing", calendarId: "cal-google-main", title: "Existing event", start: "2026-08-14T09:00:00", end: "2026-08-14T09:30:00", kind: "meeting" as const, status: "confirmed" as const, location: null, attendees: [] }] };
    for (const view of ["month", "day"] satisfies CalendarView[]) {
      await render(<CalendarBoard state={{ ...withEvent, activeView: view }} anchorDate="2026-08-14" onSelectSlot={selectSlot} onSelectEvent={selectEvent} />);
      const existing = [...container.querySelectorAll("button")].find(element => element.textContent?.includes("Existing event"))!;
      await click(existing);
      expect(selectEvent).toHaveBeenLastCalledWith("existing");
      expect(selectSlot).not.toHaveBeenCalled();
      if (view === "month") {
        await click(container.querySelector<HTMLButtonElement>('[aria-label="Schedule on Friday, August 14"]')!);
        expect(selectSlot).toHaveBeenCalledWith("2026-08-14T09:00");
        selectSlot.mockClear();
      }
    }
  });
});

describe("personal calendar events", () => {
  it("submits a plain-text description and physical address alongside Zoom", async () => {
    const submit = rs.fn().mockResolvedValue({ error: null, retrySameAttempt: false });
    await render(<ScheduleDialog state={state} principalAccess={principalAccess} zoomConnected initialStart="2026-08-14T09:30" onClose={rs.fn()} onSubmit={submit} />);
    await input("meeting-title", "Hybrid planning");
    await input("schedule-physical-location", "  Room 3, 123 Main Street  ");
    const description = container.querySelector<HTMLTextAreaElement>("#schedule-description")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(description, "Agenda <draft> & notes\nBring a laptop.");
      description.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(container.querySelector<HTMLButtonElement>("#schedule-location")!);
    await click([...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "Zoom")!);
    await click(button("Save event"));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      location: "zoom", physicalLocation: "Room 3, 123 Main Street",
      description: "Agenda <draft> & notes\nBring a laptop.",
    }));
  });

  it("shows the address, literal description, and video join link together", async () => {
    await render(<EventDrawer state={state} onClose={rs.fn()} event={{
      id: "hybrid", calendarId: "cal-google-main", title: "Hybrid planning",
      start: "2026-08-14T09:30:00Z", end: "2026-08-14T10:00:00Z", kind: "meeting", status: "confirmed",
      attendees: [], location: "zoom", physicalLocation: "Room 3, 123 Main Street",
      description: "Agenda <script>alert('draft')</script>\nBring a laptop.", providerJoinUrl: "https://zoom.us/j/123456789",
    }} />);
    expect(container.textContent).toContain("Room 3, 123 Main Street");
    expect(container.textContent).toContain("Agenda <script>alert('draft')</script>\nBring a laptop.");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector<HTMLAnchorElement>('a[href="https://zoom.us/j/123456789"]')?.textContent).toContain("Join meeting");
  });

  it("selects duration with the keyboard and dismisses the menu without closing the draft", async () => {
    const submit = rs.fn().mockResolvedValue({ error: null, retrySameAttempt: false });
    const close = rs.fn();
    await render(<ScheduleDialog state={state} principalAccess={principalAccess} zoomConnected={false} initialStart="2026-08-14T09:30" onClose={close} onSubmit={submit} />);
    const duration = container.querySelector<HTMLButtonElement>("#schedule-duration")!;
    await act(async () => duration.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    const hour = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "1 hour")!;
    await act(async () => {
      hour.focus();
      hour.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(duration.textContent).toBe("1 hour");
    await act(async () => duration.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    await input("meeting-title", "Planning");
    await click(button("Save event"));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      start: new Date("2026-08-14T09:30").toISOString(),
      end: new Date("2026-08-14T10:30").toISOString(),
    }));
  });

  it("prefills local time and submits a busy event without guests or video", async () => {
    const submit = rs.fn().mockResolvedValue({ error: null, retrySameAttempt: false });
    await render(<ScheduleDialog state={state} principalAccess={principalAccess} zoomConnected={false} initialStart="2026-08-14T23:30" onClose={rs.fn()} onSubmit={submit} />);
    expect(field("schedule-start").value).toBe("2026-08-14T23:30");
    expect(document.activeElement).toBe(field("meeting-title"));
    expect(field("schedule-location").value).toBe("none");
    expect(button("Save event").disabled).toBe(true);
    await input("meeting-title", "Focus time");
    expect(button("Save event").disabled).toBe(false);
    await click(button("Save event"));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      title: "Focus time", attendees: [], location: null, approvalRequired: false,
      start: new Date("2026-08-14T23:30").toISOString(),
      end: new Date("2026-08-15T00:00").toISOString(),
    }));
  });

  it("requires complete guests once added and allows removing the final guest", async () => {
    const submit = rs.fn().mockResolvedValue({ error: null, retrySameAttempt: false });
    await render(<ScheduleDialog state={state} principalAccess={principalAccess} zoomConnected={false} initialStart="2026-08-14T09:30" onClose={rs.fn()} onSubmit={submit} />);
    await input("meeting-title", "Focus time");
    await click(button("Add external guest"));
    expect(field("attendee-email-0").required).toBe(true);
    expect(container.querySelector("form")?.checkValidity()).toBe(false);
    await click(container.querySelector<HTMLButtonElement>('[aria-label="Remove attendee 1"]')!);
    expect(container.textContent).toContain("Just you · Busy");
    await click(button("Save event"));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ attendees: [], location: null }));
  });
});
