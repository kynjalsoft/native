import { describe, it, expect, vi } from 'vitest';

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
} from '../push-background-task';
import type { Email } from '../../api/types';

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
