import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../api/jmap-client', () => ({
  jmapClient: {
    accountId: 'jmap-primary',
    getStoredCredentials: vi.fn(async () => null),
    setStoredCredentials: vi.fn(async () => undefined),
  },
}));
vi.mock('../client-cert', () => ({ secureFetch: vi.fn(async () => ({ ok: false, status: 500 })) }));
vi.mock('../oauth', () => ({ refreshOAuthAccessToken: vi.fn(async (t: unknown) => t) }));

import {
  matchAccountsForPush,
  parseRelayPushData,
  selectNotifiableEmails,
  notificationIdForEmail,
  pushBackgroundTask,
  visibleMailNotification,
} from '../push-background-task';
import type { Email } from '../../api/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';
import { jmapClient } from '../../api/jmap-client';
import { secureFetch } from '../client-cert';
import { CAPABILITIES } from '../../api/types';

describe('parseRelayPushData', () => {
  it('decodes the relay FCM data payload (all values are strings)', () => {
    const parsed = parseRelayPushData({
      kind: 'jmap-email-push',
      accountLabel: 'alice',
      accountId: 'a1',
      emailIds: JSON.stringify(['m1', 'm2']),
      changed: JSON.stringify({ a1: { EmailDelivery: 's1' } }),
    });
    expect(parsed).toEqual({
      kind: 'jmap-email-push',
      accountLabel: 'alice',
      jmapAccountId: 'a1',
      emailIds: ['m1', 'm2'],
      changed: { a1: { EmailDelivery: 's1' } },
    });
  });

  it('falls back to the first key of `changed` for the account id', () => {
    const parsed = parseRelayPushData({
      kind: 'jmap-state-change',
      emailIds: '[]',
      changed: JSON.stringify({ a9: { Email: 'x' } }),
    });
    expect(parsed.jmapAccountId).toBe('a9');
    expect(parsed.emailIds).toEqual([]);
  });

  it('tolerates garbage', () => {
    expect(parseRelayPushData(null).emailIds).toEqual([]);
    expect(parseRelayPushData({ emailIds: '{not json' }).emailIds).toEqual([]);
    expect(parseRelayPushData({ kind: 'weird' }).kind).toBeNull();
  });
});

describe('visibleMailNotification', () => {
  it('falls back to the safe address for a blank sender name', () => {
    expect(visibleMailNotification({
      from: [{ name: '  \n  ', email: 'ada@example.com' }],
      subject: 'Project update', preview: 'A safe snippet',
    } as Email, true)).toEqual({
      title: 'ada@example.com', body: 'Project update\nA safe snippet',
    });
  });
});

describe('matchAccountsForPush', () => {
  const accounts = ['alice@mail.example.com', 'bob@mail.example.com'];
  const registry = [
    { id: 'alice@mail.example.com', username: 'alice' },
    { id: 'bob@mail.example.com', username: 'bob' },
  ];

  it('matches on the recorded JMAP account id first', () => {
    const payload = parseRelayPushData({ accountId: 'jb', accountLabel: 'alice' });
    expect(matchAccountsForPush(payload, accounts, { 'bob@mail.example.com': 'jb' }, registry))
      .toEqual(['bob@mail.example.com']);
  });

  it('falls back to the relay accountLabel (username)', () => {
    const payload = parseRelayPushData({ accountId: 'unknown', accountLabel: 'alice' });
    expect(matchAccountsForPush(payload, accounts, {}, registry)).toEqual(['alice@mail.example.com']);
  });

  it('does not wake unrelated accounts when nothing matches', () => {
    const payload = parseRelayPushData({ accountId: 'unknown', accountLabel: 'carol' });
    expect(matchAccountsForPush(payload, accounts, {}, registry)).toEqual([]);
  });

  it('ignores an ambiguous relay label shared by accounts on different servers', () => {
    const payload = parseRelayPushData({ accountLabel: 'alice' });
    const sameName = ['alice@mail.one.test', 'alice@mail.two.test'];
    expect(matchAccountsForPush(payload, sameName, {}, sameName.map((id) => ({ id, username: 'alice' }))))
      .toEqual([]);
  });
});

it('uses separate notification tags across local and shared JMAP accounts', () => {
  expect(notificationIdForEmail('alice@mail.example.com', 'primary', 'm1'))
    .not.toBe(notificationIdForEmail('bob@mail.example.com', 'primary', 'm1'));
  expect(notificationIdForEmail('alice@mail.example.com', 'primary', 'm1'))
    .not.toBe(notificationIdForEmail('alice@mail.example.com', 'shared', 'm1'));
});

