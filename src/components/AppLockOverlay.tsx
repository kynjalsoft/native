import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LockKeyhole } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../theme/colors';

interface AppLockOverlayProps {
  busy: boolean;
  error: string | null;
  onUnlock: () => void;
  onSignOut: () => void;
}

/** Opaque cover keeps cached messages out of view until device verification. */
export function AppLockOverlay({ busy, error, onUnlock, onSignOut }: AppLockOverlayProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.cover, {
        backgroundColor: c.background,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
      }]}
      accessibilityViewIsModal
    >
      <View style={styles.center}>
        <View style={[styles.icon, { backgroundColor: c.primaryBg }]}>
          <LockKeyhole size={30} color={c.primary} />
        </View>
        <Text style={[styles.title, { color: c.text }]}>Your mailbox is locked</Text>
        <Text style={[styles.description, { color: c.textSecondary }]}>
          Verify with Face ID, Touch ID or your device passcode to continue.
        </Text>
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: c.error }]}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Unlock mailbox"
          disabled={busy}
          onPress={onUnlock}
          style={[styles.unlockButton, { backgroundColor: c.primary, opacity: busy ? 0.65 : 1 }]}
        >
          {busy ? <ActivityIndicator color={c.primaryForeground} /> : (
            <Text style={[styles.unlockText, { color: c.primaryForeground }]}>Unlock mailbox</Text>
          )}
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" onPress={onSignOut} style={styles.signOutButton}>
        <Text style={[styles.signOutText, { color: c.textSecondary }]}>Sign out on this device</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  center: {
    flex: 1,
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 26,
  },
  title: { fontSize: 26, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  description: { fontSize: 16, lineHeight: 24, textAlign: 'center', marginBottom: 28 },
  error: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 18 },
  unlockButton: {
    minHeight: 54,
    width: '100%',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unlockText: { fontSize: 16, fontWeight: '700' },
  signOutButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  signOutText: { fontSize: 14, fontWeight: '600' },
});
