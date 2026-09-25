import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the jmap-client module
vi.mock('../jmap-client', () => ({
  jmapClient: {
    accountId: 'acc-1',
    hasCompanyNoDeletePolicy: false,
    request: vi.fn(),
    getAccountName: vi.fn(() => 'me@example.com'),
    getSharedMailAccounts: vi.fn(() => []),
    getMaxCallsInRequest: vi.fn(() => 16),
    getMaxObjectsInGet: vi.fn(() => 500),
    getMaxObjectsInSet: vi.fn(() => 500),
  },
}));

import { jmapClient } from '../jmap-client';
import { resolveOutboundSender } from '../../lib/outbound-sender';
import type { Identity } from '../types';
import {
  getMailboxes,
  getSharedMailboxes,
  queryEmails,
  getEmails,
  getFullEmail,
  getThread,
  setEmailKeywords,
  moveEmail,
  deleteEmail,
  searchEmails,
  sendEmail,
  createDraft,
} from '../email';

const mockRequest = jmapClient.request as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  (jmapClient as typeof jmapClient & { hasCompanyNoDeletePolicy: boolean }).hasCompanyNoDeletePolicy = false;
});

describe('email operations', () => {
  describe('getMailboxes', () => {
    it('should fetch all mailboxes', async () => {
      const mailboxes = [
        { id: 'mb-1', name: 'Inbox', role: 'inbox', totalEmails: 10, unreadEmails: 3 },
        { id: 'mb-2', name: 'Sent', role: 'sent', totalEmails: 5, unreadEmails: 0 },
      ];
      mockRequest.mockResolvedValue({
        methodResponses: [['Mailbox/get', { list: mailboxes }, '0']],
      });

      const result = await getMailboxes();

      // Own folders keep their raw ids and pick up ownership metadata.
      expect(result).toEqual(mailboxes.map((m) => ({
        ...m,
        accountId: 'acc-1',
        accountName: 'me@example.com',
        isShared: false,
      })));
      expect(mockRequest).toHaveBeenCalledWith(
        [['Mailbox/get', { accountId: 'acc-1' }, '0']],
      );
    });
  });

  describe('getSharedMailboxes', () => {
    const mockShared = jmapClient.getSharedMailAccounts as ReturnType<typeof vi.fn>;

    it('returns nothing when the session has no shared accounts', async () => {
      mockShared.mockReturnValue([]);

      expect(await getSharedMailboxes()).toEqual([]);
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('prefixes ids and parent links per owning account', async () => {
      mockShared.mockReturnValue([{ id: 'grp-1', name: 'Support' }]);
      mockRequest.mockResolvedValue({
        methodResponses: [['Mailbox/get', {
          list: [
            { id: 'mb-1', name: 'Inbox', role: 'inbox', totalEmails: 4, unreadEmails: 2 },
            { id: 'mb-2', name: 'Escalations', parentId: 'mb-1', totalEmails: 1, unreadEmails: 0 },
          ],
        }, '0']],
      });

      const result = await getSharedMailboxes();

      expect(mockRequest).toHaveBeenCalledWith(
        [['Mailbox/get', { accountId: 'grp-1' }, '0']],
      );
      expect(result).toEqual([
        {
          id: 'grp-1:mb-1',
          originalId: 'mb-1',
          name: 'Inbox',
          role: 'inbox',
          parentId: undefined,
          totalEmails: 4,
          unreadEmails: 2,
          accountId: 'grp-1',
          accountName: 'Support',
          isShared: true,
        },
        {
          id: 'grp-1:mb-2',
          originalId: 'mb-2',
          name: 'Escalations',
          parentId: 'grp-1:mb-1',
          totalEmails: 1,
          unreadEmails: 0,
          accountId: 'grp-1',
          accountName: 'Support',
          isShared: true,
        },
      ]);
    });

    it('maps each response back to its account and skips the ones that errored', async () => {
      mockShared.mockReturnValue([
        { id: 'grp-1', name: 'Support' },
        { id: 'grp-2', name: 'Sales' },
      ]);
      mockRequest.mockResolvedValue({
        methodResponses: [
          ['error', { type: 'accountNotFound' }, '0'],
          ['Mailbox/get', { list: [{ id: 'mb-9', name: 'Inbox', role: 'inbox' }] }, '1'],
        ],
      });

      const result = await getSharedMailboxes();

      expect(result.map((m) => m.id)).toEqual(['grp-2:mb-9']);
      expect(result[0].accountName).toBe('Sales');
    });

    it('chunks requests to maxCallsInRequest', async () => {
      mockShared.mockReturnValue([
        { id: 'grp-1', name: 'Support' },
        { id: 'grp-2', name: 'Sales' },
        { id: 'grp-3', name: 'Billing' },
      ]);
      (jmapClient.getMaxCallsInRequest as ReturnType<typeof vi.fn>).mockReturnValue(2);
      mockRequest.mockResolvedValue({ methodResponses: [] });

      await getSharedMailboxes();

      expect(mockRequest).toHaveBeenCalledTimes(2);
      expect(mockRequest.mock.calls[0][0]).toHaveLength(2);
      expect(mockRequest.mock.calls[1][0]).toHaveLength(1);
    });
  });

  describe('queryEmails', () => {
    it('should query emails with default options', async () => {
      mockRequest.mockResolvedValue({
        methodResponses: [['Email/query', { ids: ['e1', 'e2'], total: 2 }, '0']],
      });

      const result = await queryEmails('mb-1');

      expect(result).toEqual({ ids: ['e1', 'e2'], total: 2 });
      const call = mockRequest.mock.calls[0][0][0];
      expect(call[1].filter).toEqual({ inMailbox: 'mb-1' });
      expect(call[1].limit).toBe(50);
      expect(call[1].position).toBe(0);
    });

    it('should support custom sort and limit', async () => {
      mockRequest.mockResolvedValue({
        methodResponses: [['Email/query', { ids: ['e1'], total: 1 }, '0']],
      });

      await queryEmails('mb-1', {
        limit: 10,
        sort: [{ property: 'subject', isAscending: true }],
      });

      const call = mockRequest.mock.calls[0][0][0];
      expect(call[1].limit).toBe(10);
      expect(call[1].sort).toEqual([{ property: 'subject', isAscending: true }]);
    });

    it('should merge additional filter options', async () => {
      mockRequest.mockResolvedValue({
        methodResponses: [['Email/query', { ids: [], total: 0 }, '0']],
      });

      await queryEmails('mb-1', {
        filter: { hasKeyword: '$flagged' },
      });

      const call = mockRequest.mock.calls[0][0][0];
      expect(call[1].filter).toEqual({ inMailbox: 'mb-1', hasKeyword: '$flagged' });
    });

    it('should AND-wrap a FilterOperator instead of spreading it', async () => {
      mockRequest.mockResolvedValue({
        methodResponses: [['Email/query', { ids: [], total: 0 }, '0']],
      });

      const userFilter = {
        operator: 'AND',
        conditions: [{ inMailbox: 'mb-1' }, { notKeyword: '$seen' }],
      };
      await queryEmails('mb-1', { filter: userFilter });

      const call = mockRequest.mock.calls[0][0][0];
      expect(call[1].filter).toEqual({
        operator: 'AND',
        conditions: [{ inMailbox: 'mb-1' }, userFilter],
      });
    });
  });

  describe('getEmails', () => {
    it('should fetch emails by id with list properties', async () => {
      const emails = [{ id: 'e1', subject: 'Test' }];
      mockRequest.mockResolvedValue({
        methodResponses: [['Email/get', { list: emails }, '0']],
      });

      const result = await getEmails(['e1']);

      expect(result).toEqual(emails);
      const call = mockRequest.mock.calls[0][0][0];
      expect(call[1].ids).toEqual(['e1']);
      expect(call[1].properties).toContain('subject');
      expect(call[1].properties).toContain('preview');
      expect(call[1].properties).not.toContain('bodyStructure');
    });
  });

  describe('getFullEmail', () => {
    it('should fetch full email with body values', async () => {
      const email = { id: 'e1', subject: 'Test', htmlBody: [{ partId: 'html' }] };
      mockRequest.mockResolvedValue({
        methodResponses: [['Email/get', { list: [email] }, '0']],
      });

      const result = await getFullEmail('e1');

      expect(result).toEqual(email);
      const call = mockRequest.mock.calls[0][0][0];
      expect(call[1].fetchHTMLBodyValues).toBe(true);
      expect(call[1].fetchTextBodyValues).toBe(true);
      expect(call[1].properties).toContain('bodyStructure');
    });
  });

  describe('getThread', () => {
    it('should fetch thread by id', async () => {
      const thread = { id: 't1', emailIds: ['e1', 'e2'] };
      mockRequest.mockResolvedValue({
        methodResponses: [['Thread/get', { list: [thread] }, '0']],
      });

      const result = await getThread('t1');
      expect(result).toEqual(thread);
    });
  });

  describe('setEmailKeywords', () => {
    it('should update email keywords', async () => {
      mockRequest.mockResolvedValue({ methodResponses: [['Email/set', { updated: {} }, '0']] });

      await setEmailKeywords('e1', { $seen: true, $flagged: true });

      const call = mockRequest.mock.calls[0][0][0];
      expect(call[1].update).toEqual({ e1: { keywords: { $seen: true, $flagged: true } } });
    });
  });

  describe('moveEmail', () => {
    it('should move email between mailboxes using path patches', async () => {
      mockRequest.mockResolvedValue({ methodResponses: [['Email/set', { updated: {} }, '0']] });

      await moveEmail('e1', 'inbox', 'archive');

      const call = mockRequest.mock.calls[0][0][0];
      expect(call[1].update.e1).toEqual({
        'mailboxIds/inbox': null,
        'mailboxIds/archive': true,
      });
    });
  });

  describe('deleteEmail', () => {
    it('should move to trash if not already in trash', async () => {
      mockRequest.mockResolvedValue({ methodResponses: [['Email/set', { updated: {} }, '0']] });

      await deleteEmail('e1', 'trash', 'inbox');

      const call = mockRequest.mock.calls[0][0][0];
      expect(call[1].update.e1).toEqual({
        'mailboxIds/inbox': null,
        'mailboxIds/trash': true,
      });
    });

    it('should permanently destroy if already in trash', async () => {
      mockRequest.mockResolvedValue({ methodResponses: [['Email/set', { destroyed: ['e1'] }, '0']] });

      await deleteEmail('e1', 'trash', 'trash');

      const call = mockRequest.mock.calls[0][0][0];
      expect(call[1].destroy).toEqual(['e1']);
    });
  });

  describe('searchEmails', () => {
    it('should search with text filter', async () => {
      mockRequest.mockResolvedValue({
        methodResponses: [['Email/query', { ids: ['e1'] }, '0']],
      });

      const result = await searchEmails('test query');

      expect(result).toEqual(['e1']);
      const call = mockRequest.mock.calls[0][0][0];
      expect(call[1].filter).toEqual({ text: 'test* query*' });
    });

    it('should include mailbox filter if specified', async () => {
      mockRequest.mockResolvedValue({
        methodResponses: [['Email/query', { ids: [] }, '0']],
      });

      await searchEmails('query', 'mb-1');

      const call = mockRequest.mock.calls[0][0][0];
      expect(call[1].filter).toEqual({ text: 'query*', inMailbox: 'mb-1' });
    });
  });

  describe('sendEmail', () => {
    it.each([
      ['new personal', 'compose', 'alex@zyndpay.io', 'Alex Doe', 'Alex Doe | ZyndPay'],
      ['reply from support', 'reply', 'support@zyndpay.io', 'Alex Doe', 'ZyndPay Support'],
      ['reply all from sales', 'replyAll', 'sales@zyndpay.io', 'Alex Doe', 'ZyndPay Sales'],
      ['forward from support', 'forward', 'support@zyndpay.io', 'Alex Doe', 'ZyndPay Support'],
    ])('serializes the governed From for %s without changing identityId', async (_label, mode, address, configuredName, expectedName) => {
      mockRequest.mockResolvedValue({ methodResponses: [
        ['Email/set', { created: { draft: { id: 'e-new' } } }, '0'],
        ['EmailSubmission/set', { created: { 'sub-1': { id: 's-1' } } }, '1'],
      ] });
      const selected = { id: 'selected-identity', email: address, name: configuredName } as Identity;
      const sender = resolveOutboundSender(selected);
      await sendEmail({
        from: [sender.from],
        to: [{ email: 'recipient@example.org' }],
        subject: mode === 'forward' ? 'Fwd: Example' : mode === 'compose' ? 'Example' : 'Re: Example',
        textBody: 'Fixture only',
        inReplyTo: mode.startsWith('reply') ? ['original@example.org'] : undefined,
      }, selected.id, 'sent-mb');
      const calls = mockRequest.mock.calls[0][0];
      expect(calls[0][1].create.draft.from).toEqual([{ name: expectedName, email: address }]);
      expect(calls[1][1].create['sub-1'].identityId).toBe(selected.id);
      expect(calls[0][1].create.draft.inReplyTo).toEqual(mode.startsWith('reply') ? ['original@example.org'] : undefined);
    });

    it('does not report success when the server omits the submission result', async () => {
      mockRequest.mockResolvedValue({ methodResponses: [
        ['Email/set', { created: { draft: { id: 'e-new' } } }, '0'],
        ['EmailSubmission/set', {}, '1'],
      ] });

      await expect(sendEmail(
        { from: [{ email: 'me@example.com' }], to: [{ email: 'you@example.com' }], subject: 'Hello', textBody: 'Hi' },
        'identity-1', 'sent-mb', undefined, { draftsMailboxId: 'drafts-mb' },
      )).rejects.toThrow('submission outcome');
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('does not report success when submission is acknowledged without the created message id', async () => {
      mockRequest.mockResolvedValue({ methodResponses: [
        ['Email/set', {}, '0'],
        ['EmailSubmission/set', { created: { 'sub-1': { id: 's-1' } } }, '1'],
      ] });

      await expect(sendEmail(
        { from: [{ email: 'me@example.com' }], to: [{ email: 'you@example.com' }], subject: 'Hello', textBody: 'Hi' },
        'identity-1', 'sent-mb', undefined, { draftsMailboxId: 'drafts-mb' },
      )).rejects.toThrow('submission outcome');
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('does not attempt forbidden cleanup of a retained company draft after submission', async () => {
      (jmapClient as typeof jmapClient & { hasCompanyNoDeletePolicy: boolean }).hasCompanyNoDeletePolicy = true;
      mockRequest.mockResolvedValue({ methodResponses: [
        ['Email/set', { created: { draft: { id: 'e-new' } } }, '0'],
        ['EmailSubmission/set', { created: { 'sub-1': { id: 's-1' } } }, '1'],
      ] });

      const result = await sendEmail(
        { from: [{ email: 'me@example.com' }], to: [{ email: 'you@example.com' }], subject: 'Hello', textBody: 'Hi' },
        'identity-1', 'sent-mb', undefined, { draftsMailboxId: 'drafts-mb', draftId: 'old-draft' },
      );

      expect(result.emailSubmissionId).toBe('s-1');
      expect(result.filingWarning).toBeUndefined();
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
    it('files a submitted draft with patches that preserve unrelated mailbox membership', async () => {
      mockRequest.mockResolvedValue({ methodResponses: [
        ['Email/set', { created: { draft: { id: 'e-new' } } }, '0'],
        ['EmailSubmission/set', { created: { 'sub-1': { id: 's-1' } } }, '1'],
      ] });

      await sendEmail(
        { from: [{ email: 'me@example.com' }], to: [{ email: 'you@example.com' }], subject: 'Hello', textBody: 'Hi' },
        'identity-1', 'sent~box', undefined, { draftsMailboxId: 'draft/box' },
      );

      const submission = mockRequest.mock.calls[0][0][1][1];
      expect(submission.onSuccessUpdateEmail['#sub-1']).toEqual({
        'mailboxIds/sent~0box': true,
        'mailboxIds/draft~1box': null,
        'keywords/$draft': null,
        'keywords/$seen': true,
      });
    });
    it('should create email and submission in one request', async () => {
      mockRequest.mockResolvedValue({
        methodResponses: [
          ['Email/set', { created: { draft: { id: 'e-new' } } }, '0'],
          ['EmailSubmission/set', { created: { 'sub-1': { id: 's-1' } } }, '1'],
        ],
      });

      await sendEmail(
        {
          from: [{ email: 'me@example.com' }],
          to: [{ email: 'you@example.com' }],
          subject: 'Hello',
          textBody: 'Hi there',
        },
        'identity-1',
        'sent-mb',
      );

      expect(mockRequest).toHaveBeenCalledTimes(1);
      const calls = mockRequest.mock.calls[0][0];
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toBe('Email/set');
      expect(calls[1][0]).toBe('EmailSubmission/set');
      expect(calls[1][1].create['sub-1'].emailId).toBe('#draft');
    });

    it('should use htmlBody when provided', async () => {
      mockRequest.mockResolvedValue({
        methodResponses: [
          ['Email/set', { created: { draft: { id: 'e-new' } } }, '0'],
          ['EmailSubmission/set', { created: { 'sub-1': { id: 's-1' } } }, '1'],
        ],
      });

      await sendEmail(
        {
          from: [{ email: 'me@example.com' }],
          to: [{ email: 'you@example.com' }],
          subject: 'Hello',
          htmlBody: '<p>Hi there</p>',
        },
        'identity-1',
        'sent-mb',
      );

      const emailCreate = mockRequest.mock.calls[0][0][0][1].create.draft;
      expect(emailCreate.htmlBody).toEqual([{ partId: 'html', type: 'text/html' }]);
      expect(emailCreate.bodyValues).toEqual({ html: { value: '<p>Hi there</p>' } });
    });

    it('should set reply headers when inReplyTo is provided', async () => {
      mockRequest.mockResolvedValue({
        methodResponses: [
          ['Email/set', { created: { draft: { id: 'e-new' } } }, '0'],
          ['EmailSubmission/set', { created: { 'sub-1': { id: 's-1' } } }, '1'],
        ],
      });

      await sendEmail(
        {
          from: [{ email: 'me@example.com' }],
          to: [{ email: 'you@example.com' }],
          subject: 'Re: Hello',
          textBody: 'replying',
          inReplyTo: ['<msg-1@example.com>'],
          references: ['<msg-0@example.com>', '<msg-1@example.com>'],
        },
        'identity-1',
        'sent-mb',
      );

      const emailCreate = mockRequest.mock.calls[0][0][0][1].create.draft;
      // RFC 8621 §4.1.2.3: JMAP arrays of bare msg-ids, brackets stripped.
      expect(emailCreate.inReplyTo).toEqual(['msg-1@example.com']);
      expect(emailCreate.references).toEqual(['msg-0@example.com', 'msg-1@example.com']);
      expect(emailCreate['header:In-Reply-To:asText']).toBeUndefined();
    });
  });

  it('retains earlier company draft versions without attempting destructive cleanup', async () => {
    (jmapClient as typeof jmapClient & { hasCompanyNoDeletePolicy: boolean }).hasCompanyNoDeletePolicy = true;
    mockRequest.mockResolvedValue({ methodResponses: [
      ['Email/set', { created: { draft: { id: 'new-draft' } } }, '0'],
    ] });

    const id = await createDraft(
      { from: [{ email: 'me@example.com' }], to: [], subject: 'Draft', textBody: 'Body' },
      'drafts-mb', 'old-draft',
    );

    expect(id).toBe('new-draft');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('serializes a governed shared From when saving a draft', async () => {
    mockRequest.mockResolvedValue({ methodResponses: [
      ['Email/set', { created: { draft: { id: 'new-draft' } } }, '0'],
    ] });
    const selected = { id: 'support-id', email: 'support@zyndpay.io', name: 'Alex Doe' } as Identity;
    const { from } = resolveOutboundSender(selected);
    await createDraft({ from: [from], to: [], subject: 'Draft', textBody: 'Fixture only' }, 'drafts-mb');
    expect(mockRequest.mock.calls[0][0][0][1].create.draft.from).toEqual([
      { name: 'ZyndPay Support', email: 'support@zyndpay.io' },
    ]);
    expect(mockRequest.mock.calls[0][0][0][1].create.draft.keywords).toEqual({ $seen: true, $draft: true });
  });

  it('keeps the governed From and selected identity when submitting a reopened draft', async () => {
    mockRequest.mockResolvedValue({ methodResponses: [
      ['Email/set', { created: { draft: { id: 'sent-copy' } } }, '0'],
      ['EmailSubmission/set', { created: { 'sub-1': { id: 'submission' } } }, '1'],
    ] });
    const selected = { id: 'sales-id', email: 'sales@zyndpay.io', name: 'Alex Doe' } as Identity;
    const { from } = resolveOutboundSender(selected);
    await sendEmail({
      from: [from], to: [{ email: 'recipient@example.org' }], subject: 'Draft resumed', textBody: 'Fixture only',
    }, selected.id, 'sent-mb', undefined, { draftsMailboxId: 'drafts-mb', draftId: 'earlier-draft' });
    const calls = mockRequest.mock.calls[0][0];
    expect(calls[0][1].create.draft.from).toEqual([{ name: 'ZyndPay Sales', email: selected.email }]);
    expect(calls[1][1].create['sub-1'].identityId).toBe('sales-id');
    expect(calls[1][1].onSuccessUpdateEmail['#sub-1']['mailboxIds/sent-mb']).toBe(true);
  });
});
