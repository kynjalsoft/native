import React from 'react';
import {
  View,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, X } from 'lucide-react-native';
import { spacing, componentSizes, type ThemePalette } from '../../theme/tokens';
import { useColors } from '../../theme/colors';
import { useLocaleStore } from '../../stores/locale-store';
import AuthDoodleBackground from './AuthDoodleBackground';

interface LoginShellProps {
  children: React.ReactNode;
  /** Renders a back chevron. Omit on the first step of the flow. */
  onBack?: () => void;
  /** Renders a close X on the right — add-account mode only. */
  onClose?: () => void;
}

/**
 * Shared chrome for every sign-in step: safe area, keyboard avoidance, the
 * back/close affordances. Steps supply only their own
 * content so they all sit on the same grid.
 */
export default function LoginShell({
  children,
  onBack,
  onClose,
}: LoginShellProps) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const t = useLocaleStore((s) => s.t);

  return (
    <SafeAreaView style={styles.container}>
      <AuthDoodleBackground />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.header}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('common.back', 'Back')}
              style={styles.headerButton}
            >
              <ArrowLeft size={22} color={c.textSecondary} />
            </Pressable>
          ) : (
            <View style={styles.headerButton} />
          )}
          {onClose ? (
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('common.close', 'Close')}
              style={styles.headerButton}
            >
              <X size={22} color={c.textSecondary} />
            </Pressable>
          ) : (
            <View style={styles.headerButton} />
          )}
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemePalette) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      height: componentSizes.headerHeight,
    },
    headerButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    content: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xxxl,
      width: '100%',
      maxWidth: 520,
      alignSelf: 'center',
    },
  });
}
