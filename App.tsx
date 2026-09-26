import React from 'react';
import { ActivityIndicator, Alert, AppState, Linking, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as Updates from 'expo-updates';
import * as LocalAuthentication from 'expo-local-authentication';
import { useColorScheme } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { Mail, Calendar, BookUser, HardDrive, Settings } from 'lucide-react-native';

import { startLiveUpdates, type LiveUpdatesHandle } from './src/api/push-stream';
import { jmapClient } from './src/api/jmap-client';
import type { StateChange } from './src/api/types';
import { dispatchStateChange } from './src/lib/state-change-bus';
import { sweepStaleExportFiles } from './src/lib/email-export';
import { useFilterStore } from './src/stores/filter-store';
import { useVacationStore } from './src/stores/vacation-store';
import {
  addMessageListener,
  addNotificationTapListener,
  addTokenRefreshListener,
  getInitialNotificationTap,
  getStoredRelayBaseUrl,
  setupPushNotifications,
  teardownPushNotificationsForAccount,
  type NotificationTapPayload,
} from './src/lib/push-notifications';
import type { MainTabsParamList, RootStackParamList } from './src/navigation/types';
import ComposeScreen from './src/screens/ComposeScreen';
import EmailThreadScreen from './src/screens/EmailThreadScreen';
import EmailSourceScreen from './src/screens/EmailSourceScreen';
import LoginScreen from './src/screens/LoginScreen';
import EmailListScreen from './src/screens/EmailListScreen';
import FilesScreen from './src/screens/FilesScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import ContactsScreen from './src/screens/ContactsScreen';
import ContactDetailScreen from './src/screens/ContactDetailScreen';
import ContactFormScreen from './src/screens/ContactFormScreen';
import GroupDetailScreen from './src/screens/GroupDetailScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ScheduledScreen from './src/screens/ScheduledScreen';
import UnifiedInboxScreen from './src/screens/UnifiedInboxScreen';
import { useAccountStore } from './src/stores/account-store';
import { useAuthStore } from './src/stores/auth-store';
import { useCalendarStore } from './src/stores/calendar-store';
import { useContactsStore } from './src/stores/contacts-store';
import { useEmailStore } from './src/stores/email-store';
import { useHasCalendar, useHasContacts, useHasFiles } from './src/lib/capabilities';
import { useSettingsStore } from './src/stores/settings-store';
import { haptic, setHapticsEnabled } from './src/lib/haptics';
import { useLocaleStore } from './src/stores/locale-store';
import { useNetworkStore } from './src/stores/network-store';
import { useUpdatesStore } from './src/stores/updates-store';
import { UpdateBanner } from './src/components/UpdateBanner';
import { ToastHost } from './src/components/ToastHost';
import { AdaptiveGlassSurface } from './src/components/AdaptiveGlassSurface';
import { AppLockOverlay } from './src/components/AppLockOverlay';
import { getEmails } from './src/api/email';
import { handleDeepLink, parseDeepLink, shareToDeepLink, type DeepLink } from './src/navigation/linking';
import { addShareListener, getInitialShare, shareAttachments } from './src/lib/share-intent';
import { OfflineCacheBanner } from './src/components/OfflineCacheBanner';
import { useOfflineCacheStore } from './src/stores/offline-cache-store';
import { useOutboxStore } from './src/stores/outbox-store';
import { useSendUndoStore } from './src/stores/send-undo-store';
import { runOfflineSync } from './src/lib/offline-sync';
import { spacing, typography, type ThemePalette } from './src/theme/tokens';
import { useColors } from './src/theme/colors';
import { isCompanyMailServer } from './src/lib/zyndmail-company';
import { canAutoReloadMailUpdate } from './src/lib/auto-ota';
import { AppUnlockGate, shouldHideMailForAppState, requiresMailboxUnlock } from './src/lib/app-unlock-gate';
import {
  isCompanyPushPresentation,
  registerCompanyPush,
  registeredCompanyPushAccountId,
  resolveCompanyPush,
  revokeCompanyPush,
} from './src/lib/company-push';
import { openCompanyPushIntent } from './src/lib/company-push-intent';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabsParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

async function navigateToNotificationTap(
  payload: NotificationTapPayload, stillReady: () => boolean,
): Promise<'opened' | 'retry' | 'ignored'> {
  if (!navigationRef.isReady() || !stillReady()) return 'retry';
  // Older notifications lack an account identity. Opening one against a
  // different currently active account can show the wrong conversation.
  if (!payload.accountId) return 'ignored';
  const target = useAccountStore.getState().getAccountById(payload.accountId);
  if (!target || isCompanyMailServer(target.serverUrl)) return 'ignored';

  // The notification carries the account it was generated for. If the user
  // has since switched to a different account (or had a different one active
  // when the notification arrived), opening EmailThread under the active
  // account would fetch the email from the wrong server and fail.
  const auth = useAuthStore.getState();
  if (payload.accountId && payload.accountId !== auth.activeAccountId) {
    try { await auth.switchAccount(payload.accountId); } catch { return 'retry'; }
    if (useAuthStore.getState().activeAccountId !== payload.accountId) return 'retry';
  }

  if (!navigationRef.isReady() || !stillReady()) return 'retry';
  try {
    if (payload.emailId && payload.threadId) {
      let email;
      try {
        [email] = await getEmails([payload.emailId], payload.jmapAccountId);
      } catch {
        return 'retry';
      }
      if (!navigationRef.isReady() || !stillReady()) return 'retry';
      if (!email) {
        navigationRef.navigate('UnifiedInbox');
        Alert.alert(
          useLocaleStore.getState().t('error'),
          useLocaleStore.getState().t(
            'notification_link_unavailable',
            'This notification cannot open a single email. Search your inbox to find the message.',
          ),
        );
        return 'opened';
      }
      navigationRef.navigate('EmailThread', {
        emailId: email.id,
        threadId: email.threadId,
        subject: email.subject ?? payload.subject,
        jmapAccountId: payload.jmapAccountId,
        emailIds: [email.id],
      });
    } else if (!payload.emailId && !payload.threadId) {
      navigationRef.navigate('UnifiedInbox');
    } else {
      return 'ignored';
    }
    return 'opened';
  } catch {
    return 'retry';
  }
}

  // Deep links (zyndmail://, webmail https permalinks, mailto:) and
// Android share-sheet payloads all end up here once the navigator is ready.
async function openDeepLink(link: DeepLink): Promise<void> {
  await handleDeepLink(link, {
    navigation: navigationRef,
    resolveThreadId: async (emailId) => {
      try {
        const [email] = await getEmails([emailId]);
        return email?.threadId ?? null;
      } catch {
        return null;
      }
    },
    switchAccount: async (accountId) => {
      const auth = useAuthStore.getState();
      if (auth.activeAccountId === accountId) return true;
      if (!useAccountStore.getState().getAccountById(accountId)) return false;
      await auth.switchAccount(accountId);
      return useAuthStore.getState().activeAccountId === accountId;
    },
  });
}

function LoadingScreen({ message }: { message: string }) {
  const c = useColors();
  return (
    <View style={[styles.loadingContainer, { backgroundColor: c.background }]}>
      <ActivityIndicator color={c.primary} />
      <Text style={[styles.loadingText, { color: c.textSecondary }]}>{message}</Text>
    </View>
  );
}

function MainTabsNavigator({ navigation, onMailListBusyChange }: NativeStackScreenProps<RootStackParamList, 'MainTabs'> & {
  onMailListBusyChange: (busy: boolean) => void;
}) {
  const c = useColors();
  const t = useLocaleStore((state) => state.t);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const companyMailOnly = isCompanyMailServer(serverUrl ?? '') || jmapClient.hasCompanyNoDeletePolicy;
  const mailboxes = useEmailStore((state) => state.mailboxes);
  const logout = useAuthStore((state) => state.logout);
  const inboxUnreadCount = mailboxes.find((mailbox) => mailbox.role === 'inbox')?.unreadEmails ?? 0;
  const hasCalendar = useHasCalendar();
  const hasContacts = useHasContacts();
  const hasFiles = useHasFiles();
  const disabledTabStyle = { opacity: 0.4 } as const;
  const explainUnavailable = (feature: string) => Alert.alert(
    t('navigation.feature_unavailable.title', '{feature} is unavailable', { feature }),
    t('navigation.feature_unavailable.body', 'This server or account does not offer {feature}. Contact your workspace administrator if you need access.', { feature }),
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <UpdateBanner />
      <OfflineCacheBanner />
      <ToastHost />
    <Tab.Navigator
      screenListeners={({ navigation: tabNavigation, route }) => ({
        tabPress: () => {
          const available = route.name !== 'Calendar' || hasCalendar;
          const contactsAvailable = route.name !== 'Contacts' || hasContacts;
          const filesAvailable = route.name !== 'Files' || hasFiles;
          if (available && contactsAvailable && filesAvailable && !tabNavigation.isFocused()) haptic('selection');
        },
      })}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.text,
        tabBarInactiveTintColor: c.textSecondary,
        tabBarStyle: {
          backgroundColor: 'transparent',
          borderTopColor: c.border,
          borderTopWidth: 1,
          elevation: 0,
          shadowOpacity: 0,
          shadowColor: 'transparent',
        },
        tabBarBackground: () => <AdaptiveGlassSurface style={{ flex: 1 }} fallbackColor={c.background} />,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
        },
      }}
    >
      <Tab.Screen
        name="Mail"
        options={{
          tabBarIcon: ({ color, size }) => <Mail size={size} color={color} />,
          tabBarBadge: inboxUnreadCount > 0 ? (inboxUnreadCount > 99 ? '99+' : inboxUnreadCount) : undefined,
          tabBarBadgeStyle: {
            backgroundColor: c.error,
            color: c.primaryForeground,
            fontSize: 10,
            fontWeight: '700',
            minWidth: 16,
            height: 16,
            lineHeight: 16,
            borderRadius: 8,
            top: -2,
            right: -6,
          },
        }}
      >
        {() => (
          <EmailListScreen
            onInteractionStateChange={onMailListBusyChange}
            onComposePress={() => navigation.navigate('Compose')}
            onEmailPress={(email) => {
              navigation.navigate('EmailThread', {
                emailId: email.id,
                threadId: email.threadId,
                subject: email.subject,
              });
            }}
          />
        )}
      </Tab.Screen>
      {!companyMailOnly && <Tab.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Calendar size={size} color={color} />,
          tabBarItemStyle: hasCalendar ? undefined : disabledTabStyle,
          tabBarAccessibilityLabel: hasCalendar ? 'Calendar' : 'Calendar (unavailable)',
        }}
        listeners={{
          tabPress: (e) => {
            if (!hasCalendar) { e.preventDefault(); explainUnavailable(t('sidebar.calendar', 'Calendar')); }
          },
        }}
      />}
      {!companyMailOnly && <Tab.Screen
        name="Contacts"
        component={ContactsScreen}
        options={{
          tabBarIcon: ({ color, size }) => <BookUser size={size} color={color} />,
          tabBarItemStyle: hasContacts ? undefined : disabledTabStyle,
          tabBarAccessibilityLabel: hasContacts ? 'Contacts' : 'Contacts (unavailable)',
        }}
        listeners={{
          tabPress: (e) => {
            if (!hasContacts) { e.preventDefault(); explainUnavailable(t('sidebar.contacts', 'Contacts')); }
          },
        }}
      />}
      {!companyMailOnly && <Tab.Screen
        name="Files"
        component={FilesScreen}
        options={{
          tabBarIcon: ({ color, size }) => <HardDrive size={size} color={color} />,
          tabBarItemStyle: hasFiles ? undefined : disabledTabStyle,
          tabBarAccessibilityLabel: hasFiles ? 'Files' : 'Files (unavailable)',
        }}
        listeners={{
          tabPress: (e) => {
            if (!hasFiles) { e.preventDefault(); explainUnavailable(t('sidebar.files', 'Files')); }
          },
        }}
      />}
      <Tab.Screen
        name="Settings"
        options={{
          tabBarIcon: ({ color, size }) => <Settings size={size} color={color} />,
        }}
      >
        {() => <SettingsScreen onLogout={logout} />}
      </Tab.Screen>
    </Tab.Navigator>
    </View>
  );
}

