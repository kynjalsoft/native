import { describe, expect, it, vi } from 'vitest';
import { openCompanyPushIntent, type CompanyPushIntentDependencies, type CompanyPushResponseLike } from '../company-push-intent';

const response: CompanyPushResponseLike = {
  notification: { request: { identifier: 'notification-1', content: {
    title: 'Ada Example', body: 'Project update', data: { version: 1, notificationRef: 'a'.repeat(24) },
  } } },
};

function dependencies(overrides: Partial<CompanyPushIntentDependencies> = {}): CompanyPushIntentDependencies {
  return {
    response,
    readReadiness: () => ({
      authenticated: true,
      locked: false,
      switching: false,
      sessionAccountId: 'company-local-account',
      accountRegistryHydrated: true,
      navigationReady: true,
      activeAccountId: 'company-local-account',
      accounts: [{ id: 'company-local-account', serverUrl: 'https://mail.zyndpay.io' }],
    }),
    isCompanyMailServer: (serverUrl) => serverUrl === 'https://mail.zyndpay.io',
    isCompanyPushPresentation: () => true,
    registeredCompanyAccountId: vi.fn(async () => 'company-local-account'),
    switchAccount: vi.fn(async () => undefined),
    resolveDestination: vi.fn(async () => ({
      target: 'EMAIL' as const,
      accountId: 'jmap-account',
      emailId: 'delivered-message',
      threadId: 'message-thread',
    })),
    navigateToEmail: vi.fn(),
    clearLastNotificationResponse: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('company push tap routing', () => {
  it('waits for account restoration, unlock, auth, and navigation instead of dropping a cold-start tap', async () => {
    const resolveDestination = vi.fn(async () => null);
    const deps = dependencies({
      readReadiness: () => ({
        authenticated: true,
        locked: false,
        switching: false,
        sessionAccountId: 'company-local-account',
        accountRegistryHydrated: false,
        navigationReady: false,
        activeAccountId: 'company-local-account',
        accounts: [],
      }),
      resolveDestination,
    });

    await expect(openCompanyPushIntent(deps)).resolves.toBe('deferred');
    expect(resolveDestination).not.toHaveBeenCalled();
    expect(deps.clearLastNotificationResponse).not.toHaveBeenCalled();
  });

  it('switches to the authorized company account and opens the exact resolved email', async () => {
    let switched = false;
    const readiness = {
      authenticated: true,
      locked: false,
      switching: false,
      sessionAccountId: 'personal-account',
      accountRegistryHydrated: true,
      navigationReady: true,
      activeAccountId: 'personal-account',
      accounts: [
        { id: 'personal-account', serverUrl: 'https://mail.example.net' },
        { id: 'company-local-account', serverUrl: 'https://mail.zyndpay.io' },
      ],
    };
    const deps = dependencies({
      readReadiness: () => ({ ...readiness, activeAccountId: switched ? 'company-local-account' : readiness.activeAccountId,
        sessionAccountId: switched ? 'company-local-account' : readiness.sessionAccountId }),
      switchAccount: vi.fn(async () => { switched = true; }),
    });

    await expect(openCompanyPushIntent(deps)).resolves.toBe('opened');
    expect(deps.switchAccount).toHaveBeenCalledWith('company-local-account');
    expect(deps.resolveDestination).toHaveBeenCalledWith('company-local-account', response.notification.request.content.data);
    expect(deps.navigateToEmail).toHaveBeenCalledWith({
      target: 'EMAIL', accountId: 'jmap-account', emailId: 'delivered-message', threadId: 'message-thread',
    });
    expect(deps.clearLastNotificationResponse).toHaveBeenCalledOnce();
  });

  it('uses the registration owner when multiple staff accounts are saved', async () => {
    let active = 'staff-one';
    const deps = dependencies({
      readReadiness: () => ({
        authenticated: true, locked: false, switching: false, sessionAccountId: active,
        accountRegistryHydrated: true, navigationReady: true,
        activeAccountId: active,
        accounts: [
          { id: 'staff-one', serverUrl: 'https://mail.zyndpay.io' },
          { id: 'staff-two', serverUrl: 'https://mail.zyndpay.io' },
        ],
      }),
      registeredCompanyAccountId: vi.fn(async () => 'staff-two'),
      switchAccount: vi.fn(async (id) => { active = id; }),
    });
    await expect(openCompanyPushIntent(deps)).resolves.toBe('opened');
    expect(deps.switchAccount).toHaveBeenCalledWith('staff-two');
    expect(deps.resolveDestination).toHaveBeenCalledWith('staff-two', response.notification.request.content.data);
  });

  it('retries an owner lookup failure and opens a later tap', async () => {
    const registeredCompanyAccountId = vi.fn()
      .mockRejectedValueOnce(new Error('SecureStore unavailable'))
      .mockResolvedValue('company-local-account');
    const deps = dependencies({ registeredCompanyAccountId });

    await expect(openCompanyPushIntent(deps)).resolves.toBe('retry');
    expect(deps.resolveDestination).not.toHaveBeenCalled();
    expect(deps.clearLastNotificationResponse).not.toHaveBeenCalled();

    await expect(openCompanyPushIntent(deps)).resolves.toBe('opened');
    expect(deps.navigateToEmail).toHaveBeenCalledOnce();
    expect(deps.clearLastNotificationResponse).toHaveBeenCalledOnce();
  });

  it('does not guess a destination when registration ownership is unknown', async () => {
    const deps = dependencies({
      registeredCompanyAccountId: vi.fn(async () => null),
      readReadiness: () => ({
        authenticated: true, locked: false, switching: false, sessionAccountId: 'staff-one',
        accountRegistryHydrated: true, navigationReady: true,
        activeAccountId: 'staff-one',
        accounts: [
          { id: 'staff-one', serverUrl: 'https://mail.zyndpay.io' },
          { id: 'staff-two', serverUrl: 'https://mail.zyndpay.io' },
        ],
      }),
    });

    await expect(openCompanyPushIntent(deps)).resolves.toBe('retry');
    expect(deps.switchAccount).not.toHaveBeenCalled();
    expect(deps.resolveDestination).not.toHaveBeenCalled();
    expect(deps.navigateToEmail).not.toHaveBeenCalled();
  });

  it('keeps a transient relay failure retryable and does not navigate to the inbox', async () => {
    const deps = dependencies({ resolveDestination: vi.fn(async () => null) });

    await expect(openCompanyPushIntent(deps)).resolves.toBe('retry');
    expect(deps.navigateToEmail).not.toHaveBeenCalled();
    expect(deps.clearLastNotificationResponse).not.toHaveBeenCalled();
  });

  it('retries when an account switch does not activate the company mailbox', async () => {
    const deps = dependencies({
      readReadiness: () => ({
        authenticated: true,
        locked: false,
        switching: false,
        sessionAccountId: 'personal-account',
        accountRegistryHydrated: true,
        navigationReady: true,
        activeAccountId: 'personal-account',
        accounts: [{ id: 'company-local-account', serverUrl: 'https://mail.zyndpay.io' }],
      }),
    });

    await expect(openCompanyPushIntent(deps)).resolves.toBe('retry');
    expect(deps.resolveDestination).not.toHaveBeenCalled();
    expect(deps.clearLastNotificationResponse).not.toHaveBeenCalled();
  });

  it('does not navigate an unresolved or expired reference', async () => {
    const deps = dependencies({
      resolveDestination: vi.fn(async () => null),
    });

    await expect(openCompanyPushIntent(deps)).resolves.toBe('retry');
    expect(deps.navigateToEmail).not.toHaveBeenCalled();
    expect(deps.clearLastNotificationResponse).not.toHaveBeenCalled();
  });

  it('defers a tap when switching starts during message resolution', async () => {
    let finish!: (value: { target: 'EMAIL'; accountId: string; emailId: string; threadId: string }) => void;
    let switching = false;
    const deps = dependencies({
      readReadiness: () => ({
        authenticated: true, locked: false, switching,
        sessionAccountId: switching ? 'other-account' : 'company-local-account',
        accountRegistryHydrated: true, navigationReady: true,
        activeAccountId: 'company-local-account',
        accounts: [{ id: 'company-local-account', serverUrl: 'https://mail.zyndpay.io' }],
      }),
      resolveDestination: vi.fn(() => new Promise<{ target: 'EMAIL'; accountId: string; emailId: string; threadId: string }>((resolve) => { finish = resolve; })),
    });
    const opening = openCompanyPushIntent(deps);
    await vi.waitFor(() => expect(deps.resolveDestination).toHaveBeenCalled());
    switching = true;
    finish({ target: 'EMAIL', accountId: 'jmap-account', emailId: 'message', threadId: 'thread' });
    await expect(opening).resolves.toBe('deferred');
    expect(deps.navigateToEmail).not.toHaveBeenCalled();
  });
});
