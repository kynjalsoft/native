import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useCalendarStore } from '../stores/calendar-store';
import { useSettingsStore } from '../stores/settings-store';
import { getUpcomingAlerts, type ScheduledAlert } from './calendar-alert-scheduler';

// Local reminders for calendar events and tasks. The webmail polls
// `getPendingAlerts` every minute while a tab is open; a phone is mostly
// asleep, so instead every (re)load of the calendar schedules OS-level local
// notifications for the alerts that fall due in the next few days and
// cancels the ones that no longer apply. Honours the
// `calendarNotificationsEnabled` setting.

const CHANNEL_ID = 'calendar-reminders';
const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
// iOS keeps at most 64 pending local notifications per app; leave room for
// the rest of the app.
const MAX_SCHEDULED = 48;
export const CALENDAR_NOTIFICATION_TAG = 'bulwark-calendar-alert';
const DATA_TAG = CALENDAR_NOTIFICATION_TAG;

let permissionGranted: boolean | null = null;
let channelReady = false;
let rescheduleTimer: ReturnType<typeof setTimeout> | null = null;
let rescheduling: Promise<void> | null = null;
let queued = false;
let syncStarted = false;
let lastScheduledKeys: string[] = [];
let scheduleGeneration = 0;
let suspended = false;

export function suspendCalendarNotifications(): void {
  suspended = true;
  scheduleGeneration += 1;
  queued = false;
  if (rescheduleTimer) clearTimeout(rescheduleTimer);
  rescheduleTimer = null;
}

export function resumeCalendarNotifications(): void {
  if (!suspended) return;
  suspended = false;
  scheduleSoon();
}

async function ensurePermission(): Promise<boolean> {
  if (permissionGranted !== null) return permissionGranted;
  try {
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (!granted && current.canAskAgain) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.granted || requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    }
    permissionGranted = !!granted;
  } catch {
    permissionGranted = false;
  }
  return permissionGranted;
}

async function ensureChannel(): Promise<void> {
  if (channelReady || Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Calendar reminders',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  } catch {
    // Channel creation failing only degrades to the default channel.
  }
  channelReady = true;
}

function alertKeyOf(request: Notifications.NotificationRequest): string | null {
  const data = request.content.data as { tag?: string; key?: string } | undefined;
  return data?.tag === DATA_TAG && typeof data.key === 'string' ? data.key : null;
}

/** Cancel every calendar reminder this app scheduled. */
export async function cancelAllCalendarNotifications(): Promise<void> {
  scheduleGeneration += 1;
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      pending
        .filter((r) => alertKeyOf(r) !== null)
        .map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier)),
    );
  } catch {
    // Nothing to do; the OS keeps whatever it has.
  }
  lastScheduledKeys = [];
}

/** Calendar data is not account-scoped yet. A switch or sign-out must remove
 * both future reminders and calendar text already visible in the OS tray. */
export async function clearCalendarNotifications(): Promise<void> {
  await cancelAllCalendarNotifications();
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(presented
      .filter((notification) => notification.request.content.data?.tag === DATA_TAG)
      .map((notification) => Notifications.dismissNotificationAsync(notification.request.identifier)));
  } catch {
    // Best effort when the native notification service is unavailable.
  }
}

async function scheduleOne(alert: ScheduledAlert): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: alert.title,
      body: alert.body,
      sound: 'default',
      data: { tag: DATA_TAG, key: alert.key, eventId: alert.eventId, kind: alert.kind },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(alert.fireTimeMs),
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
  });
}

/**
 * Re-derive the reminders from the store and reconcile them with what the
 * OS has pending: cancel alerts that vanished (event deleted, reminder
 * removed, task completed) and add the new ones. Concurrent calls coalesce.
 */
export async function rescheduleCalendarNotifications(): Promise<void> {
  if (suspended) return;
  if (rescheduling) {
    queued = true;
    return rescheduling;
  }
  rescheduling = (async () => {
    try {
      const generation = scheduleGeneration;
      const enabled = useSettingsStore.getState().calendarNotificationsEnabled;
      if (!enabled) {
        if (lastScheduledKeys.length > 0) await cancelAllCalendarNotifications();
        return;
      }
      if (!(await ensurePermission())) return;
      await ensureChannel();
      if (suspended || generation !== scheduleGeneration) return;

      const { events, tasks, calendars } = useCalendarStore.getState();
      const wanted = getUpcomingAlerts(events, tasks, calendars, {
        now: Date.now(),
        horizonMs: HORIZON_MS,
        limit: MAX_SCHEDULED,
      });
      const wantedByKey = new Map(wanted.map((a) => [a.key, a]));

      const pending = await Notifications.getAllScheduledNotificationsAsync();
      if (suspended || generation !== scheduleGeneration) return;
      const present = new Set<string>();
      for (const request of pending) {
        if (suspended || generation !== scheduleGeneration) return;
        const key = alertKeyOf(request);
        if (key === null) continue;
        if (wantedByKey.has(key)) {
          present.add(key);
        } else {
          await Notifications.cancelScheduledNotificationAsync(request.identifier);
        }
      }
      for (const alert of wanted) {
        if (suspended || generation !== scheduleGeneration) return;
        if (present.has(alert.key)) continue;
        try {
          const identifier = await scheduleOne(alert);
          if (suspended || generation !== scheduleGeneration) {
            await Notifications.cancelScheduledNotificationAsync(identifier);
            return;
          }
        } catch {
          // A single bad trigger must not block the rest.
        }
      }
      if (!suspended && generation === scheduleGeneration) lastScheduledKeys = [...wantedByKey.keys()];
    } catch {
      // Notifications are best-effort.
    } finally {
      rescheduling = null;
      if (queued && !suspended) {
        queued = false;
        void rescheduleCalendarNotifications();
      }
    }
  })();
  return rescheduling;
}

function scheduleSoon(): void {
  if (suspended) return;
  if (rescheduleTimer) clearTimeout(rescheduleTimer);
  // Debounce: a refresh sets events and tasks in two steps.
  rescheduleTimer = setTimeout(() => {
    rescheduleTimer = null;
    void rescheduleCalendarNotifications();
  }, 1500);
}

/**
 * Keep local reminders in sync with the calendar store and the notification
 * setting for the rest of the session. Idempotent; call once the calendar
 * has been shown.
 */
export function startCalendarNotificationSync(): void {
  if (syncStarted) return;
  syncStarted = true;
  let prev = useCalendarStore.getState();
  useCalendarStore.subscribe((state) => {
    if (state.events !== prev.events || state.tasks !== prev.tasks || state.calendars !== prev.calendars) {
      prev = state;
      scheduleSoon();
    }
  });
  let prevEnabled = useSettingsStore.getState().calendarNotificationsEnabled;
  useSettingsStore.subscribe((state) => {
    if (state.calendarNotificationsEnabled !== prevEnabled) {
      prevEnabled = state.calendarNotificationsEnabled;
      scheduleSoon();
    }
  });
  scheduleSoon();
}
