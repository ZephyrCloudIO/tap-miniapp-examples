import { useEffect, useEffectEvent, useSyncExternalStore } from 'react';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';

export interface NativeHeaderAction {
  readonly id: string;
  readonly label: string;
  readonly icon: 'menu' | 'plus' | 'compose' | 'refresh' | 'settings' | 'check';
  readonly primary?: boolean;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly onPress: () => void;
}

export function useCompactLayout() {
  return useSyncExternalStore(subscribeCompact, compactSnapshot, () => false);
}
function compactSnapshot() { return window.matchMedia?.('(max-width: 700px), (max-height: 500px)').matches ?? false; }
function subscribeCompact(listener: () => void) {
  const media = window.matchMedia?.('(max-width: 700px), (max-height: 500px)');
  if (!media) return () => {};
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}

/** Custom drawers use the same dismissal and focus boundary as SDK dialogs. */
export function useMobileDismiss(open: boolean, onClose: () => void, selector: string) {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!open || !document.documentElement.dataset.tapMobile) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = document.querySelector<HTMLElement>(selector);
    panel?.querySelector<HTMLElement>('button, [href], input, [tabindex="0"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (visibleDialogs().at(-1) !== panel) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex="0"]')].filter(item => item.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [open, selector]);
}

function visibleDialogs() {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')]
    .filter(item => item.dataset.state !== 'closed' && item.getClientRects().length > 0);
}

/** Mobile entry points replace standalone chrome with this native-owned header. */
export function NativeHeader({ context, title, actions, back }: {
  context: TapFederatedSurfaceMountContext;
  title: string;
  actions: readonly NativeHeaderAction[];
  back?: { label: string; onPress: () => void } | undefined;
}) {
  const activate = useEffectEvent((payload: unknown) => {
    if (!payload || typeof payload !== 'object' || !('id' in payload)) return;
    const action = actions.find(action => action.id === payload.id);
    if (action && !action.disabled && !action.busy) action.onPress();
  });
  const navigateBack = useEffectEvent(() => {
    const dialog = visibleDialogs().at(-1);
    if (dialog) {
      // Invoke the top SDK dialog's own close control. A newly portaled child
      // may render before Radix installs its Escape layer; dispatching Escape
      // during that interval would dismiss the underlying composer instead.
      const close = [...dialog.querySelectorAll<HTMLButtonElement>('[data-testid="dialog-close-button"] button, button[data-testid="dialog-close-button"], button.sr-only[aria-hidden="true"][tabindex="-1"]')]
        .find(button => button.closest('[role="dialog"]') === dialog);
      if (close) { close.click(); return; }
      const target = dialog.contains(document.activeElement) ? document.activeElement! : dialog;
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    } else back?.onPress();
  });
  const backLabel = back?.label ?? 'Back to apps';
  const canGoBack = Boolean(back);
  useEffect(() => context.events.subscribe('tap.mobile.back', navigateBack), [context]);
  useEffect(() => {
    let previous = '';
    const update = () => {
      const dialogs = visibleDialogs();
      for (const dialog of dialogs) {
        if (dialog.dataset.component !== 'DialogContent') continue;
        const frame = dialog.parentElement;
        frame?.setAttribute('data-tap-dialog-frame', '');
        frame?.previousElementSibling?.setAttribute('data-tap-dialog-backdrop', '');
      }
      const overlay = dialogs.length > 0;
      const descriptor = JSON.stringify({ canGoBack: canGoBack || overlay, backLabel: overlay ? 'Close overlay' : backLabel, overlay });
      if (descriptor === previous) return;
      previous = descriptor;
      void context.events.publish('tap.mobile.surface', JSON.parse(descriptor));
    };
    // SDK dialogs can be portaled and nested. Observe their semantic lifecycle
    // so every dialog coordinates native chrome, including child miniapp forms.
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'aria-modal', 'data-state'] });
    update();
    return () => observer.disconnect();
  }, [context, canGoBack, backLabel]);
  const descriptor = JSON.stringify({ title, actions: actions.map(({ onPress: _onPress, ...action }) => action) });
  useEffect(() => context.events.subscribe('tap.mobile.header.action', activate), [context]);
  useEffect(() => {
    void context.events.publish('tap.mobile.header', JSON.parse(descriptor));
  }, [context, descriptor]);
  return null;
}
