import { Button } from '@theaiplatform/miniapp-sdk/ui';
import { ChevronDown } from 'lucide-react';
import React, { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';

type CopyField = 'cc' | 'bcc';

/** Reveal optional recipients without ever hiding a populated field. */
export function useCopyRecipients(toRef: RefObject<HTMLInputElement | null>, cc: string, bcc: string) {
  const [revealed, setRevealed] = useState({ cc: false, bcc: false });
  const ccRef = useRef<HTMLInputElement>(null);
  const bccRef = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef<'to' | CopyField | null>(null);
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target) ({ to: toRef, cc: ccRef, bcc: bccRef })[target].current?.focus();
  }, [revealed, toRef]);
  return {
    ccRef,
    bccRef,
    ccVisible: revealed.cc || Boolean(cc.trim()),
    bccVisible: revealed.bcc || Boolean(bcc.trim()),
    reveal(field: CopyField) {
      pendingFocus.current = field;
      setRevealed(current => ({ ...current, [field]: true }));
    },
    hide(field: CopyField) {
      if ((field === 'cc' ? cc : bcc).trim()) return;
      pendingFocus.current = 'to';
      setRevealed(current => ({ ...current, [field]: false }));
    },
  };
}

export function RecipientOptions({
  ccVisible, bccVisible, onReveal,
}: {
  readonly ccVisible: boolean;
  readonly bccVisible: boolean;
  readonly onReveal: (field: CopyField) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const initialIndex = useRef(0);
  const menuId = useId();
  const fields = (['cc', 'bcc'] as const).filter(field => field === 'cc' ? !ccVisible : !bccVisible);
  const focusItem = (index: number) => {
    const items = rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (items?.length) items[(index + items.length) % items.length]?.focus();
  };
  useLayoutEffect(() => {
    if (open) focusItem(initialIndex.current);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  if (!fields.length) return null;
  return (
    <div ref={rootRef} className="recipient-options" data-recipient-options=""
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <Button ref={triggerRef} type="button" variant="ghost" size="icon-sm"
        aria-label="Add Cc or Bcc" title="Add Cc or Bcc" aria-haspopup="menu"
        aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => { initialIndex.current = 0; setOpen(current => !current); }}
        onKeyDown={event => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          event.stopPropagation();
          initialIndex.current = event.key === 'ArrowUp' ? fields.length - 1 : 0;
          if (open) focusItem(initialIndex.current);
          else setOpen(true);
        }}
      >
        <ChevronDown aria-hidden="true" />
      </Button>
      {open ? (
        <div id={menuId} className="recipient-options-menu" role="menu" aria-label="Additional recipients"
          onKeyDown={event => {
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            focusItem(event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
              : index + (event.key === 'ArrowDown' ? 1 : -1));
          }}
        >
          {fields.map(field => (
            <Button key={field} type="button" variant="ghost" role="menuitem" tabIndex={-1}
              aria-keyshortcuts={`Meta+Shift+${field === 'cc' ? 'C' : 'B'} Control+Shift+${field === 'cc' ? 'C' : 'B'}`}
              onClick={() => { setOpen(false); onReveal(field); }}
            >
              <span>{field === 'cc' ? 'Cc' : 'Bcc'}</span>
              <kbd aria-hidden="true">⌘⇧{field === 'cc' ? 'C' : 'B'}</kbd>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
