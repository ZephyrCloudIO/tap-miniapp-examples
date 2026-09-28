import React, { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MailColumnWidths } from './domain';

type Column = keyof MailColumnWidths;
const sidebarMinimum = 160;
const sidebarCollapseThreshold = 80;
const threadMinimum = 260;
const readerMinimum = 320;
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(value, maximum));

export function mailColumnLayout(width: number, viewport: number, saved?: MailColumnWidths, collapsed = false, sidebarCollapsed = false) {
  const sidebarVisible = viewport > 860 && !sidebarCollapsed;
  const defaults = { sidebar: viewport > 1050 ? 210 : 178,
    threads: viewport > 1050 ? 390 : viewport > 860 ? 340 : Math.max(threadMinimum, Math.round(width * .42)) };
  const sidebar = sidebarVisible ? clamp(saved?.sidebar ?? defaults.sidebar, sidebarMinimum,
    Math.min(480, width - readerMinimum - (collapsed ? 0 : threadMinimum))) : 0;
  const threads = collapsed ? 0 : clamp(saved?.threads ?? defaults.threads, threadMinimum, width - sidebar - readerMinimum);
  return { sidebar, threads, defaults,
    sidebarMaximum: Math.max(sidebarMinimum, Math.min(480, width - threads - readerMinimum)),
    threadMaximum: Math.max(threadMinimum, width - sidebar - readerMinimum) };
}

/** Only this shell renders while dragging; mailbox children keep their identities. */
interface LayoutDraft { readonly widths: MailColumnWidths; readonly sidebarCollapsed: boolean }

