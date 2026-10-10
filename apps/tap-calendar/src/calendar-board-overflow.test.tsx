// @rstest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CalendarBoard } from "./calendar-board";
import { createEmptyCalendarState, type CalendarEvent, type CalendarView } from "./domain";

let container: HTMLDivElement;
let root: Root;

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

const state = (events: CalendarEvent[], activeView: CalendarView) => ({
  ...createEmptyCalendarState(), activeView, events,
  accounts: [{
    id: "account", provider: "google" as const, label: "Work", status: "connected" as const,
    calendars: [{ id: "primary", accountId: "account", name: "Calendar", color: "#458cca", role: "owner" as const, visible: true, conflicts: true, writable: true, destination: true, freshness: "live" as const }],
  }],
});

const baseEvent = (index: number): CalendarEvent => ({
  id: `event-${index}`, calendarId: "primary", title: `Event ${index}`,
  start: `2026-10-08T${String(9 + index).padStart(2, "0")}:00:00`, end: `2026-10-08T${String(9 + index).padStart(2, "0")}:30:00`,
  kind: "meeting", status: "confirmed", location: null, attendees: [],
});

// Five events on Thursday, October 8, 2026, plus one on Friday that stays under the limit.
const timedEvents = [1, 2, 3, 4, 5].map(baseEvent);
const allDayEvents = [1, 2, 3, 4, 5].map(index => ({
  ...baseEvent(index), title: `Holiday ${index}`, allDay: true,
  start: "2026-10-08T00:00:00.000Z", end: "2026-10-09T00:00:00.000Z",
}));
const fridayAllDay = { ...allDayEvents[0]!, id: "friday", title: "Friday off", start: "2026-10-09T00:00:00.000Z", end: "2026-10-10T00:00:00.000Z" };

const eventButtons = (scope: ParentNode, title: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button[aria-label]")]
    .filter(button => button.getAttribute("aria-label")!.startsWith(title));

describe("calendar overflow controls", () => {
  for (const view of ["day", "work-week", "week"] as const) {
    it(`expands and collapses the ${view} all-day row past three events`, async () => {
      const selectEvent = rs.fn();
      await render(<CalendarBoard state={state([...allDayEvents, fridayAllDay], view)} anchorDate="2026-10-08" onSelectEvent={selectEvent} onSelectSlot={rs.fn()} />);
      const row = container.querySelector<HTMLElement>(".all-day-columns")!;
      expect(eventButtons(row, "Holiday")).toHaveLength(3);
      expect(eventButtons(row, "Holiday")[0]!.getAttribute("aria-label")).toBe("Holiday 1, All day, confirmed");

      const toggle = row.querySelector<HTMLButtonElement>('[aria-label="Show 2 more events on Thursday, October 8"]')!;
      expect(toggle.textContent).toBe("+2 more");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(row.querySelectorAll(".all-day-more")).toHaveLength(1);

      toggle.focus();
      await click(toggle);
      expect(eventButtons(row, "Holiday")).toHaveLength(5);
      expect(row.classList.contains("is-expanded")).toBe(true);
      expect(toggle.textContent).toBe("Show less");
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(toggle.getAttribute("aria-label")).toBe("Show less: hide 2 events on Thursday, October 8");
      expect(document.activeElement).toBe(toggle);

      await click(eventButtons(row, "Holiday 5")[0]!);
      expect(selectEvent).toHaveBeenCalledWith("event-5");

      await click(toggle);
      expect(eventButtons(row, "Holiday")).toHaveLength(3);
      expect(row.classList.contains("is-expanded")).toBe(false);
      expect(toggle.textContent).toBe("+2 more");
    });
  }

  it("opens a month popover that reaches every event on the day", async () => {
    const selectEvent = rs.fn();
    await render(<CalendarBoard state={state(timedEvents, "month")} anchorDate="2026-10-08" onSelectEvent={selectEvent} onSelectSlot={rs.fn()} />);
    const cell = container.querySelector<HTMLButtonElement>('[aria-label="Schedule on Thursday, October 8"]')!.parentElement!;
    expect(eventButtons(cell, "Event")).toHaveLength(3);

    const more = cell.querySelector<HTMLButtonElement>('[aria-label="Show 2 more events on Thursday, October 8"]')!;
    expect(more.textContent).toBe("+2 more");
    expect(more.getAttribute("aria-haspopup")).toBe("dialog");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await click(more);
    const dialog = cell.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-label")).toBe("Events on Thursday, October 8");
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(more.getAttribute("aria-controls")).toBe(dialog.id);
    expect(document.activeElement).toBe(dialog);
    const listed = eventButtons(dialog, "Event");
    expect(listed.map(button => button.getAttribute("aria-label")!.split(",")[0])).toEqual(timedEvents.map(event => event.title));
    for (const button of listed) expect(button.title).toBe(button.getAttribute("aria-label"));

    await click(eventButtons(dialog, "Event 5")[0]!);
    expect(selectEvent).toHaveBeenCalledWith("event-5");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("closes the month popover with Escape, outside clicks, and the close button", async () => {
    await render(<CalendarBoard state={state(timedEvents, "month")} anchorDate="2026-10-08" onSelectEvent={rs.fn()} onSelectSlot={rs.fn()} />);
    const more = container.querySelector<HTMLButtonElement>(".month-more")!;

    await click(more);
    await act(async () => {
      container.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(more);

    await click(more);
    await act(async () => {
      container.querySelector(".month-weekdays")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await click(more);
    await act(async () => {
      container.querySelector('[role="dialog"]')!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await click(container.querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="Close"]')!);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows no overflow control when a day fits", async () => {
    await render(<CalendarBoard state={state(timedEvents.slice(0, 3), "month")} anchorDate="2026-10-08" onSelectEvent={rs.fn()} onSelectSlot={rs.fn()} />);
    expect(container.querySelector(".month-more")).toBeNull();
    await render(<CalendarBoard state={state(allDayEvents.slice(0, 3), "week")} anchorDate="2026-10-08" onSelectEvent={rs.fn()} onSelectSlot={rs.fn()} />);
    expect(container.querySelector(".all-day-more")).toBeNull();
  });
});
