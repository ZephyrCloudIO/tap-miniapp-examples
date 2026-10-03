import React, { useEffect, useState, type ReactNode } from 'react';
const emptyKeys: readonly string[] = [];
const retainAll = () => true;
const noCost = () => 0;
const readerBudgetBytes = 8 * 1024 * 1024;
interface RetainedReader { readonly key: string; readonly bytes: number }

function retainedKeys(previous: readonly RetainedReader[], active: string, warm: readonly string[],
  allowed: (key: string) => boolean, cost: (key: string) => number): RetainedReader[] {
  const previousCosts = new Map(previous.map(entry => [entry.key, entry.bytes]));
  // Query eviction must not erase the charge for bodies still mounted in React.
  const chargeFor = (key: string) => Math.max(previousCosts.get(key) ?? 0, cost(key));
  const candidates = [...new Set([...previous.map(entry => entry.key).filter(allowed), active, ...warm.filter(allowed)])];
  const keep = new Set([active]);
  let bytes = chargeFor(active);
  for (const key of [...warm, ...candidates.toReversed()]) {
    if (keep.has(key) || !allowed(key)) continue;
    const charge = chargeFor(key);
    if (keep.size < 5 && bytes + charge <= readerBudgetBytes) { keep.add(key); bytes += charge; }
  }
  return candidates.filter(key => keep.has(key)).map(key => ({ key, bytes: chargeFor(key) }));
}

/** Keep a few inert readers laid out so switching does not recreate their frames. */
export function ConversationReaderDeck({ activeKey, warmKeys = emptyKeys, canRetain = retainAll, cost = noCost, children }: {
  readonly activeKey: string;
  readonly warmKeys?: readonly string[];
  readonly canRetain?: (key: string) => boolean;
  readonly cost?: (key: string) => number;
  readonly children: (key: string, active: boolean) => ReactNode;
}) {
  const [retained, setRetained] = useState<readonly RetainedReader[]>([]);
  const keys = retainedKeys(retained, activeKey, emptyKeys, canRetain, cost);
  // Preserve DOM order: moving an existing iframe also reloads its document.
  useEffect(() => {
    setRetained(previous => {
      const next = retainedKeys(previous, activeKey, warmKeys, canRetain, cost);
      return next.length === previous.length && next.every((entry, index) =>
        entry.key === previous[index]!.key && entry.bytes === previous[index]!.bytes) ? previous : next;
    });
  }, [activeKey, warmKeys, canRetain, cost]);
  return <div className="conversation-deck">{keys.map(({ key }) => {
    const active = key === activeKey;
    return <div key={key} aria-hidden={!active} inert={!active} data-reader-active={active}>
      {children(key, active)}
    </div>;
  })}</div>;
}
