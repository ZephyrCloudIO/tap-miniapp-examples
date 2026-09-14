export interface GoogleAuthorizationPopup {
  opener: unknown;
  close(): void;
}

export type GoogleExternalNavigator = (options: {
  readonly url: string;
}) => void | Promise<void>;

export type GooglePopupOpener = (
  url: string,
  target: string,
  features: string,
) => GoogleAuthorizationPopup | null;

export interface GoogleAuthorizationLaunch {
  readonly completion: Promise<void>;
  readonly openedExternally: boolean;
  readonly popup: GoogleAuthorizationPopup | null;
}

export function launchGoogleAuthorization(
  authorizationUrl: string,
  openExternal: GoogleExternalNavigator | undefined,
  openPopup: GooglePopupOpener,
): GoogleAuthorizationLaunch | null {
  if (openExternal) {
    const completion = openExternal({ url: authorizationUrl });
    return {
      completion: Promise.resolve(completion),
      openedExternally: true,
      popup: null,
    };
  }

  const popup = openPopup(
    authorizationUrl,
    'tap-email-google-connect',
    'popup,width=520,height=720',
  );
  if (!popup) return null;
  popup.opener = null;
  return {
    completion: Promise.resolve(),
    openedExternally: false,
    popup,
  };
}
