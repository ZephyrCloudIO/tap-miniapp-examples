/** @rstest-environment jsdom */
import { createHash, webcrypto } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createCoordinatorClient } from './coordinator-client';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, rstest as rs } from '@rstest/core';
import {
  calendarEventKey,
  parseCalendarInvitations,
} from '@tap-examples/tap-email-protocol/calendar';
import type { MailCommand } from '@tap-examples/tap-email-protocol';
import {
  CalendarMessage,
  calendarResponseKey,
  calendarResponseStates,
  type CalendarReaderServices,
} from './calendar-invitation';
import { ConversationQueryCache } from './conversation-query-cache';
import { previewMailState, settleMailCommand, isMailState } from './domain';
import { recoverMailJournal } from './mail-persistence';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const source = (method = 'REQUEST', status = 'NEEDS-ACTION') =>
  `BEGIN:VCALENDAR\nVERSION:2.0\nMETHOD:${method}\nBEGIN:VEVENT\nUID:event_1\nDTSTART:20261005T220000Z\nDTEND:20261005T230000Z\nSUMMARY:Account review\nORGANIZER;CN=Host:mailto:host@example.com\nATTENDEE;CN=Jane;PARTSTAT=${status}:mailto:viewer@example.com\nEND:VEVENT\nEND:VCALENDAR`;
