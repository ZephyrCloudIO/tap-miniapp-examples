import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';
import {
  applyMiniAppTheme,
  installMiniAppAppearanceSync,
  type MiniAppTheme,
} from '@theaiplatform/miniapp-sdk/web';

function documentTheme(root: HTMLElement): MiniAppTheme | undefined {
  // MCP owns data-theme; TAP's native host uses data-app-theme and classes.
  for (const theme of [root.dataset.theme, root.dataset.appTheme]) {
    if (theme === 'light' || theme === 'dark') return theme;
  }
  if (root.classList.contains('dark')) return 'dark';
  if (root.classList.contains('light')) return 'light';
  return undefined;
}

/** Consume host appearance in its document; only isolated TAP frames write it. */
export function installEmailAppearanceSync({
  container,
  context,
  nativeHeader,
  embedded,
  render,
}: {
  readonly container: HTMLElement;
  readonly context: TapFederatedSurfaceMountContext;
  readonly nativeHeader: boolean;
  readonly embedded: boolean;
  readonly render: (theme: MiniAppTheme) => void;
}): () => void {
  const root = container.ownerDocument.documentElement;
  const view = container.ownerDocument.defaultView!;
  const hostOwnsDocument = nativeHeader || embedded || view.parent === view;
  let currentTheme: MiniAppTheme | undefined;
  const update = (theme: MiniAppTheme) => {
    if (theme === currentTheme) return;
    currentTheme = theme;
    render(theme);
  };

  if (!hostOwnsDocument) {
    return installMiniAppAppearanceSync({
      applyTheme(theme) {
        applyMiniAppTheme(theme);
        // Keep the SDK's semantic tokens and Email's reader on the same theme.
        root.dataset.theme = theme;
        update(theme);
      },
    });
  }

  const observer = new view.MutationObserver(() => update(documentTheme(root) ?? 'light'));
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-app-theme', 'class'] });
  const stopNativePresentation = nativeHeader
    ? context.events.subscribe('tap.mobile.presentation', payload => {
      if (payload && typeof payload === 'object' && 'theme' in payload &&
          (payload.theme === 'light' || payload.theme === 'dark')) update(payload.theme);
    })
    : () => {};
  update(documentTheme(root) ?? 'light');
  return () => {
    observer.disconnect();
    stopNativePresentation();
  };
}
