import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/jmap-client', () => ({
  jmapClient: {
    connect: vi.fn(),
    connectWithOAuth: vi.fn(),
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
  activateAndroidMailAccount: vi.fn(async () => undefined),
  disableAndroidMailAccount: vi.fn(async () => undefined),
  suspendPersonalPushSetupForAccount: vi.fn(async () => () => undefined),
  teardownPushNotifications: vi.fn(async () => undefined),
  teardownPushNotificationsForAccount: vi.fn(async () => undefined),
}));

vi.mock('../../lib/company-push', () => ({
  reconcileCompanyPush: vi.fn(async () => ({ status: 'OFF' })),
  revokeCompanyPush: vi.fn(async () => true),
  revokeEvictedCompanyPush: vi.fn(async () => undefined),
}));

vi.mock('../../lib/oauth-native', () => ({
  discoverOAuthMetadata: vi.fn(async () => ({})),
  loginWithPkce: vi.fn(),
  probeWebmail: vi.fn(),
  revokeRefreshToken: vi.fn(async () => undefined),
}));

vi.mock('../../lib/calendar-notifications', () => ({
  suspendCalendarNotifications: vi.fn(),
  resumeCalendarNotifications: vi.fn(),
  clearCalendarNotifications: vi.fn(async () => undefined),
}));

