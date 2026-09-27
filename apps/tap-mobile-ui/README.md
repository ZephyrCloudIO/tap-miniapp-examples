# Native mobile presentation

Calendar and Email expose `src/mobile.ts` entry points for the native host. Standalone desktop entry points retain their own headers and layouts.

Import `@tap-examples/tap-mobile-ui/styles.css` before app-specific mobile styles. Use `NativeHeader` to contribute a title, actions, and an optional internal Back callback. The host owns app navigation, the status-bar safe area, outer background, and keyboard resizing; the miniapp fills the remaining viewport.

The host initializes `data-tap-mobile`, shared semantic colors, the DM Sans font, and `--tap-font-scale`, `--tap-inset-*`, `--tap-viewport-*`, `--tap-gutter`, `--tap-control-size`, and `--tap-radius`. Live `tap.mobile.presentation` events update theme and viewport without remounting. Apply remaining safe areas once and do not subtract the keyboard height again.

- Give each phone screen a bounded vertical scroller; use `min-height: 0` on flex/grid ancestors. Put gutters on content, leaving list backgrounds full width.
- Use rem typography, focused inputs of at least 16 CSS pixels, and 44–48px touch targets.
- Adapt to narrow width and short landscape height. `useCompactLayout` covers widths up to 700px or available heights up to 500px.
- Expose internal navigation through `NativeHeader.back`. Do not render a second application header.
- Use SDK dialogs or semantic custom drawers. `NativeHeader` coordinates their overlay state with native chrome and dismisses the top dialog through its existing close callback. Custom drawers use `useMobileDismiss` for focus and Escape handling.
- Preserve drafts and screen state during theme, text-size, keyboard, and rotation changes.

The adapter recognizes SDK `data-component="DialogContent"` framing and close controls. Changes to SDK dialog markup require validation with the real bundled surfaces, including nested dialog dismissal.
