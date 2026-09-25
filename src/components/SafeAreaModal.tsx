import type React from 'react';
import { Modal } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';

// A native Modal has its own view root, so screen-level safe-area values can
// place a full-height drawer header beneath the status bar.
export function SafeAreaModal({ children, ...props }: React.ComponentProps<typeof Modal>) {
  return (
    <Modal {...props}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        {children}
      </SafeAreaProvider>
    </Modal>
  );
}
