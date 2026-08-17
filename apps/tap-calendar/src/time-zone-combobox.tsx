import { Check, ChevronDown, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  exactTimeZoneMatch,
  filterTimeZones,
  timeZoneDisplayLabel,
  timeZoneLocationLabel,
  timeZoneOptions,
} from "./time-zone";
import "./time-zone-combobox.css";

const POPOVER_GAP = 6;
const POPOVER_MARGIN = 8;
const IDEAL_POPOVER_HEIGHT = 320;
const MIN_POPOVER_HEIGHT = 140;

interface PopoverPosition {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly maxHeight: number;
}

export interface TimeZoneComboboxProps {
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly className?: string;
  /** Instant used to show date-sensitive GMT offsets and abbreviations. */
  readonly referenceInstant?: number;
}

export function timeZonePopoverPosition(
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width">,
  viewport: { readonly width: number; readonly height: number },
): PopoverPosition {
  const width = Math.min(anchor.width, viewport.width - POPOVER_MARGIN * 2);
  const left = Math.min(
    Math.max(POPOVER_MARGIN, anchor.left),
    Math.max(POPOVER_MARGIN, viewport.width - width - POPOVER_MARGIN),
  );
  const spaceBelow = viewport.height - anchor.bottom - POPOVER_GAP - POPOVER_MARGIN;
  const spaceAbove = anchor.top - POPOVER_GAP - POPOVER_MARGIN;
  const openAbove = spaceBelow < MIN_POPOVER_HEIGHT && spaceAbove > spaceBelow;
  const available = Math.max(MIN_POPOVER_HEIGHT, openAbove ? spaceAbove : spaceBelow);
  const maxHeight = Math.min(IDEAL_POPOVER_HEIGHT, available);
  const top = openAbove
    ? Math.max(POPOVER_MARGIN, anchor.top - POPOVER_GAP - maxHeight)
    : anchor.bottom + POPOVER_GAP;
  return { left, top, width, maxHeight };
}

