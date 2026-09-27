import { Button, Input } from '@theaiplatform/miniapp-sdk/ui';
import React, { useEffect, useId, useLayoutEffect, useRef, useState, type Ref } from 'react';
import {
  completeRecipient, matchRecipients, NO_RECIPIENTS, recipientQuery,
  type RecipientSearch, type RecipientSuggestion,
} from './recipient-history';

export interface RecipientInputProps {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly contacts?: readonly RecipientSuggestion[];
  readonly searchRecipients?: RecipientSearch;
  readonly otherRecipients?: readonly string[];
  readonly ref?: Ref<HTMLInputElement>;
}

const NO_VALUES: readonly string[] = [];

/** SDK input with an accessible, non-modal recipient suggestion list. */
export function RecipientInput({
  id, label, name, value, onValueChange, contacts = NO_RECIPIENTS,
  searchRecipients, otherRecipients = NO_VALUES, ref,
}: RecipientInputProps) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [remote, setRemote] = useState<{ query: string; items: readonly RecipientSuggestion[] } | null>(null);
  const [status, setStatus] = useState<{ query: string; state: 'loading' | 'failed' | 'ready' } | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ above: false, maxHeight: 180 });
  const query = recipientQuery(value);
  const open = focused && Boolean(query) && query !== dismissedQuery;
  const matches = matchRecipients(
    [...contacts, ...(remote?.query === query ? remote.items : NO_RECIPIENTS)],
    query, [value, ...otherRecipients],
  );
  const selectedIndex = Math.min(activeIndex, matches.length - 1);
  const state = status?.query === query ? status.state : 'ready';

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const root = rootRef.current;
      if (!root) return;
      const bounds = root.getBoundingClientRect();
      let top = 0;
      let bottom = window.innerHeight;
      // Stay within both the viewport and the reader/dialog scroll container.
      for (let parent = root.parentElement; parent; parent = parent.parentElement) {
        if (!/auto|scroll|hidden|clip/u.test(window.getComputedStyle(parent).overflowY)) continue;
        const clip = parent.getBoundingClientRect();
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
      const below = bottom - bounds.bottom - 8;
      const above = bounds.top - top - 8;
      const opensAbove = below < 236 && above > below;
      const maxHeight = Math.min(180, Math.max(40, (opensAbove ? above : below) - 56));
      setPlacement(previous => previous.above === opensAbove && previous.maxHeight === maxHeight
        ? previous : { above: opensAbove, maxHeight });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !searchRecipients) return;
    let current = true;
    setStatus({ query, state: 'loading' });
    const timer = window.setTimeout(() => {
      void searchRecipients(query).then(items => {
        if (!current) return;
        setRemote({ query, items });
        setStatus({ query, state: 'ready' });
      }, () => {
        if (!current) return;
        setRemote(null);
        setStatus({ query, state: 'failed' });
      });
    }, 180);
    return () => { current = false; window.clearTimeout(timer); };
  }, [open, query, searchRecipients]);

  const choose = (recipient: RecipientSuggestion) => {
    onValueChange(completeRecipient(value, recipient.address));
    setDismissedQuery(recipient.address);
    setActiveIndex(0);
  };
  const statusText = state === 'loading' ? 'Searching sent recipients…'
    : state === 'failed' ? 'Sent history is unavailable. You can still enter an address.'
      : matches.length ? `${matches.length} ${matches.length === 1 ? 'suggestion' : 'suggestions'}. Use arrow keys, then Enter or Tab.`
        : 'No matching sent recipients. Enter an email address.';

  return (
    <div ref={rootRef} className={`recipient-input${open ? ' is-open' : ''}`}>
      <Input
        id={id}
        ref={ref}
        name={name}
        aria-label={label}
        type="email"
        multiple
        density="compact"
        autoComplete="off"
        spellCheck={false}
        data-recipient-input=""
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && selectedIndex >= 0 ? `${listId}-${selectedIndex}` : undefined}
        value={value}
        onChange={event => { setActiveIndex(0); setDismissedQuery(null); onValueChange(event.target.value); }}
        onFocus={() => { setFocused(true); setDismissedQuery(null); }}
        onBlur={() => { setFocused(false); setDismissedQuery(null); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey || (event.key === 'Tab' && event.shiftKey)) return;
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && query) {
            event.preventDefault();
            event.stopPropagation();
            setDismissedQuery(null);
            return;
          }
          if (!open) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setDismissedQuery(query);
          } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
            event.preventDefault();
            event.stopPropagation();
            const index = (selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
            setActiveIndex(index);
            optionRefs.current[index]?.scrollIntoView?.({ block: 'nearest' });
          } else if ((event.key === 'Enter' || event.key === 'Tab') && matches[selectedIndex]) {
            if (event.key === 'Enter') event.preventDefault();
            event.stopPropagation();
            choose(matches[selectedIndex]);
          } else if (event.key === 'Enter') {
            // An incomplete recipient must not submit the reply form.
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      />
      {open ? (
        <div className="recipient-suggestions" data-side={placement.above ? 'top' : 'bottom'}>
          <div id={listId} role="listbox" aria-label={`${label} suggestions`} style={{ maxHeight: placement.maxHeight }}>
            {matches.map((recipient, index) => (
              <Button
                key={recipient.address}
                id={`${listId}-${index}`}
                ref={element => { optionRefs.current[index] = element; }}
                className="recipient-suggestion"
                variant="ghost"
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                tabIndex={-1}
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(recipient)}
              >
                <span>{recipient.name && recipient.name.toLowerCase() !== recipient.address ? recipient.name : recipient.address}</span>
                {recipient.name && recipient.name.toLowerCase() !== recipient.address ? <small>{recipient.address}</small> : null}
              </Button>
            ))}
          </div>
          <p className="recipient-suggestion-status" role="status">{statusText}</p>
        </div>
      ) : null}
    </div>
  );
}
