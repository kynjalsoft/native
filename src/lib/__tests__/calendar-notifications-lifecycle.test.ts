import { expect, it, vi } from 'vitest';

const notifications = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  getAllScheduledNotificationsAsync: vi.fn(async () => []),
  getPresentedNotificationsAsync: vi.fn(async () => []),
  scheduleNotificationAsync: vi.fn(async () => 'scheduled-alert'),
  cancelScheduledNotificationAsync: vi.fn(async () => undefined),
  dismissNotificationAsync: vi.fn(async () => undefined),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-notifications', () => ({
  ...notifications,
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
vi.mock('../../stores/calendar-store', () => ({ useCalendarStore: { getState: () => ({
  events: [], tasks: [], calendars: [],
}) } }));
vi.mock('../../stores/settings-store', () => ({ useSettingsStore: { getState: () => ({
  calendarNotificationsEnabled: true,
}) } }));
vi.mock('../calendar-alert-scheduler', () => ({ getUpcomingAlerts: () => [{
  key: 'private-reminder', title: 'Private meeting', body: 'Starts soon',
  eventId: 'event-1', kind: 'event', fireTimeMs: Date.now() + 60_000,
}] }));

import {
  clearCalendarNotifications,
  rescheduleCalendarNotifications,
  resumeCalendarNotifications,
  suspendCalendarNotifications,
} from '../calendar-notifications';

it('does not recreate a private reminder while logout clears queued scheduling', async () => {
  let releasePermission!: () => void;
  let reachedPermission!: () => void;
  const heldPermission = new Promise<void>((resolve) => { releasePermission = resolve; });
  const permissionStarted = new Promise<void>((resolve) => { reachedPermission = resolve; });
  notifications.getPermissionsAsync.mockImplementationOnce(async () => {
    reachedPermission();
    await heldPermission;
    return { granted: true, canAskAgain: false };
  });

  const original = rescheduleCalendarNotifications();
  await permissionStarted;
  const queued = rescheduleCalendarNotifications();
  suspendCalendarNotifications();
  await clearCalendarNotifications();
  releasePermission();
  await Promise.all([original, queued]);
  await rescheduleCalendarNotifications();
  expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();

  vi.useFakeTimers();
  resumeCalendarNotifications();
  await rescheduleCalendarNotifications();
  expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.objectContaining({ title: 'Private meeting' }),
  }));
  vi.clearAllTimers();
  vi.useRealTimers();
});
