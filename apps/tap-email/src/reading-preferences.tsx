import React from 'react';
import { Checkbox } from '@theaiplatform/miniapp-sdk/ui';
import type { MailPreferences } from './domain';

export function ReadingPreferences({ preferences, onChange }: {
  readonly preferences: MailPreferences;
  readonly onChange: (preferences: MailPreferences) => void;
}) {
  return <>
    <label className="setting-row">
      <span><strong>HTML email</strong><small>Show formatted messages. Turn off to read plain text without running message scripts.</small></span>
      <Checkbox
        checked={preferences.htmlEnabled !== false}
        onCheckedChange={checked => onChange({ ...preferences, htmlEnabled: checked === true })}
      />
    </label>
    <label className="setting-row">
      <span><strong>Embedded JavaScript</strong><small>Allow interactive content inside the isolated message. Requires HTML email.</small></span>
      <Checkbox
        checked={preferences.scriptsEnabled !== false}
        disabled={preferences.htmlEnabled === false}
        onCheckedChange={checked => onChange({ ...preferences, scriptsEnabled: checked === true })}
      />
    </label>
  </>;
}