function AppContent() {
  const { isUpdatePending } = Updates.useUpdates();
  const hasRestoredSession = useAuthStore((state) => state.hasRestoredSession);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isAuthenticating = useAuthStore((state) => state.isLoading);
  const client = useAuthStore((state) => state.client);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const outboxFlushing = useOutboxStore((state) => state.flushing);
  const sendUndoPending = useSendUndoStore((state) => state.pending != null || state.busy);
  const [appIsActive, setAppIsActive] = React.useState(AppState.currentState === 'active');
  const [privacyHidden, setPrivacyHidden] = React.useState(shouldHideMailForAppState(AppState.currentState));
  const [gateLocked, setAppLocked] = React.useState(true);
  const lockEnabled = useSettingsStore((state) => state.appLockEnabled);
  const settingsHydrated = useSettingsStore((state) => state.hydrated);
  const appLocked = requiresMailboxUnlock(settingsHydrated, lockEnabled, gateLocked);
  const [unlockBusy, setUnlockBusy] = React.useState(false);
  const [unlockError, setUnlockError] = React.useState<string | null>(null);
  const unlockInFlight = React.useRef(false);
  const updateReloadInFlight = React.useRef(false);
  const [updateReloading, setUpdateReloading] = React.useState(false);
  const unlockGate = React.useRef(new AppUnlockGate());
  React.useEffect(() => {
    // Invalidate prior verification when the user changes the lock preference.
    unlockGate.current.cancel();
    setAppLocked(true);
    setUnlockError(null);
  }, [lockEnabled]);
  const [routeName, setRouteName] = React.useState<string | null>(null);
  const [navigationReady, setNavigationReady] = React.useState(false);
  const [mailListBusy, setMailListBusy] = React.useState(true);
  const lastForegroundCheck = React.useRef(0);
  const lastReloadAttempt = React.useRef(0);

  // Resolve the user's theme preference to a concrete light/dark style for the
  // system status bar. The rest of the app's colors are still hard-coded dark
  // until the StyleSheet migration to a theme-aware `useColors` hook lands.
  const themePref = useSettingsStore((state) => state.theme);
  const hapticsEnabled = useSettingsStore((state) => state.hapticsEnabled);
  React.useEffect(() => { setHapticsEnabled(hapticsEnabled); }, [hapticsEnabled]);
  const systemScheme = useColorScheme();
  const resolvedScheme: 'light' | 'dark' =
    themePref === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : themePref;
  const statusBarStyle: 'light' | 'dark' = resolvedScheme === 'light' ? 'dark' : 'light';
  const appColors = useColors();
  // Persisted active account is the signal that the user was already signed
  // in on the previous launch. When present we render the main UI with the
  // cached mail list instead of the "Restoring session" spinner; the real
  // JMAP session comes up in the background.
  const hasPersistedAccount = useAccountStore((state) => state.activeAccountId != null);
  const accounts = useAccountStore((state) => state.accounts);
  const activeAccountId = useAuthStore((state) => state.activeAccountId);
  const [accountRegistryHydrated, setAccountRegistryHydrated] = React.useState(
    () => useAccountStore.persist.hasHydrated(),
  );
  const appLockedRef = React.useRef(appLocked);
  appLockedRef.current = appLocked;
  const pendingCompanyPushResponses = React.useRef<Notifications.NotificationResponse[]>([]);
  const pendingAndroidPushTap = React.useRef<NotificationTapPayload | null>(null);
  const processingAndroidPushTap = React.useRef(false);
  const androidPushRetryCount = React.useRef(0);
  const [pendingAndroidPushRevision, setPendingAndroidPushRevision] = React.useState(0);
  const handledCompanyPushResponses = React.useRef(new Set<string>());
  const processingCompanyPush = React.useRef(false);
  const companyPushRetryCount = React.useRef(0);
  const [pendingCompanyPushRevision, setPendingCompanyPushRevision] = React.useState(0);
  React.useEffect(() => {
    if (useAccountStore.persist.hasHydrated()) {
      setAccountRegistryHydrated(true);
      return;
    }
    return useAccountStore.persist.onFinishHydration(() => setAccountRegistryHydrated(true));
  }, []);
  React.useEffect(() => {
    if (!isAuthenticated) setNavigationReady(false);
  }, [isAuthenticated]);

  const unlockMailbox = React.useCallback(async () => {
    if (!useSettingsStore.getState().appLockEnabled || unlockInFlight.current || updateReloadInFlight.current || AppState.currentState !== 'active') return;
    unlockInFlight.current = true;
    setUnlockBusy(true);
    setUnlockError(null);
    const epoch = unlockGate.current.begin();
    try {
      const enrolledLevel = await LocalAuthentication.getEnrolledLevelAsync();
      if (enrolledLevel === LocalAuthentication.SecurityLevel.NONE) {
        setUnlockError('Set up a device passcode, Face ID or Touch ID in your device settings to unlock this mailbox.');
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock ZyndMail',
        cancelLabel: 'Cancel',
        fallbackLabel: 'Use device passcode',
        disableDeviceFallback: false,
        biometricsSecurityLevel: 'strong',
      });
      if (!result.success) {
        if (result.error !== 'user_cancel' && result.error !== 'system_cancel') {
          setUnlockError('Device verification was not completed. Please try again.');
        }
        return;
      }
      if (unlockGate.current.verified(epoch, AppState.currentState)) setAppLocked(false);
    } catch (error) {
      setUnlockError(error instanceof Error ? error.message : 'Device verification is unavailable.');
    } finally {
      unlockInFlight.current = false;
      setUnlockBusy(false);
    }
  }, []);

  React.useEffect(() => {
    if (hasRestoredSession && !isAuthenticated) {
      unlockGate.current.cancel();
      setAppLocked(true);
    }
  }, [hasRestoredSession, isAuthenticated]);

  const confirmSignOut = React.useCallback(() => {
    Alert.alert(
      'Sign out on this device?',
      'Local cached mail and unsent offline changes on this device will be removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => {
          unlockGate.current.cancel();
          void useAuthStore.getState().logoutAll();
        } },
      ],
    );
  }, []);

  React.useEffect(() => {
    if (!hasRestoredSession) {
      void restoreSession();
    }
  }, [hasRestoredSession, restoreSession]);

  React.useEffect(() => {
    void useSettingsStore.getState().hydrate();
    void useLocaleStore.getState().hydrate();
    return useNetworkStore.getState().init();
  }, []);

  // When the network flips back on while we're authenticated-but-offline
  // (no live JMAP session), retry the session so the user lands back on
  // live data without needing to relaunch.
  React.useEffect(() => {
    if (!isAuthenticated) return;
    return useNetworkStore.subscribe((state, prev) => {
      if (state.online && !prev.online && !useAuthStore.getState().session) {
        void useAuthStore.getState().retrySession();
      }
    });
  }, [isAuthenticated]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const store = useUpdatesStore.getState();
      await store.hydrate();
      if (cancelled) return;
      if (useUpdatesStore.getState().autoCheck) {
        await useUpdatesStore.getState().checkNow();
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Offline mail cache: hydrate the cache index on launch, and kick off a
  // background sync once we have a live JMAP session and the user has the
  // feature enabled. Re-runs whenever the user changes the days window.
  const offlineCacheEnabled = useSettingsStore((s) => s.offlineCacheEnabled);
  const offlineCacheDays = useSettingsStore((s) => s.offlineCacheDays);
  const offlineCacheMaxMB = useSettingsStore((s) => s.offlineCacheMaxMB);
  const haveLiveSession = useAuthStore((s) => s.session != null);
  React.useEffect(() => {
    // Native startup already checks for updates. Check again when returning
    // from the background, without making a network request on every focus.
    const subscription = AppState.addEventListener('change', (state) => {
      setAppIsActive(state === 'active');
      setPrivacyHidden(shouldHideMailForAppState(state));
      if (state === 'background') {
        unlockGate.current.background();
        setUnlockError(null);
      } else if (state === 'active') {
        unlockGate.current.active();
        setAppLocked(unlockGate.current.isLocked);
      }
      if (state !== 'active' || !Updates.isEnabled || __DEV__ ||
          !useNetworkStore.getState().online ||
          Date.now() - lastForegroundCheck.current < 15 * 60_000) return;
      lastForegroundCheck.current = Date.now();
      void Updates.checkForUpdateAsync()
        .then(async (result) => { if (result.isAvailable) await Updates.fetchUpdateAsync(); })
        .catch((error) => console.warn('[updates] foreground check failed', error));
    });
    return () => subscription.remove();
  }, []);

  React.useEffect(() => {
    if (!Updates.isEnabled || __DEV__ || !isUpdatePending ||
        unlockInFlight.current || updateReloadInFlight.current ||
        !canAutoReloadMailUpdate({
          appIsActive, appLocked, lockEnabled, unlockBusy, routeName, authRestored: hasRestoredSession,
          authenticated: isAuthenticated, authenticating: isAuthenticating,
          liveSession: haveLiveSession, outboxFlushing, sendUndoPending, mailListBusy,
        }) || Date.now() - lastReloadAttempt.current < 5 * 60_000) return;
    lastReloadAttempt.current = Date.now();
    updateReloadInFlight.current = true;
    setUpdateReloading(true);
    void Updates.reloadAsync().catch((error) => {
      updateReloadInFlight.current = false;
      setUpdateReloading(false);
      console.warn('[updates] idle reload failed', error);
    });
  }, [appIsActive, appLocked, lockEnabled, unlockBusy, routeName, hasRestoredSession, isAuthenticated,
    isAuthenticating, haveLiveSession, outboxFlushing, sendUndoPending, mailListBusy, isUpdatePending]);
  React.useEffect(() => {
    void useOfflineCacheStore.getState().hydrate();
    // Attachments shared out of the app linger in the cache dir; drop the
    // ones older than a day so a granted content URI can't read them forever.
    void sweepStaleExportFiles();
  }, []);
  React.useEffect(() => {
    if (!offlineCacheEnabled || !haveLiveSession) return;
    // Slight delay so cold start doesn't compete with the inbox load.
    const t = setTimeout(() => {
      void runOfflineSync({ days: offlineCacheDays, maxMB: offlineCacheMaxMB });
    }, 2000);
    return () => clearTimeout(t);
  }, [offlineCacheEnabled, offlineCacheDays, offlineCacheMaxMB, haveLiveSession]);

  // Drain the offline action queue (outbox) as soon as we have a live session,
  // and again whenever the network comes back. The flush itself no-ops when
  // there's nothing queued or the client isn't ready.
  React.useEffect(() => {
    if (!haveLiveSession) return;
    void useOutboxStore.getState().flush();
    return useNetworkStore.subscribe((state, prev) => {
      if (state.online && !prev.online) void useOutboxStore.getState().flush();
    });
  }, [haveLiveSession]);

  // Foreground FCM messages: the Kotlin service skips the headless task while
  // the app is visible, so feed the relay's StateChange straight into the
  // stores. SSE normally beats it, but this covers the window where the SSE
  // socket is down and the poll fallback has not fired yet.
  React.useEffect(() => {
    const unsubscribe = addMessageListener((payload) => {
      const raw = payload?.data?.changed;
      if (!raw) return;
      try {
        const changed = JSON.parse(raw) as Record<string, Record<string, string>>;
        if (!changed || typeof changed !== 'object') return;
        void useEmailStore.getState().handleStateChange({ '@type': 'StateChange', changed });
      } catch {
        // malformed payload - ignore
      }
    });
    return unsubscribe;
  }, []);

  // Capture native Android taps before auth or navigation is ready. The
  // native initial-intent getter clears its slot, so keep our own pending copy
  // until the account is restored and the optional app lock is open.
  React.useEffect(() => {
    let cancelled = false;
    const capture = (payload: NotificationTapPayload | null) => {
      if (!payload || cancelled) return;
      pendingAndroidPushTap.current = payload;
      androidPushRetryCount.current = 0;
      setPendingAndroidPushRevision((revision) => revision + 1);
    };
    void (async () => {
      const initial = await getInitialNotificationTap();
      if (!pendingAndroidPushTap.current) capture(initial);
    })();
    const unsubscribe = addNotificationTapListener(capture);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  React.useEffect(() => {
    const payload = pendingAndroidPushTap.current;
    if (!payload || !isAuthenticated || appLocked || !accountRegistryHydrated ||
        !navigationReady || !navigationRef.isReady() || processingAndroidPushTap.current) return;
    processingAndroidPushTap.current = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let live = true;
    void navigateToNotificationTap(payload, () => live && !appLockedRef.current &&
      useAuthStore.getState().isAuthenticated && pendingAndroidPushTap.current === payload).then((result) => {
      if (!live) return;
      if (pendingAndroidPushTap.current !== payload) return;
      if (result === 'opened' || result === 'ignored') {
        pendingAndroidPushTap.current = null;
        androidPushRetryCount.current = 0;
      } else {
        const attempts = ++androidPushRetryCount.current;
        if (attempts <= 4) retryTimer = setTimeout(() => {
          setPendingAndroidPushRevision((revision) => revision + 1);
        }, [1_000, 3_000, 10_000, 30_000][attempts - 1]);
        else Alert.alert(
          useLocaleStore.getState().t('error'),
          useLocaleStore.getState().t(
            'notification_open_retry',
            'ZyndMail could not verify this email link. Check your connection, then tap the notification again.',
          ),
        );
      }
    }).finally(() => {
      processingAndroidPushTap.current = false;
      if (pendingAndroidPushTap.current && (!live || pendingAndroidPushTap.current !== payload)) {
        setPendingAndroidPushRevision((revision) => revision + 1);
      }
    });
    return () => { live = false; if (retryTimer) clearTimeout(retryTimer); };
  }, [pendingAndroidPushRevision, isAuthenticated, appLocked, accountRegistryHydrated,
    navigationReady, activeAccountId]);

  // Deep links and share-sheet payloads. The cold-start URL / share is read
  // once auth is restored so the target screen has credentials.
  React.useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const open = (link: DeepLink | null) => {
      if (!link || cancelled) return;
      // Give the navigator a tick to mount after the auth gate flips.
      setTimeout(() => { void openDeepLink(link); }, 50);
    };
    void Linking.getInitialURL().then((url) => open(url ? parseDeepLink(url) : null));
    void getInitialShare().then((share) => {
      if (!share) return;
      const link = shareToDeepLink(share);
      if (link.kind === 'compose' && share.uris?.length) {
        navigationRef.isReady() && navigationRef.navigate('Compose', {
          prefillTo: link.to,
          prefillSubject: link.subject,
          prefillBody: link.body,
          prefillAttachments: shareAttachments(share),
        });
        return;
      }
      open(link);
    });
    const urlSub = Linking.addEventListener('url', ({ url }) => open(parseDeepLink(url)));
    const shareSub = addShareListener((share) => {
      const link = shareToDeepLink(share);
      if (link.kind === 'compose' && share.uris?.length && navigationRef.isReady()) {
        navigationRef.navigate('Compose', {
          prefillTo: link.to,
          prefillSubject: link.subject,
          prefillBody: link.body,
          prefillAttachments: shareAttachments(share),
        });
        return;
      }
      open(link);
    });
    return () => {
      cancelled = true;
      urlSub.remove();
      shareSub();
    };
  }, [isAuthenticated]);

  // Re-register the device with the configured relay once authenticated,
  // and whenever the FCM token rotates. Honours the user's notification
  // preference - flipping it off tears down THIS account's subscription so
  // notifications stop arriving for it. Other logged-in accounts keep their
  // setups intact.
  const emailNotificationsEnabled = useSettingsStore(
    (s) => s.emailNotificationsEnabled,
  );
  React.useEffect(() => {
    if (!isAuthenticated || !client) return;
    if (isCompanyMailServer(client.serverUrl ?? '')) return;

    let cancelled = false;
    const doSetup = async () => {
      if (!emailNotificationsEnabled) {
        if (activeAccountId) {
          await teardownPushNotificationsForAccount(activeAccountId).catch(
            () => undefined,
          );
        }
        return;
      }
      const relayBaseUrl = await getStoredRelayBaseUrl();
      if (!relayBaseUrl) return;
      try {
        await setupPushNotifications({
          relayBaseUrl,
          accountLabel: client.username ?? undefined,
        });
        if (cancelled) return;
      } catch (error) {
        console.warn(
          '[push] relay setup failed:',
          error instanceof Error ? error.message : error,
        );
      }
    };

    void doSetup();
    const unsubscribe = addTokenRefreshListener(() => {
      void doSetup();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, isAuthenticated, emailNotificationsEnabled, activeAccountId]);

  // The company relay owns its JMAP subscription. The fork must never also
  // register the same company mailbox with Bulwark's public FCM relay.
  React.useEffect(() => {
    if (!isAuthenticated || !client || !activeAccountId || !isCompanyMailServer(client.serverUrl ?? '')) return;
    if (!emailNotificationsEnabled) {
      void revokeCompanyPush(activeAccountId).catch(() => undefined);
      return;
    }
    const refresh = (force = false) => { void registerCompanyPush(activeAccountId, false, force); };
    // Reconcile the server on every cold start. A local cache can say that
    // previews are enabled while Stalwart still has an older generic
    // subscription (for example after an OTA or a relay-side migration).
    // The relay's PUT is idempotent for an unchanged mode and renews its lease.
    refresh(true);
    const stateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh(true);
    });
    const tokenSubscription = Notifications.addPushTokenListener(() => refresh(true));
    const nativeTokenSubscription = addTokenRefreshListener(() => refresh(true));
    return () => {
      stateSubscription.remove();
      tokenSubscription.remove();
      nativeTokenSubscription();
    };
  }, [client, isAuthenticated, activeAccountId, emailNotificationsEnabled]);

  // Capture notification taps independently of auth and the optional app
  // lock. Expo retains the cold-start response until it is explicitly cleared,
  // while this queue covers taps received before session restoration ends.
  React.useEffect(() => {
    const capture = (response: Notifications.NotificationResponse | null) => {
      if (!response || !isCompanyPushPresentation(response.notification.request.content)) return;
      const identifier = response.notification.request.identifier;
      if (handledCompanyPushResponses.current.has(identifier)) return;
      const pending = pendingCompanyPushResponses.current;
      if (!pending.some((item) => item.notification.request.identifier === identifier)) {
        pending.push(response);
        if (pending.length > 10) pending.shift();
      }
      // A user can tap again after a transient resolve failure. Keep the tap
      // actionable even when Expo re-delivers the same response identifier.
      companyPushRetryCount.current = 0;
      setPendingCompanyPushRevision((revision) => revision + 1);
    };
    void Notifications.getLastNotificationResponseAsync().then(capture).catch(() => undefined);
    const listener = Notifications.addNotificationResponseReceivedListener(capture);
    return () => listener.remove();
  }, []);

  // Resolve only after account storage, auth, unlock, and navigation are ready.
  // Relay failures retain the tap and retry, instead of clearing Expo's saved
  // response or leaving the user on an unrelated screen.
  React.useEffect(() => {
    const response = pendingCompanyPushResponses.current[0];
    if (!response || !isAuthenticated || appLocked || !accountRegistryHydrated ||
        !navigationReady || !navigationRef.isReady() || processingCompanyPush.current) return;

    processingCompanyPush.current = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const identifier = response.notification.request.identifier;
    void openCompanyPushIntent({
      response,
      readReadiness: () => ({
        authenticated: useAuthStore.getState().isAuthenticated,
        locked: appLockedRef.current,
        accountRegistryHydrated: useAccountStore.persist.hasHydrated(),
        navigationReady: navigationRef.isReady(),
        activeAccountId: useAuthStore.getState().activeAccountId,
        accounts: useAccountStore.getState().accounts,
      }),
      isCompanyMailServer,
      isCompanyPushPresentation: (content) =>
        isCompanyPushPresentation(content as Notifications.NotificationContent),
      registeredCompanyAccountId: registeredCompanyPushAccountId,
      switchAccount: (accountId) => useAuthStore.getState().switchAccount(accountId),
      resolveDestination: resolveCompanyPush,
      navigateToEmail: (destination) => navigationRef.navigate('EmailThread', {
        emailId: destination.emailId,
        threadId: destination.threadId,
        jmapAccountId: destination.accountId,
        emailIds: [destination.emailId],
      }),
      navigateToInbox: () => navigationRef.navigate('UnifiedInbox'),
      showInboxFallback: () => Alert.alert(
        useLocaleStore.getState().t('error'),
        useLocaleStore.getState().t(
          'notification_link_unavailable',
          'This notification cannot open a single email. Search your inbox to find the message.',
        ),
      ),
      clearLastNotificationResponse: Notifications.clearLastNotificationResponseAsync,
    }).then((result) => {
      if (result === 'opened' || result === 'ignored') {
        handledCompanyPushResponses.current.add(identifier);
        if (handledCompanyPushResponses.current.size > 30) {
          const oldest = handledCompanyPushResponses.current.values().next().value;
          if (oldest) handledCompanyPushResponses.current.delete(oldest);
        }
        pendingCompanyPushResponses.current = pendingCompanyPushResponses.current
          .filter((item) => item.notification.request.identifier !== identifier);
        companyPushRetryCount.current = 0;
        setPendingCompanyPushRevision((revision) => revision + 1);
      } else if (result === 'retry') {
        const attempts = ++companyPushRetryCount.current;
        if (attempts <= 4) {
          retryTimer = setTimeout(() => {
            setPendingCompanyPushRevision((revision) => revision + 1);
          }, [1_000, 3_000, 10_000, 30_000][attempts - 1]);
        } else {
          companyPushRetryCount.current = 0;
          Alert.alert(
            useLocaleStore.getState().t('error'),
            useLocaleStore.getState().t(
              'notification_open_retry',
              'ZyndMail could not verify this email link. Check your connection, then tap the notification again.',
            ),
          );
        }
      }
    }).finally(() => {
      processingCompanyPush.current = false;
    });

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [pendingCompanyPushRevision, isAuthenticated, appLocked, accountRegistryHydrated,
    navigationReady, accounts, activeAccountId, appIsActive]);

  // Live updates (SSE with polling fallback), re-armed on every account
  // switch and every re-established session — the singleton `client` object
  // never changes identity, so it cannot be the dependency on its own.
  // Backgrounding closes the stream (no socket + server pings while the app
  // is asleep); foregrounding reconnects it and refreshes what the user is
  // looking at, since events that happened in between are gone for good.
  React.useEffect(() => {
    if (!isAuthenticated || !client || !haveLiveSession) {
      return;
    }

    let mounted = true;
    let handle: LiveUpdatesHandle | null = null;
    let appActive = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';

    const onStateChange = async (change: StateChange) => {
      // Filters / vacation edited elsewhere (webmail, another device): refetch
      // so the settings panes don't save stale state over the newer script.
      const primary = (() => { try { return jmapClient.accountId; } catch { return null; } })();
      const own = primary ? change.changed?.[primary] : undefined;
      const extra: Promise<unknown>[] = [];
      if (own?.SieveScript) extra.push(useFilterStore.getState().fetchFilters().catch(() => undefined));
      if (own?.VacationResponse) extra.push(useVacationStore.getState().fetch().catch(() => undefined));
      dispatchStateChange(change);
      await Promise.all([
        useEmailStore.getState().handleStateChange(change),
        useContactsStore.getState().handleStateChange(change),
        useCalendarStore.getState().handleStateChange(change),
        ...extra,
      ]);
    };

    const start = async () => {
      try {
        const next = await startLiveUpdates({
          onStateChange: (change) => { void onStateChange(change); },
          onError: (error) => { console.warn('[push]', error.message); },
          onFallback: (reason) => { console.warn('[push] falling back to polling:', reason); },
          isActive: () => appActive,
        });
        if (!mounted) {
          next.close();
          return;
        }
        handle = next;
      } catch (error) {
        console.warn(error instanceof Error ? error.message : 'Failed to start JMAP push updates');
      }
    };

    const refreshAfterResume = () => {
      const email = useEmailStore.getState();
      void email.fetchMailboxes();
      if (email.currentMailboxId) void email.refreshEmails();
      void useOutboxStore.getState().flush();
    };

    void start();

    const subscription = AppState.addEventListener('change', (state) => {
      const nowActive = state === 'active';
      if (nowActive === appActive) return;
      appActive = nowActive;
      if (!nowActive) {
        handle?.close();
        handle = null;
        return;
      }
      // Coming back: verify the session is still alive before trusting the
      // stream, then reconnect and catch up on what was missed.
      void (async () => {
        const alive = await jmapClient.ping().catch(() => false);
        if (!mounted) return;
        if (!alive && useNetworkStore.getState().online) {
          const ok = await useAuthStore.getState().retrySession().catch(() => false);
          if (!ok || !mounted) return;
        }
        if (!handle) await start();
        else handle.reconnect();
        refreshAfterResume();
      })();
    });

    // Reconnect when the network comes back while foregrounded.
    const unsubscribeNetwork = useNetworkStore.subscribe((state, prev) => {
      if (state.online && !prev.online && appActive) {
        if (handle) handle.reconnect();
        else void start();
      }
    });

    return () => {
      mounted = false;
      subscription.remove();
      unsubscribeNetwork();
      handle?.close();
      handle = null;
    };
  }, [client, isAuthenticated, haveLiveSession, activeAccountId]);

  // Foreground keep-alive: a `Core/echo` every 30 s tells us when the server
  // is unreachable even though the device is online (NetInfo cannot), and
  // drives the per-account connection dot.
  React.useEffect(() => {
    if (!isAuthenticated || !haveLiveSession || !activeAccountId) return;
    let cancelled = false;
    let failures = 0;
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (!useNetworkStore.getState().online) return;
      void jmapClient.ping().then((ok) => {
        if (cancelled) return;
        failures = ok ? 0 : failures + 1;
        const account = useAccountStore.getState().getAccountById(activeAccountId);
        if (!account) return;
        // One missed echo can be a blip; two in a row is a lost connection.
        const connected = failures < 2;
        if (account.isConnected !== connected) {
          useAccountStore.getState().updateAccount(activeAccountId, { isConnected: connected });
        }
      }).catch(() => undefined);
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAuthenticated, haveLiveSession, activeAccountId]);

  // Skip the "Restoring session" flash for returning users: if we already
  // have a persisted active account, render the main UI immediately with
  // whatever the email-store hydrated from cache. restoreSession still runs
  // in the background and swaps in fresh data once it completes.
  if (!settingsHydrated || (!hasRestoredSession && !hasPersistedAccount)) {
    return (
      <>
        <StatusBar style={statusBarStyle} />
        <LoadingScreen message="Loading..." />
      </>
    );
  }

  if (hasRestoredSession && !isAuthenticated) {
    return (
      <>
        <StatusBar style={statusBarStyle} />
        <LoginScreen />
      </>
    );
  }

  return (
    <View style={{ flex: 1 }}>
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        setNavigationReady(true);
        setRouteName(navigationRef.getCurrentRoute()?.name ?? null);
      }}
      onStateChange={() => setRouteName(navigationRef.getCurrentRoute()?.name ?? null)}
    >
      <StatusBar style={statusBarStyle} />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="MainTabs">
          {(props) => <MainTabsNavigator {...props} onMailListBusyChange={setMailListBusy} />}
        </Stack.Screen>
        <Stack.Screen name="EmailThread" component={EmailThreadScreen} />
        <Stack.Screen name="EmailSource" component={EmailSourceScreen} />
        <Stack.Screen
          name="Compose"
          component={ComposeScreen}
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen name="ContactDetail" component={ContactDetailScreen} />
        <Stack.Screen
          name="ContactForm"
          component={ContactFormScreen}
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen name="GroupDetail" component={GroupDetailScreen} />
        <Stack.Screen name="Scheduled" component={ScheduledScreen} />
        <Stack.Screen name="UnifiedInbox" component={UnifiedInboxScreen} />
        <Stack.Screen
          name="AddAccount"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        >
          {({ navigation }) => (
            <LoginScreen
              isAddMode
              onCancel={() => navigation.goBack()}
              onLogin={() => navigation.goBack()}
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
    {appLocked ? <AppLockOverlay
      busy={unlockBusy || updateReloading}
      updating={updateReloading}
      error={unlockError}
      onUnlock={() => { void unlockMailbox(); }}
      onSignOut={confirmSignOut}
    /> : null}
    {privacyHidden ? <View
      accessible={false}
      style={[styles.privacyCover, { backgroundColor: appColors.background }]}
    /> : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  privacyCover: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 101 },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    ...typography.body,
  },
});
