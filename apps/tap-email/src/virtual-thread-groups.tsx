import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

type Item = { readonly key: string };
interface Group<T> { readonly dateKey: string; readonly label: string; readonly items: readonly T[] }

export function VirtualThreadGroups<T extends Item>({ groups, scrollRef, selectedKey, renderRow }: {
  readonly groups: readonly Group<T>[];
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly selectedKey: string | null;
  readonly renderRow: (item: T) => ReactNode;
}) {
  const entries = useMemo(() => groups.flatMap(group => [
    { key: `day:${group.dateKey}`, label: group.label, item: null as T | null },
    ...group.items.map(item => ({ key: item.key, label: group.label, item })),
  ]), [groups]);
  const getItemKey = useCallback((index: number) => entries[index]!.key, [entries]);
  // The parent ref attaches after this child's layout effects. Publish it after
  // commit so Virtual can subscribe on the following render, even without mail updates.
  const [scrollElement, setScrollElement] = useState(scrollRef.current);
  useEffect(() => { setScrollElement(scrollRef.current); }, [scrollRef]);
  // Keep one layout mode as batches append; switching modes can pan the scroller.
  const enabled = typeof ResizeObserver !== 'undefined';
  const virtual = useVirtualizer({ count: entries.length, getScrollElement: () => scrollElement,
    getItemKey, initialOffset: () => scrollRef.current?.scrollTop ?? 0,
    estimateSize: index => entries[index]!.item ? 96 : 40, overscan: 8, enabled });
  const lastSelected = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (enabled && !scrollElement) return;
    if (lastSelected.current === selectedKey) return;
    if (!selectedKey) { lastSelected.current = null; return; }
    if (!enabled) return;
    const index = entries.findIndex(item => item.key === selectedKey);
    if (index >= 0) { lastSelected.current = selectedKey; virtual.scrollToIndex(index, { align: 'auto' }); }
  }, [enabled, selectedKey, virtual, scrollElement, entries]);
  if (!enabled) return groups.map(group => <div role="group" aria-label={group.label}
    className="thread-day-group" key={group.dateKey}>
    <div aria-hidden="true" className="thread-day-separator"><span>{group.label}</span></div>
    {group.items.map(renderRow)}
  </div>);
  return <div className="virtual-mail-history" style={{ height: virtual.getTotalSize(), position: 'relative' }}>
    {virtual.getVirtualItems().map(item => {
      const entry = entries[item.index]!;
      return <div key={item.key} data-index={item.index} ref={virtual.measureElement}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}>
        {entry.item ? renderRow(entry.item) : <div aria-hidden="true" className="thread-day-separator"><span>{entry.label}</span></div>}
      </div>;
    })}
  </div>;
}
