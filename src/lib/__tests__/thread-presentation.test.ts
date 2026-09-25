import { describe, expect, it } from 'vitest';
import type { Email, Identity, Mailbox } from '../../api/types';
import { initiallyExpandedThreadMessage, messageDeliveryContext, threadMessageFolder } from '../thread-presentation';

const message = (id: string, mailboxIds: Record<string, boolean>): Email => ({
  id, threadId: 'baq', mailboxIds, keywords: {}, size: 0,
  receivedAt: '2026-09-24T22:39:00Z', hasAttachment: false,
});
const mailbox = (id: string, name: string, role: string, originalId?: string): Mailbox => ({
  id, originalId, name, role, totalEmails: 0, unreadEmails: 0,
  totalThreads: 0, unreadThreads: 0, myRights: {} as Mailbox['myRights'],
});

describe('thread presentation', () => {
  it('explains why a company-sent message appears in the personal Inbox', () => {
    const identities = [{ id: 'own', email: 'ebenezer.collins@zyndpay.io' }] as Identity[];
    const receivedCopy = {
      to: [{ email: 'stephanie.mekantus@reap.global' }],
      cc: [{ email: 'ebenezer.collins@zyndpay.io' }, { email: 'support@zyndpay.io' }],
    };
    expect(messageDeliveryContext(receivedCopy, identities, false)).toEqual({
      kind: 'copied', address: 'ebenezer.collins@zyndpay.io',
    });
    expect(messageDeliveryContext(receivedCopy, identities, true)).toEqual({
      kind: 'sent', address: 'stephanie.mekantus@reap.global',
    });
  });

  it('does not claim a recipient is the user without an identity match', () => {
    const identities = [{ id: 'own', email: 'ebenezer.collins@zyndpay.io' }] as Identity[];
    expect(messageDeliveryContext({ to: [{ email: 'someone@example.com' }] }, identities, false)).toEqual({
      kind: 'to', address: 'someone@example.com',
    });
    expect(messageDeliveryContext({ cc: [{ email: 'ebenezer.collins+mail@zyndpay.io' }] }, identities, false)).toEqual({
      kind: 'copied', address: 'ebenezer.collins+mail@zyndpay.io',
    });
  });

  it('opens only the message selected from Inbox, even when a Sent reply is newer', () => {
    const messages = [message('inbox', { inbox: true }), message('sent', { sent: true })];
    expect(initiallyExpandedThreadMessage('inbox', messages)).toBe('inbox');
    expect(initiallyExpandedThreadMessage('sent', messages)).toBe('sent');
  });

  it('labels each message with its own folder, including shared-account raw ids', () => {
    const folders = [
      mailbox('account:inbox', 'Inbox', 'inbox', 'inbox'),
      mailbox('account:sent', 'Sent', 'sent', 'sent'),
    ];
    expect(threadMessageFolder(message('first', { inbox: true }), folders, 'account:inbox')).toBe('Inbox');
    expect(threadMessageFolder(message('reply', { sent: true }), folders, 'account:inbox')).toBe('Sent');
    expect(threadMessageFolder(message('missing', { other: true }), folders, 'account:inbox')).toBeNull();
  });
});
