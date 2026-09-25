import { AppState, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// Tactile feedback helpers. Every call is fire-and-forget and swallows
// errors: haptics are a nicety, never a dependency. Callers outside this
// area (SwipeableRow, destructive confirms) should use these rather than
// importing expo-haptics directly so the "off" switch stays in one place.

export type HapticKind = 'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

let enabled = true;
let lastFeedbackAt = -Infinity;

/** Independent device preference; reduced motion does not disable touch feedback. */
export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

export function haptic(kind: HapticKind = 'light'): void {
  if (!enabled || Platform.OS === 'web' || AppState.currentState !== 'active') return;
  // Nested controls can reach the same action in one frame. Never stack pulses.
  const now = Date.now();
  if (now - lastFeedbackAt < 80) return;
  lastFeedbackAt = now;
  let promise: Promise<void>;
  try {
    if (Platform.OS === 'android') {
      const effect = kind === 'selection' ? Haptics.AndroidHaptics.Segment_Tick
        : kind === 'success' ? Haptics.AndroidHaptics.Confirm
        : kind === 'error' || kind === 'warning' ? Haptics.AndroidHaptics.Reject
        : kind === 'medium' || kind === 'heavy' ? Haptics.AndroidHaptics.Long_Press
        : Haptics.AndroidHaptics.Context_Click;
      void Haptics.performAndroidHapticsAsync(effect).catch(() => undefined);
      return;
    }
    switch (kind) {
      case 'selection':
        promise = Haptics.selectionAsync();
        break;
      case 'medium':
        promise = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'heavy':
        promise = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
      case 'success':
        promise = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'warning':
        promise = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'error':
        promise = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
      case 'light':
      default:
        promise = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
    }
    void promise.catch(() => undefined);
  } catch {
    // native module missing (e.g. web / tests)
  }
}
