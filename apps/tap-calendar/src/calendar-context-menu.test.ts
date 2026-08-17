import { describe, expect, it } from "@rstest/core";
import {
  clampContextMenuPosition,
  isContextMenuKeyboardEvent,
} from "./calendar-context-menu";

describe("calendar context menu", () => {
  it("keeps a pointer-positioned menu within the viewport", () => {
    expect(clampContextMenuPosition(
      { x: 790, y: 590 },
      { width: 180, height: 90 },
      { width: 800, height: 600 },
    )).toEqual({ x: 612, y: 502 });

    expect(clampContextMenuPosition(
      { x: -20, y: -40 },
      { width: 180, height: 90 },
      { width: 800, height: 600 },
    )).toEqual({ x: 8, y: 8 });
  });

  it("uses the viewport margin when the menu is larger than the viewport", () => {
    expect(clampContextMenuPosition(
      { x: 200, y: 150 },
      { width: 900, height: 700 },
      { width: 800, height: 600 },
    )).toEqual({ x: 8, y: 8 });
  });

  it("recognizes the ContextMenu key and Shift+F10", () => {
    expect(isContextMenuKeyboardEvent({ key: "ContextMenu", shiftKey: false })).toBe(true);
    expect(isContextMenuKeyboardEvent({ key: "F10", shiftKey: true })).toBe(true);
    expect(isContextMenuKeyboardEvent({ key: "F10", shiftKey: false })).toBe(false);
    expect(isContextMenuKeyboardEvent({ key: "Enter", shiftKey: true })).toBe(false);
  });
});
