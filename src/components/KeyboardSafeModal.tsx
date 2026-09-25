import type React from 'react';
import { KeyboardAvoidingView, Platform, type Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SafeAreaModal } from './SafeAreaModal';

/** Modal-root insets and keyboard movement for forms and action sheets. */
export function KeyboardSafeModal({ children, ...props }: React.ComponentProps<typeof Modal>) {
  return (
    <SafeAreaModal statusBarTranslucent {...props}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {children}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaModal>
  );
}
