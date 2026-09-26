import { beforeEach, describe, expect, it, vi } from 'vitest';

const handler = vi.hoisted(() => ({ current: null as null | ((notification: unknown) => Promise<unknown>) }));
const current = vi.hoisted(() => ({
  settings: { emailNotificationsEnabled: true, calendarNotificationsEnabled: true, notificationPreviewsEnabled: false },
  accounts: [{ serverUrl: 'https://mail.zyndpay.io' }] as { serverUrl: string }[],
  serverUrl: 'https://mail.zyndpay.io' as string | null,
  previewModeActive: false,
}));

vi.mock('expo-notifications', () => ({
  setNotificationHandler: ({ handleNotification }: { handleNotification: (value: unknown) => Promise<unknown> }) => {
    handler.current = handleNotification;
  },
}));
vi.mock('../calendar-notifications', () => ({ CALENDAR_NOTIFICATION_TAG: 'calendar-alert' }));
vi.mock('../zyndmail-company', () => ({ isCompanyMailServer: (url: string) => url === 'https://mail.zyndpay.io' }));
vi.mock('../company-push', () => ({
  companyPushPreviewModeActive: () => current.previewModeActive,
  isCompanyPushPresentation: (content: { data?: { notificationRef?: string } }) => !!content.data?.notificationRef,
  isGenericCompanyPushPresentation: (content: { title: string; body: string }) =>
    content.title === 'ZyndMail' && content.body === 'New ZyndPay Mail activity',
}));
vi.mock('../../api/jmap-client', () => ({ jmapClient: { get serverUrl() { return current.serverUrl; } } }));
vi.mock('../../stores/account-store', () => ({ useAccountStore: { getState: () => ({ accounts: current.accounts }) } }));
vi.mock('../../stores/settings-store', () => ({ useSettingsStore: { getState: () => current.settings } }));

import '../notification-handler';

async function display(content: { title: string; body: string; data?: Record<string, string> }, trigger: object | null = null) {
  return handler.current!({ request: { content, trigger } }) as Promise<{ shouldShowBanner: boolean; shouldShowList: boolean }>;
}

const generic = { title: 'ZyndMail', body: 'New ZyndPay Mail activity', data: { notificationRef: 'ref' } };
const preview = { title: 'Ada', body: 'Tomorrow at 2', data: { notificationRef: 'ref' } };

beforeEach(() => {
  current.settings.emailNotificationsEnabled = true;
  current.settings.calendarNotificationsEnabled = true;
  current.settings.notificationPreviewsEnabled = false;
  current.accounts = [{ serverUrl: 'https://mail.zyndpay.io' }];
  current.serverUrl = 'https://mail.zyndpay.io';
  current.previewModeActive = false;
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
