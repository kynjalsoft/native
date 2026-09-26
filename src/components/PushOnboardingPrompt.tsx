import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { BellRing, X } from 'lucide-react-native';
import Button from './Button';
import { spacing, radius, typography, type ThemePalette } from '../theme/tokens';
import { useColors } from '../theme/colors';
import { useAuthStore } from '../stores/auth-store';
import { useLocaleStore } from '../stores/locale-store';
import { useSettingsStore } from '../stores/settings-store';
import {
  DEFAULT_RELAY_BASE_URL,
  dismissPushPrompt,
  getEffectiveRelayBaseUrl,
  isPushEnabledForAccount,
  isPushSupported,
  PushSetupError,
  setStoredRelayBaseUrl,
  setupPushNotifications,
  wasPushPromptDismissed,
} from '../lib/push-notifications';
import { isCompanyMailServer } from '../lib/zyndmail-company';
import { companyPushRelayOrigin, companyPushStatus, registerCompanyPush } from '../lib/company-push';

// Mirrors the webmail's push-notification-prompt: a short delay after login
// so the inbox renders first, and never again for an account once dismissed.
const PROMPT_DELAY_MS = 1500;

/**
 * Once-per-account invitation to turn on background notifications. Shown
 * only where a supported push relay is configured, when the
 * user has not disabled mail notifications, and until either "Enable" or
 * "Not now" has been tapped for the active account.
 */
export function PushOnboardingPrompt(): React.ReactElement | null {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const t = useLocaleStore((s) => s.t);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const client = useAuthStore((s) => s.client);
  const activeAccountId = useAuthStore((s) => s.activeAccountId);
  const username = useAuthStore((s) => s.username);
  const emailNotificationsEnabled = useSettingsStore((s) => s.emailNotificationsEnabled);

  const [visible, setVisible] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setVisible(false);
    setError(null);
    if (!isAuthenticated || !client || !activeAccountId || !emailNotificationsEnabled) return;
    const company = isCompanyMailServer(client.serverUrl ?? '');
    if (company ? !companyPushRelayOrigin() : !isPushSupported()) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (await wasPushPromptDismissed(activeAccountId)) return;
        if (company) {
          const status = await companyPushStatus(activeAccountId).catch(() => null);
          if (!status || status.status === 'ACTIVE' || status.status === 'UNAVAILABLE') return;
        } else if (await isPushEnabledForAccount(activeAccountId)) return;
        if (!cancelled) setVisible(true);
      })();
    }, PROMPT_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isAuthenticated, client, activeAccountId, emailNotificationsEnabled]);

  if (!visible || !activeAccountId) return null;

  const handleDismiss = () => {
    setVisible(false);
    void dismissPushPrompt(activeAccountId);
  };

  const handleEnable = async () => {
    setBusy(true);
    setError(null);
    try {
      if (isCompanyMailServer(client?.serverUrl ?? '')) {
        const status = await registerCompanyPush(activeAccountId, true);
        if (status.status !== 'ACTIVE') throw new Error('reason' in status ? status.reason : 'Mail alerts are not active.');
      } else {
        const relayBaseUrl = (await getEffectiveRelayBaseUrl()) || DEFAULT_RELAY_BASE_URL;
        await setStoredRelayBaseUrl(relayBaseUrl);
        await setupPushNotifications({ relayBaseUrl, accountLabel: username ?? undefined });
      }
      await dismissPushPrompt(activeAccountId);
      setVisible(false);
    } catch (err) {
      const message = err instanceof PushSetupError || err instanceof Error
        ? err.message
        : t('settings.notifications.push.setup_failed', 'Setup failed');
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.iconWrap}>
        <BellRing size={18} color={c.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>
          {t('push_prompt.title', 'Get notified about new mail')}
        </Text>
        <Text style={styles.body}>
          {isCompanyMailServer(client?.serverUrl ?? '')
            ? t('push_prompt.company_body', 'Get private new-mail alerts. Message previews can be enabled in notification settings when your mail relay supports them.')
            : t('push_prompt.body', 'Turn on background notifications so new messages reach you while the app is closed.')}
        </Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.actions}>
          <Button size="sm" onPress={() => void handleEnable()} loading={busy}>
            {t('push_prompt.enable', 'Enable')}
          </Button>
          <Button size="sm" variant="ghost" onPress={handleDismiss} disabled={busy}>
            {t('push_prompt.dismiss', 'Not now')}
          </Button>
        </View>
      </View>
      <Pressable
        onPress={handleDismiss}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('settings.notifications.push.dismiss_aria', 'Dismiss notification prompt')}
        style={styles.close}
      >
        <X size={16} color={c.mutedForeground} />
      </Pressable>
    </View>
  );
}

function makeStyles(c: ThemePalette) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
    },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: radius.full,
      backgroundColor: c.primaryBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { ...typography.bodyMedium, color: c.text },
    body: { ...typography.caption, color: c.mutedForeground, marginTop: 2 },
    error: { ...typography.caption, color: c.error, marginTop: spacing.xs },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    close: { padding: 2 },
  });
}