describe('Android headless mail presentation', () => {
  const accountId = 'alice@mail.example.com';
  const native = { showNotification: vi.fn(async (_options: unknown) => undefined),
    dismissMailNotifications: vi.fn(async (_id: string) => undefined) };
  let fetchEmail: ((id: string) => Promise<Email>) | null = null;

  beforeEach(async () => {
    await AsyncStorage.clear();
    vi.clearAllMocks();
    (NativeModules as Record<string, unknown>).BulwarkFcm = native;
    vi.mocked(jmapClient.getStoredCredentials).mockResolvedValue({
      serverUrl: 'https://mail.example.com', accessToken: 'token', username: 'alice',
    } as never);
    await AsyncStorage.setItem('push:accountIds:v1', JSON.stringify([accountId]));
    await AsyncStorage.setItem('push:jmapAccountIds:v1', JSON.stringify({ [accountId]: 'u1' }));
    await AsyncStorage.setItem('account-registry', JSON.stringify({ state: { accounts: [
      { id: accountId, username: 'alice' },
    ] } }));
    fetchEmail = async (id) => ({ id, threadId: 'thread-1', mailboxIds: { inbox: true },
      keywords: {}, receivedAt: '2026-09-26T10:00:00Z', from: [{ name: 'Ada', email: 'ada@example.com' }],
      subject: 'Project update', preview: 'A safe snippet' } as Email);
    vi.mocked(secureFetch).mockImplementation(async (url, init) => {
      if (String(url).includes('/.well-known/jmap')) return { ok: true, json: async () => ({
        apiUrl: 'https://mail.example.com/jmap', primaryAccounts: { [CAPABILITIES.MAIL]: 'u1' },
      }) } as Response;
      const call = JSON.parse(String(init?.body)).methodCalls[0];
      const response = call[0] === 'Email/get'
        ? ['Email/get', { list: [await fetchEmail!(call[1].ids[0])] }, '0']
        : ['Mailbox/get', { list: [{ id: 'inbox', role: 'inbox' }] }, '0'];
      return { ok: true, json: async () => ({ methodResponses: [response] }) } as Response;
    });
  });

  it('uses generic text when previews are off and sanitized message text when on', async () => {
    await AsyncStorage.setItem('webmail:settings:v1', JSON.stringify({
      emailNotificationsEnabled: true, notificationPreviewsEnabled: false,
    }));
    await pushBackgroundTask({ accountId: 'u1', emailIds: JSON.stringify(['m1']) });
    expect(native.showNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: 'ZyndMail', body: 'New mail', groupTitle: 'ZyndMail', initials: 'ZM', previews: false,
    }));
    expect(native.showNotification.mock.calls[0][0]).not.toHaveProperty('subject');
    await AsyncStorage.setItem('webmail:settings:v1', JSON.stringify({
      emailNotificationsEnabled: true, notificationPreviewsEnabled: true,
    }));
    fetchEmail = async (id) => ({ id, threadId: 'thread-1', mailboxIds: { inbox: true },
      keywords: {}, receivedAt: '2026-09-26T10:00:00Z', from: [{ name: 'Ada', email: 'ada@example.com' }],
      subject: 'Project <b>update</b>', preview: 'Line one\u202e<script>bad</script> line two' } as Email);
    await pushBackgroundTask({ accountId: 'u1', emailIds: JSON.stringify(['m2']) });
    expect(native.showNotification).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Ada', body: 'Project update\nLine one bad line two', previews: true,
    }));
    expect(native.showNotification.mock.calls[1][0]).not.toHaveProperty('subject');
  });

  it('does not post after account teardown wins a pending mail fetch', async () => {
    let finish!: (email: Email) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    fetchEmail = (id) => { started(); return new Promise((resolve) => { finish = resolve; }); };
    const processing = pushBackgroundTask({ accountId: 'u1', emailIds: JSON.stringify(['m1']) });
    await entered;
    await AsyncStorage.removeItem('push:accountIds:v1');
    finish({ id: 'm1', threadId: 'thread-1', mailboxIds: { inbox: true }, keywords: {},
      receivedAt: '2026-09-26T10:00:00Z', subject: 'Private' } as Email);
    await processing;
    expect(native.showNotification).not.toHaveBeenCalled();
  });

  it('dismisses a card if teardown wins during native posting', async () => {
    native.showNotification.mockImplementationOnce(async () => {
      await AsyncStorage.removeItem('push:accountIds:v1');
    });
    await pushBackgroundTask({ accountId: 'u1', emailIds: JSON.stringify(['m1']) });
    expect(native.showNotification).toHaveBeenCalledOnce();
    expect(native.dismissMailNotifications).toHaveBeenCalledWith(accountId);
  });
});

describe('selectNotifiableEmails', () => {
  const email = (id: string, keywords: Record<string, boolean> = {}): Email =>
    ({ id, threadId: 't', keywords, mailboxIds: {}, size: 0, receivedAt: '', hasAttachment: false } as Email);

  it('drops read, junk and already-notified messages', () => {
    const out = selectNotifiableEmails(
      [email('a'), email('b', { $seen: true }), email('c', { $junk: true }), email('d')],
      ['d'],
    );
    expect(out.map((e) => e.id)).toEqual(['a']);
  });

  it('drops mail moved into junk, trash, drafts or sent before the push is processed', () => {
    const moved = { ...email('moved'), mailboxIds: { junkMailbox: true } } as Email;
    expect(selectNotifiableEmails([moved, email('allowed')], [], new Set(['junkMailbox'])).map((item) => item.id))
      .toEqual(['allowed']);
  });
});
