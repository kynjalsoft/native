import * as Notifications from 'expo-notifications';
import { CALENDAR_NOTIFICATION_TAG } from './calendar-notifications';
import { companyPushModeActive, companyPushRegistrationIdActive, isCompanyPushPresentation, isGenericCompanyPushPresentation, parseCompanyPushPayload } from './company-push';
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
    const payload = parseCompanyPushPayload(content.data);
    const auth = useAuthStore.getState();
    const accountId = auth.isAuthenticated && !auth.isLoading ? auth.activeAccountId : null;
    const mailCandidate = companyAccountPresent && isCompanyPushPresentation(content);
    const active = settings.emailNotificationsEnabled && mailCandidate && !!accountId && !!payload &&
      await companyPushModeActive(accountId);
    const current = () => {
      const currentAuth = useAuthStore.getState();
      const currentSettings = useSettingsStore.getState();
      return active && currentSettings.emailNotificationsEnabled &&
        currentAuth.isAuthenticated && !currentAuth.isLoading && currentAuth.activeAccountId === accountId &&
        generateAccountId(jmapClient.username ?? '', jmapClient.serverUrl ?? '') === accountId;
    };
    const rich = current() && !generic && !!accountId && !!payload?.registrationId &&
      useSettingsStore.getState().notificationPreviewsEnabled &&
      await companyPushRegistrationIdActive(accountId, payload.registrationId, true) && current();
    if (current() && !generic && !rich) {
      await Notifications.scheduleNotificationAsync({
        content: { title: 'ZyndMail', body: 'New ZyndPay Mail activity', data: content.data },
        trigger: null,
      }).catch(() => undefined);
    }
    const visible = !!calendar || (current() && (generic || rich));
    return {
      shouldShowBanner: visible,
      shouldShowList: visible,
      shouldPlaySound: visible,
      shouldSetBadge: false,
    };
  },
});