export function TimeZoneCombobox({
  label,
  name,
  value,
  onValueChange,
  description = "Search by city, region, abbreviation, GMT offset, or IANA time zone.",
  disabled = false,
  required = false,
  className,
  referenceInstant,
}: TimeZoneComboboxProps) {
  const generatedId = useId();
  const inputId = `${name}-${generatedId}`;
  const labelId = `${inputId}-label`;
  const descriptionId = `${inputId}-description`;
  const listboxId = `${inputId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const displayReferenceInstant = referenceInstant ?? openedAt;
  const options = useMemo(() => timeZoneOptions([value]), [value]);
  const exactTypedValue = useMemo(() => exactTimeZoneMatch(query, options), [options, query]);
  const results = useMemo(() => {
    const filtered = filterTimeZones(options, query, 80, displayReferenceInstant);
    if (query.trim().length === 0 && options.includes(value)) {
      return [value, ...filtered.filter(timeZone => timeZone !== value).slice(0, 79)];
    }
    if (exactTypedValue === null || filtered.includes(exactTypedValue)) return filtered;
    return [exactTypedValue, ...filtered.slice(0, Math.max(0, 79))];
  }, [displayReferenceInstant, exactTypedValue, options, query, value]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery(value);
    setActiveIndex(0);
  }, [value]);

  const select = useCallback((nextValue: string) => {
    onValueChange(nextValue);
    setQuery(nextValue);
    setOpen(false);
    setActiveIndex(0);
    inputRef.current?.focus();
  }, [onValueChange]);

  const openAll = useCallback(() => {
    if (disabled) return;
    setOpenedAt(Date.now());
    setQuery("");
    setOpen(true);
    setActiveIndex(0);
    inputRef.current?.focus();
  }, [disabled]);

  const updatePosition = useCallback(() => {
    const bounds = controlRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setPosition(timeZonePopoverPosition(bounds, {
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
    }));
  }, []);

  useEffect(() => {
    if (!open) setQuery(value);
  }, [open, value]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      setPortalHost(null);
      return;
    }
    const containedSurface = rootRef.current?.closest<HTMLElement>(
      ".modal-card, .public-preview-overlay",
    ) ?? null;
    const host = containedSurface ?? globalThis.document.body;
    containedSurface?.classList.add("time-zone-popover-open");
    setPortalHost(host);
    updatePosition();
    globalThis.addEventListener("resize", updatePosition);
    globalThis.addEventListener("scroll", updatePosition, true);
    return () => {
      containedSurface?.classList.remove("time-zone-popover-open");
      globalThis.removeEventListener("resize", updatePosition);
      globalThis.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target) || listboxRef.current?.contains(event.target)) return;
      close();
    };
    globalThis.document.addEventListener("pointerdown", onPointerDown, true);
    return () => globalThis.document.removeEventListener("pointerdown", onPointerDown, true);
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    const active = listboxRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, results]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openAll();
        return;
      }
      if (results.length === 0) return;
      setActiveIndex(current => {
        if (event.key === "ArrowDown") return current < 0 ? 0 : (current + 1) % results.length;
        return current < 0 ? results.length - 1 : (current - 1 + results.length) % results.length;
      });
      return;
    }
    if (event.key === "Home" && open && results.length > 0) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End" && open && results.length > 0) {
      event.preventDefault();
      setActiveIndex(results.length - 1);
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      const selected = results[activeIndex] ?? exactTypedValue;
      if (selected) select(selected);
    }
  };

  const activeOptionId = open && results[activeIndex]
    ? `${listboxId}-option-${activeIndex}`
    : undefined;
  const resultMessage = results.length === 0
    ? "No matching time zones."
    : query.trim().length === 0 && options.length > results.length
      ? `${results.length} of ${options.length} time zones shown. Type to narrow the list.`
      : `${results.length} matching time zone${results.length === 1 ? "" : "s"}.`;

  const listbox = open && position !== null && portalHost !== null ? createPortal(
    <div
      ref={listboxRef}
      id={listboxId}
      className="time-zone-combobox__listbox"
      role="listbox"
      aria-labelledby={labelId}
      style={position}
    >
      {results.map((timeZone, index) => (
        <div
          id={`${listboxId}-option-${index}`}
          className="time-zone-combobox__option"
          data-active={index === activeIndex}
          data-option-index={index}
          role="option"
          aria-selected={timeZone === value}
          key={timeZone}
          onPointerMove={() => setActiveIndex(index)}
          onMouseDown={event => event.preventDefault()}
          onClick={() => select(timeZone)}
        >
          <span>
            <strong>{timeZoneLocationLabel(timeZone)}</strong>
            <small>{timeZoneDisplayLabel(timeZone, displayReferenceInstant)}</small>
          </span>
          {timeZone === value ? <Check aria-hidden="true" /> : null}
        </div>
      ))}
      {results.length === 0 ? <div className="time-zone-combobox__empty">No matching time zones</div> : null}
    </div>,
    portalHost,
  ) : null;

  return (
    <div ref={rootRef} className={["field", "time-zone-field", className].filter(Boolean).join(" ")}>
      <label id={labelId} htmlFor={inputId}>{label}</label>
      <div ref={controlRef} className="time-zone-combobox__control" data-open={open}>
        <Search aria-hidden="true" />
        <input
          ref={inputRef}
          id={inputId}
          name={name}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          aria-required={required}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={open ? query : value}
          placeholder={open ? value : undefined}
          onFocus={() => {
            if (!open) openAll();
          }}
          onChange={event => {
            setQuery(event.currentTarget.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          onBlur={event => {
            const nextFocus = event.relatedTarget;
            if (nextFocus instanceof Node && rootRef.current?.contains(nextFocus)) return;
            close();
          }}
        />
        <button
          type="button"
          aria-label={`${open ? "Close" : "Open"} ${label.toLocaleLowerCase("en-US")} options`}
          aria-expanded={open}
          disabled={disabled}
          onPointerDown={event => event.preventDefault()}
          onClick={() => open ? close() : openAll()}
        >
          <ChevronDown aria-hidden="true" />
        </button>
      </div>
      <small id={descriptionId}>{description}</small>
      <span className="calendar-visually-hidden" role="status" aria-live="polite">{open ? resultMessage : ""}</span>
      {listbox}
    </div>
  );
}
