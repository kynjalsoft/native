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
      accountRegistryHydrated: true,
      navigationReady: true,
      activeAccountId: 'company-local-account',
      accounts: [{ id: 'company-local-account', serverUrl: 'https://mail.zyndpay.io' }],
    }),
    isCompanyMailServer: (serverUrl) => serverUrl === 'https://mail.zyndpay.io',
    isCompanyPushPresentation: () => true,
    switchAccount: vi.fn(async () => undefined),
    resolveDestination: vi.fn(async () => ({
      target: 'EMAIL' as const,
      accountId: 'jmap-account',
      emailId: 'delivered-message',
      threadId: 'message-thread',
    })),
    navigateToEmail: vi.fn(),
    navigateToInbox: vi.fn(),
    showInboxFallback: vi.fn(),
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
      accountRegistryHydrated: true,
      navigationReady: true,
      activeAccountId: 'personal-account',
      accounts: [
        { id: 'personal-account', serverUrl: 'https://mail.example.net' },
        { id: 'company-local-account', serverUrl: 'https://mail.zyndpay.io' },
      ],
    };
    const deps = dependencies({
      readReadiness: () => ({ ...readiness, activeAccountId: switched ? 'company-local-account' : readiness.activeAccountId }),
      switchAccount: vi.fn(async () => { switched = true; }),
    });

    await expect(openCompanyPushIntent(deps)).resolves.toBe('opened');
    expect(deps.switchAccount).toHaveBeenCalledWith('company-local-account');
    expect(deps.resolveDestination).toHaveBeenCalledWith('company-local-account', response.notification.request.content.data);
    expect(deps.navigateToEmail).toHaveBeenCalledWith({
      target: 'EMAIL', accountId: 'jmap-account', emailId: 'delivered-message', threadId: 'message-thread',
    });
    expect(deps.navigateToInbox).not.toHaveBeenCalled();
    expect(deps.clearLastNotificationResponse).toHaveBeenCalledOnce();
  });

  it('uses the registration owner when multiple staff accounts are saved', async () => {
    let active = 'staff-one';
    const deps = dependencies({
      readReadiness: () => ({
        authenticated: true, locked: false, accountRegistryHydrated: true, navigationReady: true,
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

  it('keeps a transient relay failure retryable and does not navigate to the inbox', async () => {
    const deps = dependencies({ resolveDestination: vi.fn(async () => null) });

    await expect(openCompanyPushIntent(deps)).resolves.toBe('retry');
    expect(deps.navigateToEmail).not.toHaveBeenCalled();
    expect(deps.navigateToInbox).not.toHaveBeenCalled();
    expect(deps.clearLastNotificationResponse).not.toHaveBeenCalled();
  });

  it('retries when an account switch does not activate the company mailbox', async () => {
    const deps = dependencies({
      readReadiness: () => ({
        authenticated: true,
        locked: false,
        accountRegistryHydrated: true,
        navigationReady: true,
        activeAccountId: 'personal-account',
        accounts: [{ id: 'company-local-account', serverUrl: 'https://mail.zyndpay.io' }],
      }),
    });

    await expect(openCompanyPushIntent(deps)).resolves.toBe('retry');
    expect(deps.resolveDestination).not.toHaveBeenCalled();
    expect(deps.navigateToInbox).not.toHaveBeenCalled();
    expect(deps.clearLastNotificationResponse).not.toHaveBeenCalled();
  });

  it('explains legacy or expired references before opening Inbox as the safe fallback', async () => {
    const deps = dependencies({
      resolveDestination: vi.fn(async () => ({ target: 'INBOX' as const })),
    });

    await expect(openCompanyPushIntent(deps)).resolves.toBe('opened');
    expect(deps.showInboxFallback).toHaveBeenCalledOnce();
    expect(deps.navigateToInbox).toHaveBeenCalledOnce();
    expect(deps.navigateToEmail).not.toHaveBeenCalled();
    expect(deps.clearLastNotificationResponse).toHaveBeenCalledOnce();
  });
});
