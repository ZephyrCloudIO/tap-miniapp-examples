import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from '@theaiplatform/miniapp-sdk/ui';
import type { MiniAppInferenceModel } from '@theaiplatform/miniapp-sdk/sdk';
import { ArrowUp, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { generateEmailBody, type ComposerServices } from './composer-services';
import { withoutEmailSignature } from './email-signature';

export function AiWriter({ services, subject, bodyText, onApply, onClose }: {
  readonly services?: ComposerServices;
  readonly subject: string;
  readonly bodyText: string;
  readonly onApply: (body: string) => void;
  readonly onClose: () => void;
}) {
  const [instructions, setInstructions] = useState('');
  const [models, setModels] = useState<readonly MiniAppInferenceModel[]>([]);
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState<{ body: string; base: string; subject: string } | null>(null);
  const request = useRef(0);
  const inFlight = useRef(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const available = Boolean(services?.conversationId && services.platform.inference);
  const stale = proposal && (proposal.base !== bodyText || proposal.subject !== subject);
  useEffect(() => {
    promptRef.current?.focus();
    let active = true;
    if (available && services) {
      void (async () => {
        const access = await services.platform.authorization.check({ actionId: 'inference.list', autonomy: 'listen' });
        if (!access.allowed) throw new Error('AI models are not available in this workspace.');
        const result = await services.platform.inference!.listModels();
        if (!active) return;
        setModels(result);
        setModel(result[0]?.canonicalName ?? '');
        if (!result.length) setError('No AI models are available.');
      })().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load AI models.'); });
    }
    return () => { active = false; request.current++; };
  }, [available, services]);
  const generate = async () => {
    if (inFlight.current || !services || !available || !model || !instructions.trim()) return;
    inFlight.current = true;
    const generation = ++request.current;
    const base = bodyText;
    setBusy(true); setError(''); setProposal(null);
    try {
      const body = await generateEmailBody(services, model, instructions, { subject, bodyText: base });
      if (request.current === generation) setProposal({ body: withoutEmailSignature(body), base, subject });
    } catch (cause) {
      if (request.current === generation) setError(cause instanceof Error ? cause.message : 'Could not generate the draft.');
    } finally {
      if (request.current === generation) { inFlight.current = false; setBusy(false); }
    }
  };
  return <section className="ai-writer" aria-label="Write with AI" data-composer-tool>
    <div className="ai-writer-prompt">
      <Textarea ref={promptRef} aria-label="AI writing instructions" rows={2} maxLength={8_000}
        placeholder="Describe what you’d like to write or change…" value={instructions}
        onChange={event => setInstructions(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); void generate(); }
        }} />
      <Button type="button" size="icon-sm" aria-label="Generate draft" disabled={busy || !available || !model || !instructions.trim()}
        onClick={() => { void generate(); }}><ArrowUp aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Close AI writer" onClick={onClose}><X aria-hidden="true" /></Button>
    </div>
    {!available ? <p role="status">Select a conversation in TAP to use Write with AI.</p> : <div className="ai-writer-controls">
      <Select value={model} onValueChange={setModel} disabled={busy || !models.length}>
        <SelectTrigger aria-label="AI model" density="compact"><SelectValue placeholder="Loading models…" /></SelectTrigger>
        <SelectContent>{models.map(item => <SelectItem key={item.canonicalName} value={item.canonicalName}>{item.displayName}</SelectItem>)}</SelectContent>
      </Select>
      <small>{busy ? 'Writing…' : 'Enter to generate · Shift+Enter for a new line'}</small>
    </div>}
    {error ? <p role="alert">{error}</p> : null}
    {proposal ? <div className="ai-writer-result">
      <pre>{proposal.body}</pre>
      {stale ? <p role="status">Your draft changed. Generate again to use the latest version.</p> : null}
      <div className="composer-dialog-actions">
        <Button type="button" disabled={Boolean(stale)} onClick={() => { onApply(proposal.body); onClose(); }}>Use draft</Button>
        <Button type="button" variant="ghost" onClick={() => { void generate(); }}>Try again</Button>
        <Button type="button" variant="ghost" onClick={onClose}>Discard</Button>
      </div>
    </div> : null}
  </section>;
}
