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

it('keeps aggregate pages globally ordered when one mailbox has newer mail', async () => {
  const idsByAccount: Record<string, string[]> = {
    own: ['own-10', 'own-9', 'own-8', 'own-7'],
    shared: ['shared-6', 'shared-5'],
  };
  request.mockImplementation(async (calls: Array<[string, { accountId: string; position?: number; limit?: number }]>) => {
    const [method, args] = calls[0];
    if (method === 'Mailbox/get') {
      return { methodResponses: [['Mailbox/get', {
        list: [{ id: `${args.accountId}-inbox`, role: 'inbox', name: 'Inbox' }],
      }, '0']] };
    }
    const ids = idsByAccount[args.accountId].slice(args.position, args.position! + args.limit!);
    return { methodResponses: [
      ['Email/query', { ids }, '0'],
      ['Email/get', { list: ids.map((id) => ({
        id,
        mailboxIds: { [`${args.accountId}-inbox`]: true },
        receivedAt: `2026-09-24T10:00:${id.split('-')[1].padStart(2, '0')}Z`,
      })) }, '1'],
    ] };
  });

  const opts = { includeGroup: true };
  const first = await fetchUnifiedInbox(['me@mail.example.com'], 2, opts);
  const second = await fetchUnifiedInbox(['me@mail.example.com'], 2, { ...opts, positions: first.positions });
  const third = await fetchUnifiedInbox(['me@mail.example.com'], 2, { ...opts, positions: second.positions });

  expect(first.emails.map((email) => email.id)).toEqual(['own-10', 'own-9']);
  expect(second.emails.map((email) => email.id)).toEqual(['own-8', 'own-7']);
  expect(third.emails.map((email) => email.id)).toEqual(['shared-6', 'shared-5']);
  expect(first.positions).toEqual({ 'me@mail.example.com|own': 2, 'me@mail.example.com|shared': 0 });
  expect(second.positions).toEqual({ 'me@mail.example.com|own': 4, 'me@mail.example.com|shared': 0 });
  expect(third.hasMore).toBe(false);
});

it('moves past a message deleted between query and get', async () => {
  request.mockImplementation(async (calls: Array<[string, { position?: number; limit?: number }]>) => {
    const [method, args] = calls[0];
    if (method === 'Mailbox/get') {
      return { methodResponses: [['Mailbox/get', { list: [{ id: 'inbox', role: 'inbox', name: 'Inbox' }] }, '0']] };
    }
    const ids = ['deleted', 'remaining'].slice(args.position, args.position! + args.limit!);
    return { methodResponses: [
      ['Email/query', { ids }, '0'],
      ['Email/get', { list: ids.filter((id) => id !== 'deleted').map((id) => ({
        id, mailboxIds: { inbox: true }, receivedAt: '2026-09-24T10:00:00Z',
      })) }, '1'],
    ] };
  });

  const first = await fetchUnifiedInbox(['me@mail.example.com'], 1);
  expect(first.emails).toEqual([]);
  expect(first.hasMore).toBe(true);
  expect(first.positions['me@mail.example.com|own']).toBe(1);

  const second = await fetchUnifiedInbox(['me@mail.example.com'], 1, { positions: first.positions });
  expect(second.emails.map((email) => email.id)).toEqual(['remaining']);
  expect(second.hasMore).toBe(false);
});

it('uses rotated detached credentials without retaining the old transport', async () => {
  let token = 'old-token';
  const requestTokens: string[] = [];
  (jmapClient.getStoredCredentials as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
    serverUrl: 'https://other.example.com', username: 'other', password: '', accessToken: token,
  }));
  (secureFetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init: RequestInit) => {
    if (init.method !== 'POST') {
      return { ok: true, status: 200, json: async () => ({
        apiUrl: 'https://other.example.com/jmap/',
        primaryAccounts: { 'urn:ietf:params:jmap:mail': 'other' },
        accounts: { other: { name: 'Other', isPersonal: true } },
      }) };
    }
    requestTokens.push((init.headers as Record<string, string>).Authorization);
    const calls = JSON.parse(init.body as string).methodCalls as Array<[string, { accountId: string }]>;
    return { ok: true, status: 200, json: async () => ({ methodResponses: calls[0][0] === 'Mailbox/get'
      ? [['Mailbox/get', { list: [{ id: 'inbox', role: 'inbox', name: 'Inbox' }] }, '0']]
      : [['Email/query', { ids: [] }, '0'], ['Email/get', { list: [] }, '1']],
    }) };
  });

  await fetchUnifiedInbox(['other@other.example.com']);
  token = 'new-token';
  await fetchUnifiedInbox(['other@other.example.com']);

  expect(requestTokens).toEqual([
    'Bearer old-token', 'Bearer old-token',
    'Bearer new-token', 'Bearer new-token',
  ]);
});

it('does not reuse a detached session after its stored credentials are removed', async () => {
  let signedIn = true;
  const posts: string[] = [];
  (jmapClient.getStoredCredentials as ReturnType<typeof vi.fn>).mockImplementation(async () => signedIn
    ? { serverUrl: 'https://other.example.com', username: 'other', password: '', accessToken: 'token' }
    : null);
  (secureFetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init: RequestInit) => {
    if (init.method !== 'POST') {
      return { ok: true, status: 200, json: async () => ({
        apiUrl: 'https://other.example.com/jmap/',
        primaryAccounts: { 'urn:ietf:params:jmap:mail': 'other' },
        accounts: { other: { name: 'Other', isPersonal: true } },
      }) };
    }
    posts.push(url);
    const calls = JSON.parse(init.body as string).methodCalls as Array<[string]>;
    return { ok: true, status: 200, json: async () => ({ methodResponses: calls[0][0] === 'Mailbox/get'
      ? [['Mailbox/get', { list: [{ id: 'inbox', role: 'inbox', name: 'Inbox' }] }, '0']]
      : [['Email/query', { ids: [] }, '0'], ['Email/get', { list: [] }, '1']],
    }) };
  });

  await fetchUnifiedInbox(['other@other.example.com']);
  expect(posts).toHaveLength(2);
  signedIn = false;
  const afterLogout = await fetchUnifiedInbox(['other@other.example.com']);
  expect(afterLogout.emails).toEqual([]);
  expect(afterLogout.errors['other@other.example.com']).toBe('No stored credentials');
  expect(posts).toHaveLength(2);
});
