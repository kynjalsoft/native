import * as Notifications from 'expo-notifications';
import { CALENDAR_NOTIFICATION_TAG } from './calendar-notifications';
import { companyPushModeActive, companyPushPreviewModeActive, isCompanyPushPresentation, isGenericCompanyPushPresentation, resolveCompanyPush } from './company-push';
import { generateAccountId } from './account-utils';
import { isCompanyMailServer } from './zyndmail-company';
import { jmapClient } from '../api/jmap-client';
import { useAccountStore } from '../stores/account-store';
import { useAuthStore } from '../stores/auth-store';
import { useSettingsStore } from '../stores/settings-store';

/** Registered on startup so only known local reminders or private mail alerts display in-app. */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const { content, trigger } = notification.request;
    const settings = useSettingsStore.getState();
    const calendar = settings.calendarNotificationsEnabled && !!jmapClient.serverUrl &&
      !isCompanyMailServer(jmapClient.serverUrl ?? '') &&
      trigger && 'type' in trigger && trigger.type === 'date' &&
      content.data?.tag === CALENDAR_NOTIFICATION_TAG;
    const companyAccountPresent = useAccountStore.getState().accounts.some((account) =>
      isCompanyMailServer(account.serverUrl));
    const generic = isGenericCompanyPushPresentation(content);
    const auth = useAuthStore.getState();
    const accountId = auth.isAuthenticated && !auth.isLoading ? auth.activeAccountId : null;
    const mailCandidate = companyAccountPresent && isCompanyPushPresentation(content);
    const eligible = settings.emailNotificationsEnabled && mailCandidate && !!accountId &&
      await (generic ? companyPushModeActive(accountId) : companyPushPreviewModeActive(accountId));
    let verified = generic;
    let timedOut = false;
    if (eligible && !generic && accountId) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const deadline = Symbol();
      try {
        const destination = await Promise.race([
          resolveCompanyPush(accountId, content.data),
          new Promise<typeof deadline>((resolve) => { timeout = setTimeout(() => resolve(deadline), 1500); }),
        ]);
        timedOut = destination === deadline;
        verified = destination !== deadline && destination?.target === 'EMAIL';
      } catch {
        verified = false;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    const currentAuth = useAuthStore.getState();
    const currentSettings = useSettingsStore.getState();
    const mail = eligible && currentSettings.emailNotificationsEnabled &&
      currentAuth.isAuthenticated && !currentAuth.isLoading && currentAuth.activeAccountId === accountId &&
      generateAccountId(jmapClient.username ?? '', jmapClient.serverUrl ?? '') === accountId &&
      verified && (generic || currentSettings.notificationPreviewsEnabled);
    if (timedOut && eligible && currentSettings.emailNotificationsEnabled &&
        currentAuth.isAuthenticated && !currentAuth.isLoading && currentAuth.activeAccountId === accountId &&
        generateAccountId(jmapClient.username ?? '', jmapClient.serverUrl ?? '') === accountId) {
      await Notifications.scheduleNotificationAsync({
        content: { title: 'ZyndMail', body: 'New ZyndPay Mail activity', data: content.data },
        trigger: null,
      }).catch(() => undefined);
    }
    const visible = !!calendar || mail;
    return {
      shouldShowBanner: visible,
      shouldShowList: visible,
      shouldPlaySound: visible,
      shouldSetBadge: false,
    };
  },
});
