import { beforeEach, describe, expect, it, vi } from 'vitest';

const handler = vi.hoisted(() => ({ current: null as null | ((notification: unknown) => Promise<unknown>) }));
const scheduled = vi.hoisted(() => vi.fn(async (_request: {
  content: { title: string; body: string; data: Record<string, string> }; trigger: null;
}) => 'generic-fallback'));
const current = vi.hoisted(() => ({
  settings: { emailNotificationsEnabled: true, calendarNotificationsEnabled: true, notificationPreviewsEnabled: false },
  accounts: [{ serverUrl: 'https://mail.zyndpay.io' }] as { serverUrl: string }[],
  serverUrl: 'https://mail.zyndpay.io' as string | null,
  username: 'staff@zyndpay.io',
  pushModeActive: true,
  revocationPending: false,
  previewModeActive: false,
  registrationMatches: true,
  auth: { isAuthenticated: true, isLoading: false, activeAccountId: 'staff@zyndpay.io@mail.zyndpay.io' as string | null },
}));

vi.mock('expo-notifications', () => ({
  setNotificationHandler: ({ handleNotification }: { handleNotification: (value: unknown) => Promise<unknown> }) => {
    handler.current = handleNotification;
  },
  scheduleNotificationAsync: scheduled,
}));
vi.mock('../calendar-notifications', () => ({ CALENDAR_NOTIFICATION_TAG: 'calendar-alert' }));
vi.mock('../zyndmail-company', () => ({ isCompanyMailServer: (url: string) => url === 'https://mail.zyndpay.io' }));
vi.mock('../company-push', () => ({
  companyPushModeActive: async (accountId: string) =>
    accountId === 'staff@zyndpay.io@mail.zyndpay.io' && current.pushModeActive && !current.revocationPending,
  companyPushPreviewModeActive: async (accountId: string) => accountId === 'staff@zyndpay.io@mail.zyndpay.io' && current.previewModeActive,
  companyPushRegistrationIdActive: async (accountId: string, registrationId: string, previews: boolean) =>
    accountId === 'staff@zyndpay.io@mail.zyndpay.io' && registrationId === 'registration-1' &&
    current.registrationMatches && current.pushModeActive && (!previews || current.previewModeActive),
  parseCompanyPushPayload: (data: { notificationRef?: string; registrationId?: string }) =>
    data?.notificationRef ? data : null,
  isCompanyPushPresentation: (content: { data?: { notificationRef?: string } }) => !!content.data?.notificationRef,
  isGenericCompanyPushPresentation: (content: { title: string; body: string }) =>
    content.title === 'ZyndMail' && content.body === 'New ZyndPay Mail activity',
}));
vi.mock('../../api/jmap-client', () => ({ jmapClient: {
  get serverUrl() { return current.serverUrl; }, get username() { return current.username; },
} }));
vi.mock('../../stores/account-store', () => ({ useAccountStore: { getState: () => ({ accounts: current.accounts }) } }));
vi.mock('../../stores/auth-store', () => ({ useAuthStore: { getState: () => current.auth } }));
vi.mock('../../stores/settings-store', () => ({ useSettingsStore: { getState: () => current.settings } }));

import '../notification-handler';

async function display(content: { title: string; body: string; data?: Record<string, string> }, trigger: object | null = null) {
  return handler.current!({ request: { content, trigger } }) as Promise<{ shouldShowBanner: boolean; shouldShowList: boolean }>;
}

const generic = { title: 'ZyndMail', body: 'New ZyndPay Mail activity', data: { notificationRef: 'ref' } };
const preview = { title: 'Ada', body: 'Tomorrow at 2', data: { notificationRef: 'ref', registrationId: 'registration-1' } };

beforeEach(() => {
  scheduled.mockClear();
  current.settings.emailNotificationsEnabled = true;
  current.settings.calendarNotificationsEnabled = true;
  current.settings.notificationPreviewsEnabled = false;
  current.accounts = [{ serverUrl: 'https://mail.zyndpay.io' }];
  current.serverUrl = 'https://mail.zyndpay.io';
  current.username = 'staff@zyndpay.io';
  current.registrationMatches = true;
  current.pushModeActive = true;
  current.revocationPending = false;
  current.previewModeActive = false;
  current.auth.isAuthenticated = true;
  current.auth.isLoading = false;
  current.auth.activeAccountId = 'staff@zyndpay.io@mail.zyndpay.io';
});

