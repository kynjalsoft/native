import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock expo-secure-store before importing the client
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { JMAPClient, AuthenticationError, RateLimitError } from '../jmap-client';
import type { JMAPSession } from '../types';

const MOCK_SESSION: JMAPSession = {
  apiUrl: 'https://mail.example.com/jmap/',
  downloadUrl: 'https://mail.example.com/download/{accountId}/{blobId}/{name}?type={type}',
  uploadUrl: 'https://mail.example.com/upload/{accountId}/',
  eventSourceUrl: 'https://mail.example.com/eventsource/?types={types}&closeafter={closeafter}&ping={ping}',
  primaryAccounts: {
    'urn:ietf:params:jmap:mail': 'acc-1',
    'urn:ietf:params:jmap:core': 'acc-1',
  },
  accounts: {
    'acc-1': { name: 'user@example.com', isPersonal: true, isReadOnly: false },
  },
  capabilities: {
    'urn:ietf:params:jmap:core': {},
    'urn:ietf:params:jmap:mail': {},
  },
  state: 'state-1',
};

function mockFetch(responses: Array<{ status: number; json?: any; headers?: Record<string, string> }>) {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex++] ?? responses[responses.length - 1];
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      statusText: resp.status === 200 ? 'OK' : 'Error',
      headers: {
        get: (name: string) => resp.headers?.[name] ?? null,
      },
      json: async () => resp.json,
      text: async () => (resp.json === undefined ? '' : JSON.stringify(resp.json)),
    };
  });
}