const attachment = {
  resourceId: 'att_1',
  fileName: 'invite.ics',
  mimeType: 'text/calendar',
  sizeBytes: 500,
  disposition: 'attachment' as const,
  contentId: null,
};
const context = {
  accountId: 'acct_1',
  threadId: 'thread_1',
  messageId: 'msg_1',
  providerRevision: '123',
};
const command: MailCommand = {
  v: 1,
  commandId: 'cmd_1',
  idempotencyKey: 'rsvp_1',
  accountId: 'acct_1',
  threadId: 'thread_1',
  kind: 'calendar_rsvp',
  createdAt: '2026-10-03T20:00:00Z',
  expectedProviderRevision: '123',
  payload: {
    messageId: 'msg_1',
    resourceId: 'att_1',
    eventKey: calendarEventKey(parseCalendarInvitations(source())[0]!),
    response: 'accepted',
    expectedContext: { userId: 'user_1', workspaceId: 'org_1' },
  },
};
async function ready() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}
function services(cache: ConversationQueryCache): CalendarReaderServices {
  return {
    cache,
    respond: rs.fn(),
    addresses: new Map([['acct_1', 'viewer@example.com']]),
    responses: new Map(),
  };
}
describe('cached calendar message cards', () => {
  it.each([
    ['REQUEST', 'NEEDS-ACTION', 'Will you attend?', 3],
    ['REPLY', 'ACCEPTED', 'Jane has accepted', 0],
  ])('renders %s from the credential-safe download and reopens without another request', async (method, status, label, actions) => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    const bytes = new TextEncoder().encode(source(method, status));
    const metadata = { ...attachment, sizeBytes: bytes.length };
    let requests = 0;
    const client = createCoordinatorClient({ request(input, options) {
      requests += 1;
      expect(input.headers).toContainEqual({ name: 'Accept', value: 'application/json' });
      expect(options).toEqual({ credentialRef: 'platform-session' });
      const bodyText = JSON.stringify({
        version: 1, accountId: context.accountId, threadId: context.threadId, messageId: context.messageId,
        resourceId: metadata.resourceId, mimeType: metadata.mimeType, totalSizeBytes: bytes.length,
        offset: 0, sizeBytes: bytes.length,
        sha256Base64Url: createHash('sha256').update(bytes).digest('base64url'),
        bodyBase64: Buffer.from(bytes).toString('base64'),
      });
      return { finalUrl: input.url, status: 200, statusText: 'OK', headers: [],
        bodyKind: 'text', bodyText, bodyBase64: null, bodyTruncated: false,
        sizeBytes: Buffer.byteLength(bodyText), contentType: 'application/json', elapsedMs: 1 };
    } });
    const cache = new ConversationQueryCache();
    const reader = services(cache);
    const node = document.createElement('div');
    const root = createRoot(node);
    const render = () => root.render(<StrictMode><CalendarMessage attachments={[metadata]} context={context}
      services={reader} loadAttachment={(file) => client.downloadAttachment(context, file)} /></StrictMode>);
    try {
      await act(async () => render());
      await ready();
      expect(node.textContent).toContain('Account review');
      expect(node.textContent).toContain(label);
      expect(node.querySelectorAll('.calendar-rsvp button')).toHaveLength(actions);
      expect(node.querySelector('[role="alert"]')).toBeNull();
      await act(async () => root.render(null));
      await act(async () => render());
      await ready();
      expect(requests).toBe(1);
      expect(reader.respond).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      cache.clear();
      if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
    }
  });
  it('renders the event and actions, deduplicates Strict Mode and cached reopens, contains keyboard events', async () => {
    const cache = new ConversationQueryCache();
    const reader = services(cache);
    const load = rs.fn(async () => new TextEncoder().encode(source()));
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    const parentKey = rs.fn();
    const render = () =>
      root.render(
        <StrictMode>
          <div onKeyDown={parentKey}>
            <CalendarMessage
              attachments={[attachment]}
              context={context}
              services={reader}
              loadAttachment={load}
            />
          </div>
        </StrictMode>,
      );
    try {
      await act(async () => render());
      await ready();
      expect(node.textContent).toContain('Account review');
      expect(node.textContent).toContain('Will you attend?');
      expect(node.querySelectorAll('.calendar-rsvp button')).toHaveLength(3);
      const yes = node.querySelector<HTMLButtonElement>(
        '.calendar-rsvp button',
      )!;
      await act(async () => {
        yes.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'j', bubbles: true }),
        );
        yes.click();
      });
      expect(parentKey).not.toHaveBeenCalled();
      expect(reader.respond).toHaveBeenCalledWith(
        context,
        expect.objectContaining({ response: 'accepted', messageId: 'msg_1' }),
      );
      await act(async () => root.render(null));
      await act(async () => render());
      await ready();
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      cache.clear();
      node.remove();
    }
  });
  it('renders one card for identical inline and named calendar parts', async () => {
    const cache = new ConversationQueryCache();
    const reader = services(cache);
    const load = rs.fn(async () => new TextEncoder().encode(source()));
    const node = document.createElement('div');
    const root = createRoot(node);
    try {
      await act(async () =>
        root.render(
          <CalendarMessage
            attachments={[
              attachment,
              {
                ...attachment,
                resourceId: 'inline_calendar',
                disposition: 'inline',
              },
            ]}
            context={context}
            services={reader}
            loadAttachment={load}
          />,
        ),
      );
      await ready();
      expect(node.querySelectorAll('.calendar-invitation')).toHaveLength(1);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => root.unmount());
      cache.clear();
    }
  });
  it.each([
    ['REPLY', 'ACCEPTED', 'Jane has accepted'],
    ['CANCEL', 'NEEDS-ACTION', 'Event canceled'],
  ])('renders %s without RSVP controls', async (method, status, label) => {
    const cache = new ConversationQueryCache();
    const reader = services(cache);
    const node = document.createElement('div');
    const root = createRoot(node);
    try {
      await act(async () =>
        root.render(
          <CalendarMessage
            attachments={[attachment]}
            context={context}
            services={reader}
            loadAttachment={async () =>
              new TextEncoder().encode(source(method, status))
            }
          />,
        ),
      );
      await ready();
      expect(node.textContent).toContain(label);
      expect(node.querySelector('.calendar-rsvp')).toBeNull();
      expect(reader.respond).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      cache.clear();
    }
  });
  it.each(['pending', 'uncertain', 'applied'] as const)(
    'shows %s response state after a reader reopen',
    async (state) => {
      const cache = new ConversationQueryCache();
      const record =
        state === 'pending'
          ? ('pending' as const)
          : {
              command,
              receipt: {
                commandId: command.commandId,
                idempotencyKey: command.idempotencyKey,
                accountId: command.accountId,
                state,
                acceptedAt: command.createdAt,
                providerAcknowledgedAt:
                  state === 'applied' ? command.createdAt : null,
                errorCode: null,
              },
            };
      const reader = {
        ...services(cache),
        responses: new Map([
          [
            calendarResponseKey(
              'acct_1',
              'msg_1',
              'att_1',
              String(command.payload.eventKey),
            ),
            record,
          ],
        ]),
      };
      const node = document.createElement('div');
      const root = createRoot(node);
      try {
        await act(async () =>
          root.render(
            <CalendarMessage
              attachments={[attachment]}
              context={context}
              services={reader}
              loadAttachment={async () => new TextEncoder().encode(source())}
            />,
          ),
        );
        await ready();
        const buttons = [
          ...node.querySelectorAll<HTMLButtonElement>('.calendar-rsvp button'),
        ];
        expect(buttons).toHaveLength(3);
        expect(buttons.every((button) => button.disabled)).toBe(
          state !== 'applied',
        );
        if (state === 'applied')
          expect(node.textContent).toContain('You responded Yes.');
        else {
          buttons[0]!.click();
          expect(reader.respond).not.toHaveBeenCalled();
        }
      } finally {
        await act(async () => root.unmount());
        cache.clear();
      }
    },
  );
  it('offers a retry for unavailable bytes and hides RSVP for an unverified attendee', async () => {
    const cache = new ConversationQueryCache();
    const load = rs.fn(async (): Promise<Uint8Array> => {
      throw new Error('offline');
    });
    const reader = { ...services(cache), addresses: new Map<string, string>() };
    const node = document.createElement('div');
    const root = createRoot(node);
    try {
      await act(async () =>
        root.render(
          <CalendarMessage
            attachments={[attachment]}
            context={context}
            services={reader}
            loadAttachment={load}
          />,
        ),
      );
      await ready();
      expect(node.querySelector('[role="alert"]')?.textContent).toContain(
        'could not be loaded',
      );
      load.mockImplementation(async () => new TextEncoder().encode(source()));
      await act(async () =>
        node.querySelector<HTMLButtonElement>('button')!.click(),
      );
      await ready();
      expect(node.textContent).toContain('Account review');
      expect(node.textContent).toContain('Respond from the calendar account');
      expect(node.querySelector('.calendar-rsvp')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      cache.clear();
    }
  });
  it('scopes downloaded projections and response status to the account and provider revision', async () => {
    const cache = new ConversationQueryCache();
    const reader = services(cache);
    const load = rs.fn(async () => new TextEncoder().encode(source()));
    const node = document.createElement('div');
    const root = createRoot(node);
    try {
      for (const next of [
        context,
        { ...context, providerRevision: '124' },
        { ...context, accountId: 'acct_2' },
      ]) {
        await act(async () =>
          root.render(
            <CalendarMessage
              attachments={[attachment]}
              context={next}
              services={reader}
              loadAttachment={load}
            />,
          ),
        );
        await ready();
      }
      expect(load).toHaveBeenCalledTimes(3);
      expect(calendarResponseKey('acct_1', 'msg_1', 'att_1', 'event')).not.toBe(
        calendarResponseKey('acct_2', 'msg_1', 'att_1', 'event'),
      );
    } finally {
      await act(async () => root.unmount());
      cache.clear();
    }
  });
  it('persists and merges terminal response records through journal recovery', () => {
    const receipt = {
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      accountId: command.accountId,
      state: 'uncertain' as const,
      acceptedAt: command.createdAt,
      providerAcknowledgedAt: null,
      errorCode: 'outcome_unknown',
    };
    const state = settleMailCommand(
      { ...previewMailState(), commands: [command] },
      command,
      receipt,
      command.createdAt,
    );
    expect(state.commands).toHaveLength(0);
    expect(state.calendarResponses).toHaveLength(1);
    expect(isMailState(state)).toBe(true);
    const recovered = recoverMailJournal(
      previewMailState(),
      JSON.parse(JSON.stringify(state)),
    );
    expect(recovered.calendarResponses).toEqual(state.calendarResponses);
    expect(recoverMailJournal(recovered, state).calendarResponses).toHaveLength(
      1,
    );
    expect(calendarResponseStates(recovered).size).toBe(1);
  });
});
