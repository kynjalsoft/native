import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../jmap-client', () => ({
  jmapClient: {
    isConnected: true,
    username: 'me',
    serverUrl: 'https://mail.example.com',
    currentSession: {},
    accountId: 'own',
    hasCompanyNoDeletePolicy: false,
    getStoredCredentials: vi.fn(),
    getSharedMailAccounts: vi.fn(() => [{ id: 'shared', name: 'Finance' }]),
    request: vi.fn(),
  },
  REQUEST_TIMEOUT_MS: 30_000,
  rewriteSessionUrl: (url: string) => url,
  extractOrigin: (url: string) => new URL(url).origin,
  parseRetryAfter: () => 60_000,
}));

vi.mock('../../lib/client-cert', () => ({ secureFetch: vi.fn() }));

import { jmapClient } from '../jmap-client';
import { secureFetch } from '../../lib/client-cert';
import { deleteUnifiedEmails, fetchUnifiedInbox, moveUnifiedEmails, resetUnifiedCache } from '../unified-inbox';

const request = jmapClient.request as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetUnifiedCache();
  (jmapClient as typeof jmapClient & { hasCompanyNoDeletePolicy: boolean }).hasCompanyNoDeletePolicy = false;
});

it('rejects company Trash and delete actions before touching the JMAP transport', async () => {
  (jmapClient as typeof jmapClient & { hasCompanyNoDeletePolicy: boolean }).hasCompanyNoDeletePolicy = true;
  const email = {
    id: 'message-1', sourceAccountId: 'me@mail.example.com', jmapAccountId: 'own',
    mailboxIds: { inbox: true }, isShared: false, threadId: 'thread-1',
    keywords: {}, size: 1, receivedAt: '2026-09-24T10:00:00Z', hasAttachment: false,
  } as Parameters<typeof deleteUnifiedEmails>[0][number];

  await expect(deleteUnifiedEmails([email])).rejects.toThrow(/disabled by your organization/);
  await expect(moveUnifiedEmails([email], 'trash')).rejects.toThrow(/disabled by your organization/);
  expect(request).not.toHaveBeenCalled();
});

it('also rejects a detached company account while a public account is active', async () => {
  (jmapClient.getStoredCredentials as ReturnType<typeof vi.fn>).mockResolvedValue({
    serverUrl: 'https://mail.zyndpay.io', username: 'staff', password: '', accessToken: 'token',
  });
  (secureFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true, status: 200, json: async () => ({
      apiUrl: 'https://mail.zyndpay.io/jmap/',
      primaryAccounts: { 'urn:ietf:params:jmap:mail': 'company' },
      accounts: { company: { name: 'Company', isPersonal: true } },
    }),
  });
  const email = {
    id: 'message-1', sourceAccountId: 'staff@mail.zyndpay.io', jmapAccountId: 'company',
    mailboxIds: { inbox: true }, isShared: false, threadId: 'thread-1',
    keywords: {}, size: 1, receivedAt: '2026-09-24T10:00:00Z', hasAttachment: false,
  } as Parameters<typeof deleteUnifiedEmails>[0][number];

  await expect(deleteUnifiedEmails([email])).rejects.toThrow(/disabled by your organization/);
  expect(secureFetch).toHaveBeenCalledTimes(1); // read-only JMAP session discovery
  expect(request).not.toHaveBeenCalled();
});

describe('shared mail in All inboxes', () => {
  it.each([
    ['mailbox discovery', 'Access revoked'],
    ['message retrieval', 'Shared message access denied'],
  ])('keeps own mail visible and reports failed shared %s', async (stage, failure) => {
    request.mockImplementation(async (calls: Array<[string, { accountId: string }]>) => {
      const [method, args] = calls[0];
      if (args.accountId === 'shared' && stage === 'mailbox discovery') throw new Error(failure);
      if (method === 'Mailbox/get') {
        return { methodResponses: [['Mailbox/get', {
          list: [{ id: args.accountId === 'shared' ? 'shared-inbox' : 'own-inbox', role: 'inbox', name: 'Inbox' }],
        }, '0']] };
      }
      if (args.accountId === 'shared') {
        return { methodResponses: [
          ['Email/query', { ids: ['shared-message'], total: 1 }, '0'],
          ['error', { type: 'forbidden', description: failure }, '1'],
        ] };
      }
      return { methodResponses: [
        ['Email/query', { ids: ['message-1'], total: 1 }, '0'],
        ['Email/get', { list: [{ id: 'message-1', mailboxIds: { 'own-inbox': true }, receivedAt: '2026-09-24T10:00:00Z' }] }, '1'],
      ] };
    });

    const result = await fetchUnifiedInbox(['me@mail.example.com'], 25, { includeGroup: true });

    expect(result.emails.map((email) => email.id)).toEqual(['message-1']);
    expect(result.errors).toEqual({
      'me@mail.example.com|shared': `Finance: ${failure}`,
    });
    expect(result.positions['me@mail.example.com|shared']).toBeUndefined();
  });
});

it('pages without a full server count and advances past the displayed ids', async () => {
  const seenQueries: Array<{ position: number; limit: number; calculateTotal: boolean }> = [];
  request.mockImplementation(async (calls: Array<[string, { accountId: string; position?: number; limit?: number; calculateTotal?: boolean }]>) => {
    const [method, args] = calls[0];
    if (method === 'Mailbox/get') {
      return { methodResponses: [['Mailbox/get', { list: [{ id: 'inbox', role: 'inbox', name: 'Inbox' }] }, '0']] };
    }
    seenQueries.push({ position: args.position!, limit: args.limit!, calculateTotal: args.calculateTotal! });
    const ids = ['m1', 'm2', 'm3'].slice(args.position, args.position! + args.limit!);
    return { methodResponses: [
      ['Email/query', { ids }, '0'],
      ['Email/get', { list: ids.map((id) => ({ id, mailboxIds: { inbox: true }, receivedAt: '2026-09-24T10:00:00Z' })) }, '1'],
    ] };
  });

  const first = await fetchUnifiedInbox(['me@mail.example.com'], 2);
  expect(first.emails.map((email) => email.id)).toEqual(['m1', 'm2']);
  expect(first.hasMore).toBe(true);
  expect(first.positions['me@mail.example.com|own']).toBe(2);

  const second = await fetchUnifiedInbox(['me@mail.example.com'], 2, { positions: first.positions });
  expect(second.emails.map((email) => email.id)).toEqual(['m3']);
  expect(second.hasMore).toBe(false);
  expect(seenQueries).toEqual([
    { position: 0, limit: 3, calculateTotal: false },
    { position: 2, limit: 3, calculateTotal: false },
  ]);
});
