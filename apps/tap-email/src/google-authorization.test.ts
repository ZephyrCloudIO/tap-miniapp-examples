import { describe, expect, it } from '@rstest/core';
import { launchGoogleAuthorization } from './google-authorization';

describe('Google authorization launch', () => {
  it('invokes external navigation synchronously before returning', () => {
    const events: string[] = [];
    const launch = launchGoogleAuthorization(
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=test',
      options => {
        events.push(`open:${options.url}`);
      },
      () => {
        throw new Error('popup fallback should not run');
      },
    );
    events.push('returned');

    expect(events).toEqual([
      'open:https://accounts.google.com/o/oauth2/v2/auth?client_id=test',
      'returned',
    ]);
    expect(launch).toMatchObject({ openedExternally: true, popup: null });
  });

  it('opens and detaches the popup fallback synchronously', () => {
    const popup = { opener: {}, close() {} };
    const calls: unknown[] = [];
    const launch = launchGoogleAuthorization(
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=test',
      undefined,
      (url, target, features) => {
        calls.push({ url, target, features });
        return popup;
      },
    );

    expect(calls).toEqual([{
      url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test',
      target: 'tap-email-google-connect',
      features: 'popup,width=520,height=720',
    }]);
    expect(popup.opener).toBeNull();
    expect(launch).toMatchObject({ openedExternally: false, popup });
  });
});
