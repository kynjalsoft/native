import React from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { useSettingsStore } from '../../stores/settings-store';
import { useAuthStore } from '../../stores/auth-store';
import { useLocaleStore } from '../../stores/locale-store';
import { useColors } from '../../theme/colors';
import { companyPushPreviewAvailable, companyPushStatus, dismissCompanyPushNotifications, registerCompanyPush, revokeCompanyPush, type CompanyPushStatus } from '../../lib/company-push';
import { SettingItem, SettingsSection, ToggleSwitch } from './settings-section';

/** Company push uses the authenticated mail-plane relay, never a user-entered URL. */
export function CompanyPushSettings(): React.ReactElement {
  const colors = useColors();
  const t = useLocaleStore((s) => s.t);
  const accountId = useAuthStore((s) => s.activeAccountId);
  const emailEnabled = useSettingsStore((s) => s.emailNotificationsEnabled);
  const previews = useSettingsStore((s) => s.notificationPreviewsEnabled);
  const [previewAvailable, setPreviewAvailable] = React.useState(false);
  const [status, setStatus] = React.useState<CompanyPushStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const statusRequest = React.useRef(0);

  React.useEffect(() => {
    let current = true;
    setStatus(null);
    const refresh = () => {
      if (!accountId) return;
      const request = ++statusRequest.current;
      void (async () => {
        const supportsPreviews = await companyPushPreviewAvailable();
        let next = await companyPushStatus(accountId);
        // Opening Notifications is an explicit opportunity to repair a stale
        // local registration. Do not show ACTIVE until the relay has accepted
        // the current preview preference for this device.
        if (next.status === 'ACTIVE') next = await registerCompanyPush(accountId, false, true);
        if (current && request === statusRequest.current) {
          setPreviewAvailable(supportsPreviews);
          setStatus(next);
        }
      })()
        .catch(() => { if (current && request === statusRequest.current) setStatus({ status: 'ERROR', reason: 'Mail notification status could not be read.' }); });
    };
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => { current = false; statusRequest.current += 1; subscription.remove(); };
  }, [accountId, emailEnabled]);

  const onChange = async (enabled: boolean) => {
    if (!accountId || busy || !emailEnabled) return;
    statusRequest.current += 1;
    setBusy(true);
    try {
      if (enabled) setStatus(await registerCompanyPush(accountId, true));
      else setStatus(await revokeCompanyPush(accountId)
        ? { status: 'OFF' }
        : { status: 'ERROR', reason: 'The relay could not revoke this device. Try again before switching staff accounts.' });
    } catch (error) {
      setStatus({ status: 'ERROR', reason: error instanceof Error ? error.message : 'Mail notification setup failed.' });
    } finally {
      setBusy(false);
    }
  };

  const changePreviews = async (enabled: boolean) => {
    if (!accountId || busy || !emailEnabled || !previewAvailable) return;
    setBusy(true);
    statusRequest.current += 1;
    useSettingsStore.getState().updateSetting('notificationPreviewsEnabled', enabled);
    try {
      const result = await registerCompanyPush(accountId, false, true);
      if (result.status !== 'ACTIVE' && result.status !== 'OFF') {
        useSettingsStore.getState().updateSetting('notificationPreviewsEnabled', previews);
      }
      if (!enabled) await dismissCompanyPushNotifications();
      setStatus(result);
    } catch {
      useSettingsStore.getState().updateSetting('notificationPreviewsEnabled', previews);
      setStatus({ status: 'ERROR', reason: 'Preview preference could not be applied. Please try again.' });
    } finally { setBusy(false); }
  };

  const description = !emailEnabled
    ? t('settings.notifications.company.email_disabled', 'Turn on Email notifications above to enable company mail alerts.')
    : status?.status === 'ACTIVE'
    ? t('settings.notifications.company.active', 'This device was registered for private mail alerts. Delivery depends on server and device connectivity.')
    : status?.status === 'UNAVAILABLE' || status?.status === 'ERROR'
      ? status.reason
      : status?.status === 'DENIED'
        ? t('settings.notifications.company.denied', 'Allow notifications for ZyndMail in your device settings.')
        : t('settings.notifications.company.description', 'Get private new-mail alerts on this device.');

  return (
    <SettingsSection title={t('settings.notifications.company.title', 'Company mail alerts')} description={t('settings.notifications.company.section', 'New-mail alerts for authorized personal and shared mailboxes.')}>
      <SettingItem label={t('settings.notifications.company.toggle', 'Push notifications')} description={description}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {busy && <ActivityIndicator size="small" color={colors.primary} />}
          <ToggleSwitch
            checked={emailEnabled && status?.status === 'ACTIVE'}
            onChange={(value) => { void onChange(value); }}
            disabled={!accountId || busy || !status || !emailEnabled}
          />
        </View>
      </SettingItem>
      <SettingItem label={t('settings.notifications.company.previews', 'Show message previews')}
        description={previewAvailable
          ? t('settings.notifications.company.previews_description', 'Show sender, subject and a short snippet. This text passes through Expo and may appear on your lock screen, subject to your device settings. Turn off for generic alerts.')
          : t('settings.notifications.company.previews_unavailable', 'This mail relay currently supports generic alerts only. Message previews require an approved relay update.')}>
        <ToggleSwitch checked={previews && previewAvailable} disabled={busy || !accountId || !status || !emailEnabled || !previewAvailable}
          onChange={(value) => { void changePreviews(value); }} />
      </SettingItem>
    </SettingsSection>
  );
}