import { jmapClient } from '../../api/jmap-client';
import { reconcileCompanyPush, revokeEvictedCompanyPush } from '../../lib/company-push';
import { loginWithPkce } from '../../lib/oauth-native';
import { ZYNDMAIL_COMPANY } from '../../lib/zyndmail-company';
import { suspendCalendarNotifications, resumeCalendarNotifications, clearCalendarNotifications } from '../../lib/calendar-notifications';
import { disableAndroidMailAccount, suspendPersonalPushSetupForAccount, teardownPushNotificationsForAccount } from '../../lib/push-notifications';
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
    it('drains the current account push setup before password sign-in replaces the client', async () => {
      useAuthStore.setState({ isAuthenticated: true, activeAccountId: 'acc-1' });
      let release!: () => void;
      const resume = vi.fn();
      vi.mocked(suspendPersonalPushSetupForAccount).mockImplementationOnce(
        () => new Promise<() => void>((resolve) => { release = () => resolve(resume); }),
      );
      mockConnect.mockResolvedValueOnce({ apiUrl: 'https://other.example.com/jmap/' });
      const login = useAuthStore.getState().login('https://other.example.com', 'other', 'secret', { addAccount: true });
      await vi.waitFor(() => expect(suspendPersonalPushSetupForAccount).toHaveBeenCalledWith('acc-1'));
      expect(mockConnect).not.toHaveBeenCalled();
      release();
      await login;
      expect(mockConnect).toHaveBeenCalledOnce();
      expect(resume).toHaveBeenCalledOnce();
    });

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

  it('reconciles a staff identity before completing OAuth reauthentication', async () => {
    const accountId = 'staff@zyndpay.io@mail.zyndpay.io';
    const payload = { iss: ZYNDMAIL_COMPANY.issuer, aud: ['stalwart'],
      sub: 'replacement-subject', exp: Date.now() / 1000 + 3600 };
    vi.mocked(loginWithPkce).mockResolvedValueOnce({
      accessToken: `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`,
      clientId: ZYNDMAIL_COMPANY.clientId,
      tokenEndpoint: ZYNDMAIL_COMPANY.tokenEndpoint,
    } as never);
    vi.mocked(jmapClient.connectWithOAuth).mockResolvedValueOnce({
      session: { apiUrl: 'https://mail.zyndpay.io/jmap/' },
      username: 'staff@zyndpay.io', accountId,
    } as never);
    useAccountStore.setState({ accounts: [{ id: accountId, username: 'staff@zyndpay.io',
      serverUrl: ZYNDMAIL_COMPANY.mailOrigin } as never], activeAccountId: accountId });
    useAuthStore.setState({ isAuthenticated: true, activeAccountId: accountId });
    let loadingDuringReconciliation: boolean | null = null;
    vi.mocked(reconcileCompanyPush).mockImplementationOnce(async () => {
      loadingDuringReconciliation = useAuthStore.getState().isLoading;
      return { status: 'OFF' };
    });

    await useAuthStore.getState().loginViaCompany();
    expect(reconcileCompanyPush).toHaveBeenCalledWith(accountId);
    expect(loadingDuringReconciliation).toBe(true);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('drains the current account push setup before OAuth sign-in replaces the client', async () => {
    useAuthStore.setState({ isAuthenticated: true, activeAccountId: 'acc-1' });
    let release!: () => void;
    const resume = vi.fn();
    vi.mocked(suspendPersonalPushSetupForAccount).mockImplementationOnce(
      () => new Promise<() => void>((resolve) => { release = () => resolve(resume); }),
    );
    vi.mocked(loginWithPkce).mockResolvedValueOnce({ accessToken: 'token' } as never);
    vi.mocked(jmapClient.connectWithOAuth).mockResolvedValueOnce({
      session: { apiUrl: 'https://other.example.com/jmap/' },
      username: 'other', accountId: 'other@other.example.com',
    } as never);
    const login = useAuthStore.getState().loginViaOAuth('https://other.example.com', { addAccount: true });
    await vi.waitFor(() => expect(suspendPersonalPushSetupForAccount).toHaveBeenCalledWith('acc-1'));
    expect(jmapClient.connectWithOAuth).not.toHaveBeenCalled();
    release();
    await login;
    expect(jmapClient.connectWithOAuth).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
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

    it('holds calendar scheduling until account removal has finished', async () => {
      let releaseTeardown!: () => void;
      const teardown = new Promise<void>((resolve) => { releaseTeardown = resolve; });
      vi.mocked(teardownPushNotificationsForAccount).mockReturnValueOnce(teardown);
      useAccountStore.setState({ accounts: [{
        id: 'acc-1', username: 'user', serverUrl: 'https://mail.example.com',
      } as never] });
      useAuthStore.setState({ isAuthenticated: true, activeAccountId: 'acc-1' });

      const loggingOut = useAuthStore.getState().logout();
      await vi.waitFor(() => expect(teardownPushNotificationsForAccount).toHaveBeenCalledWith('acc-1'));
      expect(suspendCalendarNotifications).toHaveBeenCalledOnce();
      expect(disableAndroidMailAccount).toHaveBeenCalledWith('acc-1');
      expect(clearCalendarNotifications).toHaveBeenCalledOnce();
      expect(resumeCalendarNotifications).not.toHaveBeenCalled();
      releaseTeardown();
      await loggingOut;
      expect(useAccountStore.getState().accounts).toEqual([]);
      expect(clearCalendarNotifications).toHaveBeenCalledTimes(2);
      expect(resumeCalendarNotifications).not.toHaveBeenCalled();
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
    it('waits for the previous push setup before replacing the JMAP session', async () => {
      const nextId = 'other@mail.example.com';
      useAccountStore.setState({ accounts: [
        { id: 'acc-1', serverUrl: 'https://mail.example.com', username: 'user' } as never,
        { id: nextId, serverUrl: 'https://mail.example.com', username: 'other' } as never,
      ], activeAccountId: 'acc-1', defaultAccountId: 'acc-1' });
      useAuthStore.setState({ activeAccountId: 'acc-1', isAuthenticated: true });
      let release!: () => void;
      const resume = vi.fn();
      (suspendPersonalPushSetupForAccount as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () => new Promise<() => void>((resolve) => { release = () => resolve(resume); }),
      );
      mockLoadAccount.mockResolvedValueOnce(true);
      const switching = useAuthStore.getState().switchAccount(nextId);
      expect(suspendPersonalPushSetupForAccount).toHaveBeenCalledWith('acc-1');
      expect(mockLoadAccount).not.toHaveBeenCalled();
      release();
      await switching;
      expect(mockLoadAccount).toHaveBeenCalledWith(nextId);
      expect(resume).toHaveBeenCalledOnce();
    });

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