describe('foreground notification presentation', () => {
  it('shows generic company alerts while preview consent is off', async () => {
    expect((await display(generic)).shouldShowBanner).toBe(true);
    expect((await display(preview)).shouldShowBanner).toBe(false);
    current.settings.notificationPreviewsEnabled = true;
    expect((await display(preview)).shouldShowBanner).toBe(false);
    current.previewModeActive = true;
    expect((await display(preview)).shouldShowBanner).toBe(true);
  });

  it('hides mail alerts when globally disabled or the staff account has left', async () => {
    current.settings.emailNotificationsEnabled = false;
    expect((await display(generic)).shouldShowList).toBe(false);
    current.settings.emailNotificationsEnabled = true;
    current.accounts = [];
    expect((await display(generic)).shouldShowList).toBe(false);
  });

  it('hides generic company alerts after local opt-out or pending revocation', async () => {
    expect((await display(generic)).shouldShowList).toBe(true);
    current.pushModeActive = false;
    expect((await display(generic)).shouldShowList).toBe(false);
    current.pushModeActive = true;
    current.revocationPending = true;
    expect((await display(generic)).shouldShowList).toBe(false);

    current.serverUrl = 'https://personal.example.test';
    const reminder = { title: 'Meeting', body: 'Starts soon', data: { tag: 'calendar-alert' } };
    expect((await display(reminder, { type: 'date' })).shouldShowList).toBe(true);
  });

  it('shows registration-bound rich mail during renewal and hides it during an account switch', async () => {
    current.settings.notificationPreviewsEnabled = true;
    current.previewModeActive = true;
    expect((await display(preview)).shouldShowList).toBe(true);
    current.auth.isLoading = true;
    expect((await display(preview)).shouldShowList).toBe(false);
    current.auth.isLoading = false;
    current.auth.activeAccountId = 'other-account';
    expect((await display(preview)).shouldShowList).toBe(false);
  });

  it('suppresses mail with an explicit registration belonging to another account', async () => {
    current.settings.notificationPreviewsEnabled = true;
    current.previewModeActive = true;
    const mismatched = { ...preview, data: { ...preview.data, registrationId: 'other-registration' } };
    expect((await display(mismatched)).shouldShowList).toBe(false);
    expect(scheduled).not.toHaveBeenCalled();
    expect((await display({ title: 'ZyndMail', body: 'New ZyndPay Mail activity', data: mismatched.data })).shouldShowList).toBe(false);
  });

  it('suppresses rich mail when the account switches during the local registration check', async () => {
    current.settings.notificationPreviewsEnabled = true;
    current.previewModeActive = true;
    const showing = display(preview);
    current.auth.isLoading = true;
    current.username = 'other@zyndpay.io';
    expect((await showing).shouldShowList).toBe(false);
  });

  it('posts a safe generic alert for legacy rich data without a registration ID', async () => {
    current.settings.notificationPreviewsEnabled = true;
    current.previewModeActive = true;
    const legacy = { ...preview, data: { notificationRef: 'ref' } };
    expect((await display(legacy)).shouldShowList).toBe(false);
    expect(scheduled).toHaveBeenCalledOnce();
    const fallback = scheduled.mock.calls[0][0];
    expect(fallback).toEqual({
      content: { title: 'ZyndMail', body: 'New ZyndPay Mail activity', data: legacy.data },
      trigger: null,
    });
    expect((await display(fallback.content)).shouldShowList).toBe(true);
  });

  it('shows only enabled calendar reminders for a connected non-company account', async () => {
    const reminder = { title: 'Meeting', body: 'Starts soon', data: { tag: 'calendar-alert' } };
    const trigger = { type: 'date' };
    expect((await display(reminder, trigger)).shouldShowBanner).toBe(false);
    current.serverUrl = 'https://personal.example.test';
    expect((await display(reminder, trigger)).shouldShowBanner).toBe(true);
    current.settings.calendarNotificationsEnabled = false;
    expect((await display(reminder, trigger)).shouldShowBanner).toBe(false);
  });
});
