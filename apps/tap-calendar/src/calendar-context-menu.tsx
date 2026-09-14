import { Eye, EyeOff, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./calendar-context-menu.css";

const VIEWPORT_MARGIN = 8;
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface ContextMenuPoint {
  readonly x: number;
  readonly y: number;
}

export interface ContextMenuSize {
  readonly width: number;
  readonly height: number;
}

export interface ContextMenuViewport {
  readonly width: number;
  readonly height: number;
}

export interface CalendarContextMenuProps {
  /** A focusable calendar control, such as an event or calendar-list button. */
  readonly children: ReactNode;
  readonly hidden: boolean;
  readonly onRemove: () => void;
  readonly onToggleHidden: () => void;
  readonly menuLabel?: string;
  readonly hideLabel?: string;
  readonly showLabel?: string;
  readonly removeLabel?: string;
  readonly toggleDisabled?: boolean;
  readonly removeDisabled?: boolean;
}

interface MenuPosition {
  readonly left: number;
  readonly top: number;
  readonly ready: boolean;
}

/**
 * Clamp a fixed-position menu to the visible viewport.
 * Exported so positioning behavior can be verified without a browser DOM.
 */
export function clampContextMenuPosition(
  point: ContextMenuPoint,
  menu: ContextMenuSize,
  viewport: ContextMenuViewport,
  margin = VIEWPORT_MARGIN,
): ContextMenuPoint {
  const safeMargin = Math.max(0, margin);
  const maximumX = Math.max(safeMargin, viewport.width - menu.width - safeMargin);
  const maximumY = Math.max(safeMargin, viewport.height - menu.height - safeMargin);

  return {
    x: Math.min(Math.max(safeMargin, point.x), maximumX),
    y: Math.min(Math.max(safeMargin, point.y), maximumY),
  };
}

/** Return true for both standardized keyboard ways to request a context menu. */
export function isContextMenuKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "shiftKey">,
): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}

function focusableOpener(target: EventTarget | null, boundary: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const candidate = target.closest<HTMLElement>(FOCUSABLE_SELECTOR);
  return candidate !== null && boundary.contains(candidate) ? candidate : null;
}

function menuItems(menu: HTMLElement | null): readonly HTMLButtonElement[] {
  if (menu === null) return [];
  return Array.from(
    menu.querySelectorAll<HTMLButtonElement>("button[role='menuitem']:not(:disabled)"),
  );
}

export function CalendarContextMenu({
  children,
  hidden,
  onRemove,
  onToggleHidden,
  menuLabel = "Calendar actions",
  hideLabel = "Hide",
  showLabel = "Show",
  removeLabel = "Remove",
  toggleDisabled = false,
  removeDisabled = false,
}: CalendarContextMenuProps) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setPosition(null);
    const opener = openerRef.current;
    openerRef.current = null;

    if (!restoreFocus || opener === null) return;
    window.requestAnimationFrame(() => {
      if (opener.isConnected) opener.focus();
    });
  }, []);

  const openMenu = useCallback((point: ContextMenuPoint, opener: HTMLElement | null) => {
    openerRef.current = opener;
    setPosition({ left: point.x, top: point.y, ready: false });
  }, []);

  const handleContextMenu = useCallback((event: ReactMouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    openMenu(
      { x: event.clientX, y: event.clientY },
      focusableOpener(event.target, event.currentTarget) ??
        event.currentTarget.querySelector<HTMLElement>(FOCUSABLE_SELECTOR),
    );
  }, [openMenu]);

  const handleTriggerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (!isContextMenuKeyboardEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();

    const opener = focusableOpener(event.target, event.currentTarget);
    if (opener === null) return;
    const bounds = opener.getBoundingClientRect();
    openMenu({ x: bounds.left, y: bounds.bottom }, opener);
  }, [openMenu]);

  useLayoutEffect(() => {
    if (position === null || position.ready) return;
    const menu = menuRef.current;
    if (menu === null) return;

    const bounds = menu.getBoundingClientRect();
    const clamped = clampContextMenuPosition(
      { x: position.left, y: position.top },
      { width: bounds.width, height: bounds.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPosition(current => current === null || current.ready
      ? current
      : { left: clamped.x, top: clamped.y, ready: true });
  }, [position]);

  useEffect(() => {
    if (position?.ready !== true) return;
    menuItems(menuRef.current)[0]?.focus();
  }, [position?.ready]);

  useEffect(() => {
    if (position === null) return;

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target) === true) return;
      closeMenu(false);
    };
    const handleDocumentKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    };
    const handleResize = (): void => {
      setPosition(current => current === null ? null : { ...current, ready: false });
    };
    const handleScroll = (): void => closeMenu(false);

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleDocumentKeyDown, true);
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [closeMenu, position]);

  const handleMenuKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(menuRef.current);
    if (items.length === 0) return;

    const currentIndex = items.findIndex(item => item === document.activeElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    if (event.key === "ArrowUp") nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (event.key === "Tab") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    items[nextIndex]?.focus();
  }, [closeMenu]);

  const activate = useCallback((action: () => void, restoreFocus = true) => {
    closeMenu(restoreFocus);
    action();
  }, [closeMenu]);

  const menu = position === null ? null : createPortal(
    <div
      ref={menuRef}
      className="calendar-context-menu"
      role="menu"
      aria-label={menuLabel}
      data-ready={position.ready}
      style={{ left: position.left, top: position.top }}
      onKeyDown={handleMenuKeyDown}
    >
      <button
        type="button"
        role="menuitem"
        disabled={toggleDisabled}
        onClick={() => activate(onToggleHidden)}
      >
        {hidden ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
        <span>{hidden ? showLabel : hideLabel}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="calendar-context-menu__destructive"
        disabled={removeDisabled}
        onClick={() => activate(onRemove, false)}
      >
        <Trash2 aria-hidden="true" />
        <span>{removeLabel}</span>
      </button>
    </div>,
    document.body,
  );

  return (
    <>
      <span
        className="calendar-context-menu__trigger"
        onContextMenu={handleContextMenu}
        onKeyDown={handleTriggerKeyDown}
      >
        {children}
      </span>
      {menu}
    </>
  );
}
