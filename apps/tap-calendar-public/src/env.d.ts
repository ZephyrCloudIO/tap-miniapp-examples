declare const __TAP_CALENDAR_PUBLIC_API_URL__: string;

declare module "*.css";

interface Window {
  turnstile?: {
    render(
      container: HTMLElement,
      options: {
        sitekey: string;
        action?: string;
        appearance?: "always" | "execute" | "interaction-only";
        callback(token: string): void;
        "error-callback"?(): void;
        "expired-callback"?(): void;
        "timeout-callback"?(): void;
      },
    ): string;
    reset(widgetId: string): void;
    remove(widgetId: string): void;
  };
}
