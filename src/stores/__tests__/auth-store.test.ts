import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/jmap-client', () => ({
  jmapClient: {
    connect: vi.fn(),
    logout: vi.fn(),
    restoreSession: vi.fn(),
    loadAccount: vi.fn(),
    consumeLegacyCredentials: vi.fn(async () => null),
    clearAccountCredentials: vi.fn(async () => undefined),
    clearAllCredentials: vi.fn(async () => undefined),
    reset: vi.fn(),
    snapshot: vi.fn(() => ({ session: null, credentials: null, accountId: null })),
    restoreSnapshot: vi.fn(),
    onAuthFailure: vi.fn(() => () => undefined),
    onTokenRefresh: vi.fn(() => () => undefined),
    hasAccountCapability: vi.fn(() => false),
    request: vi.fn(async () => { throw new Error('not mocked'); }),
    getStoredOAuthTokens: vi.fn(async () => null),
    accountId: 'acc-1',
    currentSession: { apiUrl: 'https://mail.example.com/jmap/' },
    username: 'user',
    serverUrl: 'https://mail.example.com',
  },
  AuthenticationError: class AuthenticationError extends Error {
    constructor(msg: string) { super(msg); this.name = 'AuthenticationError'; }
  },
  NetworkError: class NetworkError extends Error {
    constructor(msg: string) { super(msg); this.name = 'NetworkError'; }
  },
}));

vi.mock('../../lib/push-notifications', () => ({
  teardownPushNotifications: vi.fn(async () => undefined),
  teardownPushNotificationsForAccount: vi.fn(async () => undefined),
}));

vi.mock('../../lib/company-push', () => ({
  revokeCompanyPush: vi.fn(async () => true),
  revokeEvictedCompanyPush: vi.fn(async () => undefined),
}));

import { jmapClient } from '../../api/jmap-client';
import { revokeEvictedCompanyPush } from '../../lib/company-push';
import { useAuthStore } from '../auth-store';
import { useAccountStore } from '../account-store';

const mockConnect = jmapClient.connect as ReturnType<typeof vi.fn>;
const mockLogout = jmapClient.logout as ReturnType<typeof vi.fn>;
const mockLoadAccount = jmapClient.loadAccount as ReturnType<typeof vi.fn>;

function resetAccountStore(): void {
  useAccountStore.setState({
    accounts: [],
    activeAccountId: null,
    defaultAccountId: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAccountStore();
  useAuthStore.setState({
    isAuthenticated: false,
    isLoading: false,
    hasRestoredSession: false,
    error: null,
    serverUrl: null,
    username: null,
    session: null,
    accountId: null,
    activeAccountId: null,
    client: null,
  });
});

describe('auth-store', () => {
  describe('login', () => {
    it('should set authenticated state on success', async () => {
      const session = { apiUrl: 'https://mail.example.com/jmap/' };
      mockConnect.mockResolvedValue(session);

      await useAuthStore.getState().login('https://mail.example.com', 'user', 'pass');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.serverUrl).toBe('https://mail.example.com');
      expect(state.username).toBe('user');
      expect(state.session).toEqual(session);
      expect(state.accountId).toBe('acc-1');
    });

    it('should set error on failure', async () => {
      mockConnect.mockRejectedValue(new Error('Connection refused'));

      await expect(
        useAuthStore.getState().login('https://fail.com', 'user', 'pass'),
      ).rejects.toThrow();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Connection refused');
    });

    it('should set friendly message for AuthenticationError', async () => {
      const { AuthenticationError } = await import('../../api/jmap-client');
      mockConnect.mockRejectedValue(new AuthenticationError('Invalid'));

      await expect(
        useAuthStore.getState().login('https://mail.example.com', 'user', 'bad'),
      ).rejects.toThrow();

      expect(useAuthStore.getState().error).toBe('Invalid username or password');
    });
  });

  describe('logout', () => {
    it('should reset all state when no other accounts remain', async () => {
      useAuthStore.setState({ isAuthenticated: true, serverUrl: 'x', username: 'y' });
      mockLogout.mockResolvedValue(undefined);

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.serverUrl).toBeNull();
      expect(state.username).toBeNull();
    });
  });

  describe('restoreSession', () => {
    it('should return false when there is no registered account', async () => {
      const restored = await useAuthStore.getState().restoreSession();

      expect(restored).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().hasRestoredSession).toBe(true);
    });

    it('should restore when loadAccount succeeds for the active account', async () => {
      useAccountStore.setState({
        accounts: [
          {
            id: 'acc-1',
            serverUrl: 'https://mail.example.com',
            username: 'user',
            displayName: 'user',
            email: 'user',
            avatarColor: '#000',
            lastLoginAt: 0,
            isConnected: false,
            hasError: false,
            isDefault: true,
          },
        ],
        activeAccountId: 'acc-1',
        defaultAccountId: 'acc-1',
      });
      mockLoadAccount.mockResolvedValue(true);

      const restored = await useAuthStore.getState().restoreSession();

      expect(restored).toBe(true);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });

    it('retires an invalid staff registration before removing restore credentials', async () => {
      const id = 'staff@zyndpay.io@mail.zyndpay.io';
      useAccountStore.setState({ accounts: [{
        id, serverUrl: 'https://mail.zyndpay.io', username: 'staff@zyndpay.io',
      } as never], activeAccountId: id, defaultAccountId: id });
      const { AuthenticationError } = await import('../../api/jmap-client');
      mockLoadAccount.mockRejectedValue(new AuthenticationError('Expired'));
      (jmapClient.clearAccountCredentials as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        expect(revokeEvictedCompanyPush).toHaveBeenCalledWith(id);
      });

      expect(await useAuthStore.getState().restoreSession()).toBe(false);
      expect(revokeEvictedCompanyPush).toHaveBeenCalledWith(id);
      expect(useAccountStore.getState().getAccountById(id)).toBeUndefined();
    });
  });

  describe('switchAccount', () => {
    it('retires only the invalid staff account before evicting it', async () => {
      const id = 'staff@zyndpay.io@mail.zyndpay.io';
      useAccountStore.setState({ accounts: [
        { id: 'acc-1', serverUrl: 'https://mail.example.com', username: 'user' } as never,
        { id, serverUrl: 'https://mail.zyndpay.io', username: 'staff@zyndpay.io' } as never,
      ], activeAccountId: 'acc-1', defaultAccountId: 'acc-1' });
      useAuthStore.setState({ activeAccountId: 'acc-1', isAuthenticated: true });
      const { AuthenticationError } = await import('../../api/jmap-client');
      mockLoadAccount.mockRejectedValue(new AuthenticationError('Expired'));
      (jmapClient.clearAccountCredentials as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        expect(revokeEvictedCompanyPush).toHaveBeenCalledWith(id);
      });

      await useAuthStore.getState().switchAccount(id);
      expect(revokeEvictedCompanyPush).toHaveBeenCalledExactlyOnceWith(id);
      expect(useAccountStore.getState().getAccountById(id)).toBeUndefined();
      expect(useAccountStore.getState().getAccountById('acc-1')).toBeDefined();
    });
  });

  describe('clearError', () => {
    it('should clear the error', () => {
      useAuthStore.setState({ error: 'Some error' });
      useAuthStore.getState().clearError();
      expect(useAuthStore.getState().error).toBeNull();
    });
  });
});
