import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAuthStore } from '../../stores/auth-store';
import { useLocaleStore } from '../../stores/locale-store';
import { useColors } from '../../theme/colors';
import { companyPushStatus, registerCompanyPush, revokeCompanyPush, type CompanyPushStatus } from '../../lib/company-push';
import { SettingItem, SettingsSection, ToggleSwitch } from './settings-section';

/** Company push uses the authenticated mail-plane relay, never a user-entered URL. */
export function CompanyPushSettings(): React.ReactElement {
  const colors = useColors();
  const t = useLocaleStore((s) => s.t);
  const accountId = useAuthStore((s) => s.activeAccountId);
  const [status, setStatus] = React.useState<CompanyPushStatus | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let current = true;
    setStatus(null);
    if (accountId) {
      void companyPushStatus(accountId)
        .then((next) => { if (current) setStatus(next); })
        .catch(() => { if (current) setStatus({ status: 'ERROR', reason: 'Mail notification status could not be read.' }); });
    }
    return () => { current = false; };
  }, [accountId]);

  const onChange = async (enabled: boolean) => {
    if (!accountId || busy) return;
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

  const description = status?.status === 'ACTIVE'
    ? t('settings.notifications.company.active', 'This device was registered for private mail alerts. Delivery depends on server and device connectivity.')
    : status?.status === 'UNAVAILABLE' || status?.status === 'ERROR'
      ? status.reason
      : status?.status === 'DENIED'
        ? t('settings.notifications.company.denied', 'Allow notifications for ZyndMail in your device settings.')
        : t('settings.notifications.company.description', 'Get private new-mail alerts on this device.');

  return (
    <SettingsSection title={t('settings.notifications.company.title', 'Company mail alerts')} description={t('settings.notifications.company.section', 'Content-free alerts for authorized personal and shared mailboxes.')}>
      <SettingItem label={t('settings.notifications.company.toggle', 'Push notifications')} description={description}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {busy && <ActivityIndicator size="small" color={colors.primary} />}
          <ToggleSwitch
            checked={status?.status === 'ACTIVE'}
            onChange={(value) => { void onChange(value); }}
            disabled={!accountId || busy || !status || status.status === 'UNAVAILABLE'}
          />
        </View>
      </SettingItem>
      {(status?.status === 'ERROR' || status?.status === 'UNAVAILABLE') && (
        <Text accessibilityRole="alert" style={{ color: colors.textSecondary, paddingVertical: 8 }}>
          {description}
        </Text>
      )}
    </SettingsSection>
  );
}
