import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Animated, Easing, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Plus, RefreshCw, Trash2, Rss, AlertTriangle } from 'lucide-react-native';
import { formatDistanceToNow } from 'date-fns';
import Button from '../Button';
import { spacing, radius, typography, type ThemePalette } from '../../theme/tokens';
import { useColors } from '../../theme/colors';
import { CALENDAR_COLOR_PALETTE } from '../../lib/calendar-utils';
import {
  DEFAULT_REFRESH_INTERVAL_MINUTES,
  selectAccountSubscriptions,
  useCalendarSubscriptionsStore,
  type CalendarSubscription,
} from '../../stores/calendar-subscriptions-store';
import { jmapClient } from '../../api/jmap-client';
import { SafeAreaModal } from '../SafeAreaModal';

const INTERVAL_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 15, label: '15 min' },
  { minutes: 60, label: '1 h' },
  { minutes: 360, label: '6 h' },
  { minutes: 1440, label: '1 day' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function ICalSubscriptionSheet({ visible, onClose }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const allSubscriptions = useCalendarSubscriptionsStore((s) => s.subscriptions);
  // Only the signed-in account's feeds: a sub created under another account
  // mirrors into a calendar id that doesn't exist (or collides) here.
  const subscriptions = React.useMemo(
    () => selectAccountSubscriptions(allSubscriptions, jmapClient.isConnected ? jmapClient.accountId : null),
    [allSubscriptions],
  );
  const syncing = useCalendarSubscriptionsStore((s) => s.syncing);
  const addSubscription = useCalendarSubscriptionsStore((s) => s.addSubscription);
  const updateSubscription = useCalendarSubscriptionsStore((s) => s.updateSubscription);
  const removeSubscription = useCalendarSubscriptionsStore((s) => s.removeSubscription);
  const syncSubscription = useCalendarSubscriptionsStore((s) => s.syncSubscription);

  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [color, setColor] = React.useState<string>(CALENDAR_COLOR_PALETTE[0]);
  const [interval, setInterval] = React.useState<number>(DEFAULT_REFRESH_INTERVAL_MINUTES);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const startEdit = (sub: CalendarSubscription) => {
    setEditingId(sub.id);
    setName(sub.name);
    setUrl(sub.url);
    setColor(sub.color || CALENDAR_COLOR_PALETTE[0]);
    setInterval(sub.refreshIntervalMinutes ?? DEFAULT_REFRESH_INTERVAL_MINUTES);
    setFormError(null);
  };
  const resetForm = () => {
    setEditingId(null);
    setName('');
    setUrl('');
    setColor(CALENDAR_COLOR_PALETTE[0]);
    setInterval(DEFAULT_REFRESH_INTERVAL_MINUTES);
    setFormError(null);
  };

  const slideY = React.useRef(new Animated.Value(900)).current;
  const overlayOpacity = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (visible) {
      setEditingId(null);
      setName('');
      setUrl('');
      setColor(CALENDAR_COLOR_PALETTE[0]);
      setInterval(DEFAULT_REFRESH_INTERVAL_MINUTES);
      setFormError(null);
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(overlayOpacity, { toValue: 1, duration: 240, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideY, { toValue: 900, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(overlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, slideY, overlayOpacity]);

  const handleSubmit = async () => {
    const n = name.trim();
    const u = url.trim();
    if (!n || !u) {
      setFormError('Enter a name and a feed URL.');
      return;
    }
    if (!/^(https?|webcals?):\/\//i.test(u)) {
      setFormError('URL must start with https://, http://, webcal:// or webcals://');
      return;
    }
    setFormError(null);
    setAdding(true);
    try {
      if (editingId) {
        await updateSubscription(editingId, { name: n, url: u, color, refreshIntervalMinutes: interval });
      } else {
        await addSubscription({ name: n, url: u, color, refreshIntervalMinutes: interval });
      }
      resetForm();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not add subscription.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <SafeAreaModal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'height' : undefined}>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideY }] }]}>
        <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
          <View style={styles.header}>
            <Rss size={20} color={c.text} />
            <Text style={styles.title}>Calendar subscriptions</Text>
            <Pressable onPress={onClose} hitSlop={8} style={styles.close}>
              <X size={20} color={c.text} />
            </Pressable>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
            <Text style={styles.sectionLabel}>{editingId ? 'Edit subscription' : 'Add a feed'}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Name (e.g. Holidays)"
              placeholderTextColor={c.textMuted}
              style={styles.input}
            />
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="https://… or webcal://…"
              placeholderTextColor={c.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
            />
            <View style={styles.colorRow}>
              {CALENDAR_COLOR_PALETTE.map((col) => (
                <Pressable
                  key={col}
                  onPress={() => setColor(col)}
                  style={[
                    styles.colorDot,
                    { backgroundColor: col },
                    color === col && styles.colorDotActive,
                  ]}
                />
              ))}
            </View>
            <Text style={styles.fieldLabel}>Refresh every</Text>
            <View style={styles.intervalRow}>
              {INTERVAL_OPTIONS.map((opt) => {
                const active = interval === opt.minutes;
                return (
                  <Pressable
                    key={opt.minutes}
                    onPress={() => setInterval(opt.minutes)}
                    style={[styles.intervalChip, active && styles.intervalChipActive]}
                  >
                    <Text style={[styles.intervalChipText, active && styles.intervalChipTextActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!!formError && (
              <View style={styles.errorBox}>
                <AlertTriangle size={16} color={c.error} />
                <Text style={styles.errorText}>{formError}</Text>
              </View>
            )}
            <View style={styles.formActions}>
              {editingId && (
                <Button variant="outline" onPress={resetForm} disabled={adding}>
                  Cancel
                </Button>
              )}
              <Button
                onPress={() => { void handleSubmit(); }}
                disabled={adding}
                icon={adding ? <ActivityIndicator size="small" color={c.primaryForeground} /> : <Plus size={16} color={c.primaryForeground} />}
              >
                {adding ? (editingId ? 'Saving…' : 'Subscribing…') : editingId ? 'Save changes' : 'Subscribe'}
              </Button>
            </View>

            {subscriptions.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>Your subscriptions</Text>
                {subscriptions.map((sub) => {
                  const busy = !!syncing[sub.id];
                  return (
                    <View key={sub.id} style={styles.subRow}>
                      <View style={[styles.subSwatch, { backgroundColor: sub.color || c.primary }]} />
                      <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => startEdit(sub)}>
                        <Text style={styles.subName} numberOfLines={1}>{sub.name}</Text>
                        <Text style={styles.subMeta} numberOfLines={1}>
                          {sub.lastError
                            ? sub.lastError
                            : sub.lastSyncAt
                              ? `Synced ${formatDistanceToNow(sub.lastSyncAt, { addSuffix: true })}`
                              : 'Not synced yet'}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => { void syncSubscription(sub.id); }}
                        hitSlop={6}
                        style={styles.subBtn}
                        disabled={busy}
                      >
                        {busy ? (
                          <ActivityIndicator size="small" color={c.textMuted} />
                        ) : (
                          <RefreshCw size={16} color={c.textSecondary} />
                        )}
                      </Pressable>
                      <Pressable
                        onPress={() => { void removeSubscription(sub.id); }}
                        hitSlop={6}
                        style={styles.subBtn}
                      >
                        <Trash2 size={16} color={c.error} />
                      </Pressable>
                    </View>
                  );
                })}
              </>
            )}
          </ScrollView>
          <View style={{ height: insets.bottom }} />
        </SafeAreaView>
      </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaModal>
  );
}

function makeStyles(c: ThemePalette) {
  return StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '88%',
      backgroundColor: c.popover,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderTopWidth: 1,
      borderColor: c.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    title: { flex: 1, ...typography.h3, color: c.text },
    close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
    scroll: { padding: spacing.lg, gap: spacing.sm },
    sectionLabel: { ...typography.bodySemibold, color: c.text, marginBottom: spacing.xs },
    input: {
      ...typography.body,
      color: c.text,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: c.surface,
      marginBottom: spacing.sm,
    },
    colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
    fieldLabel: { ...typography.caption, color: c.textSecondary, marginBottom: spacing.xs },
    intervalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
    intervalChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    intervalChipActive: { backgroundColor: c.primary, borderColor: c.primary },
    intervalChipText: { ...typography.caption, color: c.text },
    intervalChipTextActive: { color: c.primaryForeground },
    formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
    colorDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: 'transparent' },
    colorDotActive: { borderColor: c.text },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.sm,
      backgroundColor: c.errorBg,
      borderWidth: 1,
      borderColor: c.errorBorder,
      marginBottom: spacing.sm,
    },
    errorText: { ...typography.caption, color: c.errorForeground, flex: 1 },
    subRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.borderLight,
    },
    subSwatch: { width: 14, height: 14, borderRadius: 7 },
    subName: { ...typography.body, color: c.text },
    subMeta: { ...typography.caption, color: c.textMuted, marginTop: 1 },
    subBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  });
}
