import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Textarea } from '@theaiplatform/miniapp-sdk/ui';
import { Ellipsis } from 'lucide-react';
import React, { useLayoutEffect, useState, type RefObject } from 'react';
import { EMAIL_SIGNATURE } from './email-signature';

export function MessageEditor({
  inputRef, label, name, onValueChange, placeholder, value, variant,
}: {
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
  readonly label: string;
  readonly name: string;
  readonly onValueChange: (value: string) => void;
  readonly placeholder: string;
  readonly value: string;
  readonly variant: 'compose' | 'reply';
}) {
  const [signatureOpen, setSignatureOpen] = useState(false);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const resize = () => {
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight}px`;
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    let width = input.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [inputRef, value]);

  return (
    <div className={`message-editor is-${variant}`}>
      <Textarea
        ref={inputRef}
        aria-label={label}
        autoComplete="off"
        className="message-editor-input"
        name={name}
        onChange={event => onValueChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        value={value}
      />
      <Collapsible className="message-signature" open={signatureOpen} onOpenChange={setSignatureOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm"
            aria-label={signatureOpen ? 'Hide signature' : 'Show signature'}
            title={signatureOpen ? 'Hide signature' : 'Show signature'}>
            <Ellipsis aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="message-signature-content">
          <p>{EMAIL_SIGNATURE}</p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
