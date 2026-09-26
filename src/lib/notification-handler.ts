import * as Notifications from 'expo-notifications';
import { CALENDAR_NOTIFICATION_TAG } from './calendar-notifications';
import { companyPushModeActive, companyPushPreviewModeActive, isCompanyPushPresentation, isGenericCompanyPushPresentation } from './company-push';
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
    const currentAuth = useAuthStore.getState();
    const currentSettings = useSettingsStore.getState();
    const mail = eligible && currentSettings.emailNotificationsEnabled &&
      currentAuth.isAuthenticated && !currentAuth.isLoading && currentAuth.activeAccountId === accountId &&
      (generic || currentSettings.notificationPreviewsEnabled);
    const visible = !!calendar || mail;
    return {
      shouldShowBanner: visible,
      shouldShowList: visible,
      shouldPlaySound: visible,
      shouldSetBadge: false,
    };
  },
});
