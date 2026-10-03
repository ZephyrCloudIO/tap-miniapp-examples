import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VirtualThreadGroups } from '../src/virtual-thread-groups';
import { MailHistorySentinel } from '../src/mail-history-sentinel';
import '../src/styles.css';

function ScrollBenchmark() {
  const [count, setCount] = useState(100);
  const [selected, setSelected] = useState('mail:0');
  const scroll = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => [{ dateKey: 'synthetic', label: 'Synthetic mail',
    items: Array.from({ length: count }, (_, index) => ({ key: `mail:${index}`, index })) }], [count]);
  return <><h1>Continuous mailbox fixture</h1><output aria-label="Loaded mail count">{count}</output>
    <button onClick={() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }}>Scroll to loaded bottom</button>
    <div className="thread-list" aria-label="Email threads" role="listbox" ref={scroll} tabIndex={0}
      style={{ height: 650, width: 430 }}>
      <VirtualThreadGroups groups={groups} scrollRef={scroll} selectedKey={selected}
        renderRow={item => <button key={item.key} className="mail-row" role="option" aria-selected={item.key === selected}
          onClick={() => setSelected(item.key)} style={{ height: 96, width: '100%' }}>Synthetic email {item.index}</button>} />
      <MailHistorySentinel scope={String(count)} pending={false} failed={false} hasMore={count < 1000}
        onLoad={() => setCount(Math.min(1000, count + 100))} />
    </div></>;
}
createRoot(document.getElementById('root')!).render(<ScrollBenchmark />);
