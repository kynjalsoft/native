import { describe, expect, it } from 'vitest';
import type { Email, Mailbox } from '../../api/types';
import { initiallyExpandedThreadMessage, threadMessageFolder } from '../thread-presentation';

const message = (id: string, mailboxIds: Record<string, boolean>): Email => ({
  id, threadId: 'baq', mailboxIds, keywords: {}, size: 0,
  receivedAt: '2026-09-24T22:39:00Z', hasAttachment: false,
});
const mailbox = (id: string, name: string, role: string, originalId?: string): Mailbox => ({
  id, originalId, name, role, totalEmails: 0, unreadEmails: 0,
  totalThreads: 0, unreadThreads: 0, myRights: {} as Mailbox['myRights'],
});

describe('thread presentation', () => {
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