describe('JMAPClient', () => {
  let client: JMAPClient;

  beforeEach(() => {
    client = new JMAPClient();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('connect', () => {
    it('should authenticate and establish session', async () => {
      global.fetch = mockFetch([{ status: 200, json: MOCK_SESSION }]) as any;

      const session = await client.connect('https://mail.example.com', 'user', 'pass');

      expect(session).toEqual(MOCK_SESSION);
      expect(client.isConnected).toBe(true);
      expect(client.accountId).toBe('acc-1');
      expect(SecureStore.setItemAsync).toHaveBeenCalled();
    });

    it('should throw AuthenticationError on 401', async () => {
      global.fetch = mockFetch([{ status: 401 }]) as any;

      await expect(client.connect('https://mail.example.com', 'user', 'bad'))
        .rejects.toThrow(AuthenticationError);
    });

    it('should throw on non-ok response', async () => {
      global.fetch = mockFetch([{ status: 500 }]) as any;

      await expect(client.connect('https://mail.example.com', 'user', 'pass'))
        .rejects.toThrow('Session discovery failed');
    });

    it('should strip trailing slashes from server URL', async () => {
      global.fetch = mockFetch([{ status: 200, json: MOCK_SESSION }]) as any;

      await client.connect('https://mail.example.com///', 'user', 'pass');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://mail.example.com/jmap/session',
        expect.any(Object),
      );
    });

    it('should use Basic auth header', async () => {
      global.fetch = mockFetch([{ status: 200, json: MOCK_SESSION }]) as any;

      await client.connect('https://mail.example.com', 'user', 'pass');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Basic ${btoa('user:pass')}`,
          }),
        }),
      );
    });
  });

  describe('connectWithToken', () => {
    it('should use Bearer auth', async () => {
      global.fetch = mockFetch([{ status: 200, json: MOCK_SESSION }]) as any;

      await client.connectWithToken('https://mail.example.com', 'my-token');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-token',
          }),
        }),
      );
      expect(client.isConnected).toBe(true);
    });
  });

  describe('request', () => {
    beforeEach(async () => {
      global.fetch = mockFetch([{ status: 200, json: MOCK_SESSION }]) as any;
      await client.connect('https://mail.example.com', 'user', 'pass');
    });

    it('should make JMAP API request', async () => {
      const responseBody = {
        methodResponses: [['Mailbox/get', { list: [] }, '0']],
      };
      global.fetch = mockFetch([{ status: 200, json: responseBody }]) as any;

      const result = await client.request([['Mailbox/get', { accountId: 'acc-1' }, '0']]);

      expect(result.methodResponses).toHaveLength(1);
      expect(result.methodResponses[0][0]).toBe('Mailbox/get');
    });

    it('does not send a destructive company mail request after switching from a public account', async () => {
      global.fetch = mockFetch([{ status: 200, json: MOCK_SESSION }]) as any;
      await client.connectWithToken('https://mail.zyndpay.io', 'company-token');
      global.fetch = mockFetch([{ status: 200, json: { methodResponses: [] } }]) as any;

      await expect(client.request([['Email/set', { accountId: 'acc-1', destroy: ['message-1'] }, '0']]))
        .rejects.toThrow(/disabled by your organization/);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('leaves a public account free to use its server-granted delete permission', async () => {
      global.fetch = mockFetch([{ status: 200, json: { methodResponses: [] } }]) as any;

      await client.request([['Email/set', { accountId: 'acc-1', destroy: ['message-1'] }, '0']]);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw AuthenticationError on 401 during request', async () => {
      global.fetch = mockFetch([{ status: 401 }]) as any;

      await expect(client.request([['Mailbox/get', {}, '0']]))
        .rejects.toThrow(AuthenticationError);
    });

    it('should throw RateLimitError on 429', async () => {
      global.fetch = mockFetch([{
        status: 429,
        headers: { 'Retry-After': '10' },
      }]) as any;

      try {
        await client.request([['Mailbox/get', {}, '0']]);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).retryAfterMs).toBe(10000);
      }
    });

    it('should throw on non-ok response', async () => {
      global.fetch = mockFetch([{ status: 503 }]) as any;

      await expect(client.request([['Mailbox/get', {}, '0']]))
        .rejects.toThrow('JMAP request failed: 503');
    });

    it('should throw if not connected', async () => {
      const freshClient = new JMAPClient();
      await expect(freshClient.request([['Mailbox/get', {}, '0']]))
        .rejects.toThrow('Not connected');
    });

    it('should send correct request body', async () => {
      const responseBody = { methodResponses: [] };
      global.fetch = mockFetch([{ status: 200, json: responseBody }]) as any;

      await client.request(
        [['Mailbox/get', { accountId: 'acc-1' }, '0']],
        ['urn:ietf:params:jmap:core'],
      );

      const fetchCall = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.using).toEqual(['urn:ietf:params:jmap:core']);
      expect(body.methodCalls).toEqual([['Mailbox/get', { accountId: 'acc-1' }, '0']]);
    });
  });

  describe('restoreSession', () => {
    it('should restore from stored credentials', async () => {
      (SecureStore.getItemAsync as any).mockResolvedValue(
        JSON.stringify({ serverUrl: 'https://mail.example.com', username: 'user', password: 'pass' }),
      );
      global.fetch = mockFetch([{ status: 200, json: MOCK_SESSION }]) as any;

      const restored = await client.restoreSession();

      expect(restored).toBe(true);
      expect(client.isConnected).toBe(true);
    });

    it('should return false with no stored credentials', async () => {
      (SecureStore.getItemAsync as any).mockResolvedValue(null);

      const restored = await client.restoreSession();

      expect(restored).toBe(false);
      expect(client.isConnected).toBe(false);
    });

    it('should logout and return false on failure', async () => {
      (SecureStore.getItemAsync as any).mockResolvedValue(
        JSON.stringify({ serverUrl: 'https://fail.com', username: 'u', password: 'p' }),
      );
      global.fetch = mockFetch([{ status: 500 }]) as any;

      const restored = await client.restoreSession();

      expect(restored).toBe(false);
      expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('should clear session and stored credentials', async () => {
      global.fetch = mockFetch([{ status: 200, json: MOCK_SESSION }]) as any;
      await client.connect('https://mail.example.com', 'user', 'pass');

      await client.logout();

      expect(client.isConnected).toBe(false);
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('jmap_credentials');
    });
  });

  describe('hasCapability', () => {
    it('should detect capabilities from session', async () => {
      global.fetch = mockFetch([{ status: 200, json: MOCK_SESSION }]) as any;
      await client.connect('https://mail.example.com', 'user', 'pass');

      expect(client.hasCapability('urn:ietf:params:jmap:mail')).toBe(true);
      expect(client.hasCapability('urn:ietf:params:jmap:calendars')).toBe(false);
    });
  });

  describe('accountId resolution', () => {
    it('should fall back to core account', async () => {
      const session = {
        ...MOCK_SESSION,
        primaryAccounts: {
          'urn:ietf:params:jmap:core': 'core-acc',
        },
      };
      global.fetch = mockFetch([{ status: 200, json: session }]) as any;

      await client.connect('https://mail.example.com', 'user', 'pass');
      expect(client.accountId).toBe('core-acc');
    });

    it('should fall back to first account', async () => {
      const session = {
        ...MOCK_SESSION,
        primaryAccounts: {},
        accounts: { 'only-acc': { name: 'test', isPersonal: true, isReadOnly: false } },
      };
      global.fetch = mockFetch([{ status: 200, json: session }]) as any;

      await client.connect('https://mail.example.com', 'user', 'pass');
      expect(client.accountId).toBe('only-acc');
    });

    it('should throw on an empty (unauthenticated) session', async () => {
      // Stalwart returns 200 with empty accounts for invalid credentials;
      // the client surfaces that as an auth failure.
      const session = {
        ...MOCK_SESSION,
        primaryAccounts: {},
        accounts: {},
      };
      global.fetch = mockFetch([{ status: 200, json: session }]) as any;

      await expect(client.connect('https://mail.example.com', 'user', 'pass'))
        .rejects.toThrow('Invalid credentials');
    });
  });
});

describe('OAuth persistence across foreground and background clients', () => {
  it('uses background-rotated credentials in the live client and after reopening', async () => {
    const store = new Map<string, string>();
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
    global.fetch = mockFetch([{ status: 200, json: MOCK_SESSION }]) as any;
    const client = new JMAPClient();
    const { accountId } = await client.connectWithOAuth('https://mail.example.com', {
      accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: Date.now() + 3600000,
      tokenEndpoint: 'https://auth.example.com/token', clientId: 'mobile',
    });
    const original = (await client.getStoredCredentials(accountId))!;
    await client.setStoredCredentials(accountId, { ...original, accessToken: 'renewed-access', refreshToken: 'renewed-refresh' });
    expect(client.authHeader).toBe('Bearer renewed-access');
    const reopened = new JMAPClient();
    await reopened.loadAccount(accountId);
    expect(reopened.authHeader).toBe('Bearer renewed-access');
    expect((await reopened.getStoredOAuthTokens(accountId))?.refreshToken).toBe('renewed-refresh');
  });
});

it('persists a rotated refresh token even when the access token is unchanged', async () => {
  const oauth = await import('../../lib/oauth');
  const store = new Map<string, string>();
  vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
  vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
  global.fetch = mockFetch([{ status: 200, json: MOCK_SESSION }]) as any;
  const client = new JMAPClient();
  const tokens = { accessToken: 'same-access', refreshToken: 'first-refresh', expiresAt: Date.now() + 3600000,
    tokenEndpoint: 'https://auth.example.com/token', clientId: 'mobile' };
  const { accountId } = await client.connectWithOAuth('https://mail.example.com', tokens);
  const refresh = vi.spyOn(oauth, 'refreshOAuthAccessToken').mockResolvedValue({ ...tokens, refreshToken: 'rotated-refresh' });
  expect(await client.forceRefreshToken()).toBe(true);
  expect((await client.getStoredOAuthTokens(accountId))?.refreshToken).toBe('rotated-refresh');
  refresh.mockRestore();
});

it('serializes foreground and background renewal of one rotating token', async () => {
  const oauth = await import('../../lib/oauth');
  const store = new Map<string, string>();
  vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
  vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
  global.fetch = mockFetch([{ status: 200, json: MOCK_SESSION }]) as any;
  const client = new JMAPClient();
  const tokens = { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: Date.now() - 1000,
    tokenEndpoint: 'https://auth.example.com/token', clientId: 'mobile' };
  const { accountId } = await client.connectWithOAuth('https://mail.example.com', tokens);
  const observed = (await client.getStoredCredentials(accountId))!;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const refresh = vi.spyOn(oauth, 'refreshOAuthAccessToken').mockImplementation(async () => {
    await gate;
    return { ...tokens, accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: Date.now() + 3600000 };
  });

  const foreground = client.ensureFreshToken();
  const background = client.refreshStoredOAuthCredentials(accountId, observed, true);
  release();
  await Promise.all([foreground, background]);

  expect(refresh).toHaveBeenCalledTimes(1);
  expect(client.authHeader).toBe('Bearer new-access');
  expect((await client.getStoredOAuthTokens(accountId))?.refreshToken).toBe('new-refresh');
  expect((await client.refreshStoredOAuthCredentials(accountId, observed, true))?.refreshToken).toBe('new-refresh');
  expect(refresh).toHaveBeenCalledTimes(1);
  refresh.mockRestore();
});

it('retries an in-flight 401 with a token rotated by a background task', async () => {
  const oauth = await import('../../lib/oauth');
  const store = new Map<string, string>();
  vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
  vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
  global.fetch = mockFetch([{ status: 200, json: MOCK_SESSION }]) as any;
  const client = new JMAPClient();
  const { accountId } = await client.connectWithOAuth('https://mail.example.com', {
    accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: Date.now() + 3600000,
    tokenEndpoint: 'https://auth.example.com/token', clientId: 'mobile',
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const firstRequest = new Promise<void>((resolve) => { started = resolve; });
  const calls: string[] = [];
  global.fetch = vi.fn(async (_url, init) => {
    const auth = (init as RequestInit).headers as Record<string, string>;
    calls.push(auth.Authorization);
    if (auth.Authorization === 'Bearer old-access') {
      started();
      await gate;
      return { status: 401, ok: false, headers: { get: () => null } } as unknown as Response;
    }
    return { status: 200, ok: true, headers: { get: () => null } } as unknown as Response;
  }) as any;
  const refresh = vi.spyOn(oauth, 'refreshOAuthAccessToken');
  const request = client.authenticatedFetch('https://mail.example.com/jmap/');
  await firstRequest;
  const original = (await client.getStoredCredentials(accountId))!;
  await client.setStoredCredentials(accountId, { ...original, accessToken: 'new-access', refreshToken: 'new-refresh' });
  release();
  expect((await request).status).toBe(200);
  expect(calls).toEqual(['Bearer old-access', 'Bearer new-access']);
  expect(refresh).not.toHaveBeenCalled();
  refresh.mockRestore();
});

it('renews an OAuth session when discovery returns a successful but empty document', async () => {
  const oauth = await import('../../lib/oauth');
  const store = new Map<string, string>();
  vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
  vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
  const oldTokens = { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: Date.now() + 3600000,
    tokenEndpoint: 'https://auth.example.com/token', clientId: 'mobile' };
  global.fetch = mockFetch([{ status: 200, json: MOCK_SESSION }]) as any;
  const client = new JMAPClient();
  const { accountId } = await client.connectWithOAuth('https://mail.example.com', oldTokens);
  global.fetch = mockFetch([
    { status: 200, json: { ...MOCK_SESSION, accounts: {}, primaryAccounts: {} } },
    { status: 200, json: MOCK_SESSION },
  ]) as any;
  const refresh = vi.spyOn(oauth, 'refreshOAuthAccessToken').mockResolvedValue({
    ...oldTokens, accessToken: 'new-access', refreshToken: 'new-refresh',
  });
  expect(await client.loadAccount(accountId)).toBe(true);
  expect(client.authHeader).toBe('Bearer new-access');
  expect(refresh).toHaveBeenCalledTimes(1);
  refresh.mockRestore();
});

it('keeps the rotated credential when another runtime saves it just after invalid_grant', async () => {
  const oauth = await import('../../lib/oauth');
  const store = new Map<string, string>();
  vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
  vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
  global.fetch = mockFetch([{ status: 200, json: MOCK_SESSION }]) as any;
  const client = new JMAPClient();
  const { accountId } = await client.connectWithOAuth('https://mail.example.com', {
    accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: Date.now() - 1000,
    tokenEndpoint: 'https://auth.example.com/token', clientId: 'mobile',
  });
  const observed = (await client.getStoredCredentials(accountId))!;
  const refresh = vi.spyOn(oauth, 'refreshOAuthAccessToken').mockRejectedValue(new oauth.HandoffError('Token refresh failed: 400'));
  const otherRuntime = new Promise<void>((resolve) => setTimeout(() => {
    void client.setStoredCredentials(accountId, {
      ...observed, accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: Date.now() + 3600000,
    }).then(resolve);
  }, 30));

  const recovered = await client.refreshStoredOAuthCredentials(accountId, observed, true);
  await otherRuntime;
  expect(recovered?.refreshToken).toBe('new-refresh');
  expect(client.authHeader).toBe('Bearer new-access');
  expect(refresh).toHaveBeenCalledTimes(1);
  refresh.mockRestore();
});