export function ResizableMailShell({ children, className, widths, collapsed, sidebarCollapsed = false, mobile, onLayoutChange }: {
  readonly children: ReactNode;
  readonly className: string;
  readonly widths?: MailColumnWidths;
  readonly collapsed: boolean;
  readonly sidebarCollapsed?: boolean;
  readonly mobile: boolean;
  readonly onLayoutChange: (widths: MailColumnWidths, sidebarCollapsed: boolean) => void;
}) {
  const shell = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, viewport: 0 });
  const [draft, setDraft] = useState<LayoutDraft | null>(null);
  const drag = useRef<{ pointer: number; x: number; originWidth: number; initial: MailColumnWidths; handle: HTMLElement } | null>(null);
  const keyboardDraft = useRef<LayoutDraft | null>(null);
  const [dragging, setDragging] = useState(false);
  const sidebarHidden = draft?.sidebarCollapsed ?? sidebarCollapsed;
  const enabled = size.viewport > 640 && !mobile;
  const sidebarRail = enabled && size.viewport > 860 && sidebarHidden ? 20 : 0;
  const layout = mailColumnLayout(size.width - sidebarRail, size.viewport, draft?.widths ?? widths, collapsed, sidebarHidden);
  const currentWidths = () => ({ sidebar: layout.sidebar || widths?.sidebar || layout.defaults.sidebar,
    threads: layout.threads || widths?.threads || layout.defaults.threads });

  useLayoutEffect(() => {
    const element = shell.current;
    if (!element) return;
    const measure = () => {
      const width = Math.round(element.getBoundingClientRect().width);
      const viewport = window.innerWidth;
      setSize(previous => previous.width === width && previous.viewport === viewport ? previous : { width, viewport });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  const cancelDrag = () => {
    const active = drag.current;
    drag.current = null;
    if (active?.handle.hasPointerCapture?.(active.pointer)) active.handle.releasePointerCapture(active.pointer);
    keyboardDraft.current = null; setDraft(null); setDragging(false);
  };
  // A window resize or mobile transition must not save a transient constrained layout.
  useEffect(() => { cancelDrag(); }, [size.width, size.viewport, mobile, collapsed, sidebarCollapsed]);

  const commit = (next: LayoutDraft) => { setDraft(null); onLayoutChange(next.widths, next.sidebarCollapsed); };
  const toggleSidebar = () => commit({ widths: widths ?? currentWidths(), sidebarCollapsed: !sidebarHidden });
  const finishKeyboardResize = () => {
    const next = keyboardDraft.current;
    keyboardDraft.current = null;
    if (next) commit(next);
  };
  const resize = (column: Column, value: number, base = currentWidths()): LayoutDraft => {
    const hide = column === 'sidebar' ? value < sidebarCollapseThreshold : sidebarHidden;
    return { sidebarCollapsed: hide, widths: { ...base,
      // Keep the expanded width when snapping closed, so reopening restores it.
      [column]: column === 'sidebar' && hide ? base.sidebar : Math.round(clamp(value,
        column === 'sidebar' ? sidebarMinimum : threadMinimum,
        column === 'sidebar' ? layout.sidebarMaximum : layout.threadMaximum)) } };
  };
  const handle = (column: Column, label: string, left: number) => <div
    key={column} className={`mail-column-divider is-${column}`} role="separator" tabIndex={0}
    aria-label={label} aria-orientation="vertical" aria-controls={column === 'sidebar' ? 'tap-email-sidebar' : 'tap-email-thread-list-pane'}
    aria-valuemin={column === 'sidebar' ? 0 : threadMinimum}
    aria-valuemax={Math.round(column === 'sidebar' ? layout.sidebarMaximum : layout.threadMaximum)}
    aria-valuenow={Math.round(layout[column])} aria-valuetext={column === 'sidebar' && sidebarHidden ? 'Collapsed' : `${Math.round(layout[column])} pixels`}
    title={column === 'sidebar' ? 'Drag to resize or close. Enter to hide or show. Double-click to reset.' : 'Drag to resize. Arrow keys adjust width. Double-click to reset.'}
    style={{ left }}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      const initial = currentWidths();
      drag.current = { pointer: event.pointerId, x: event.clientX, originWidth: layout[column] + (column === 'sidebar' ? sidebarRail : 0), initial, handle: event.currentTarget };
      event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
    }}
    onPointerMove={event => {
      const active = drag.current;
      if (!active || active.pointer !== event.pointerId) return;
      const next = resize(column, active.originWidth + event.clientX - active.x, active.initial);
      setDraft(next);
    }}
    onPointerUp={event => {
      const active = drag.current;
      if (!active || active.pointer !== event.pointerId) return;
      // Include the final coordinate even if the browser coalesced the last move.
      const next = resize(column, active.originWidth + event.clientX - active.x, active.initial);
      drag.current = null; setDragging(false);
      event.currentTarget.releasePointerCapture(event.pointerId); commit(next);
    }}
    onPointerCancel={cancelDrag} onLostPointerCapture={() => { if (drag.current) cancelDrag(); }}
    onDoubleClick={() => commit(resize(column, layout.defaults[column]))}
    onKeyUp={finishKeyboardResize} onBlur={finishKeyboardResize}
    onKeyDown={event => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancelDrag(); return; }
      if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
      if (column === 'sidebar' && event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation(); if (!event.repeat) toggleSidebar(); return;
      }
      const value = event.key === 'ArrowLeft' ? column === 'sidebar' && layout.sidebar <= sidebarMinimum ? 0 : layout[column] - (event.shiftKey ? 48 : 16)
        : event.key === 'ArrowRight' ? column === 'sidebar' && sidebarHidden ? currentWidths().sidebar : layout[column] + (event.shiftKey ? 48 : 16)
        : event.key === 'Home' ? column === 'sidebar' ? 0 : threadMinimum
        : event.key === 'End' ? column === 'sidebar' ? layout.sidebarMaximum : layout.threadMaximum : null;
      if (value === null) return;
      event.preventDefault(); event.stopPropagation();
      const next = resize(column, value);
      keyboardDraft.current = next; setDraft(next);
    }} />;

  const style: CSSProperties | undefined = enabled && size.width ? {
    gridTemplateColumns: [layout.sidebar ? `${layout.sidebar}px` : null, !collapsed ? `${layout.threads}px` : null, 'minmax(0, 1fr)'].filter(Boolean).join(' '),
    paddingInlineStart: sidebarRail || undefined,
  } : undefined;
  return <main className={`${className}${dragging ? ' is-resizing-columns' : ''}${sidebarHidden ? ' is-sidebar-collapsed' : ''}${sidebarRail ? ' has-sidebar-rail' : ''}`} id="tap-email-main" tabIndex={-1} ref={shell} style={style}>
    {children}
    {enabled && size.width > 0 && size.viewport > 860 ? <>
      {handle('sidebar', 'Resize mailbox sidebar', layout.sidebar + sidebarRail)}
      <button type="button" className="mail-sidebar-toggle" style={{ left: layout.sidebar + sidebarRail }}
        aria-label={sidebarHidden ? 'Show mailbox sidebar' : 'Hide mailbox sidebar'} aria-expanded={!sidebarHidden}
        aria-controls="tap-email-sidebar" title={sidebarHidden ? 'Show mailbox sidebar' : 'Hide mailbox sidebar'}
        onClick={toggleSidebar}>
        {sidebarHidden ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
      </button>
    </> : null}
    {enabled && size.width > 0 && !collapsed ? handle('threads', 'Resize message list', sidebarRail + layout.sidebar + layout.threads) : null}
  </main>;
}
