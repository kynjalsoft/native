import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../jmap-client', () => ({
  jmapClient: {
    isConnected: true,
    username: 'me',
    serverUrl: 'https://mail.example.com',
    currentSession: {},
    accountId: 'own',
    getSharedMailAccounts: vi.fn(() => [{ id: 'shared', name: 'Finance' }]),
    request: vi.fn(),
  },
  REQUEST_TIMEOUT_MS: 30_000,
}));

vi.mock('../../lib/client-cert', () => ({ secureFetch: vi.fn() }));

import { jmapClient } from '../jmap-client';
import { fetchUnifiedInbox, resetUnifiedCache } from '../unified-inbox';

const request = jmapClient.request as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetUnifiedCache();
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
