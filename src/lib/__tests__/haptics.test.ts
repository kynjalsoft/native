import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AppState, Platform } from 'react-native';
import * as ExpoHaptics from 'expo-haptics';

describe('user initiated haptics', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    Object.assign(AppState, { currentState: 'active' });
    Object.assign(Platform, { OS: 'ios' });
  });
  afterEach(() => vi.useRealTimers());
  it('suppresses nested duplicate feedback but allows the next interaction', async () => {
    const { haptic } = await import('../haptics');
    haptic('selection');
    haptic('light');
    expect(ExpoHaptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(ExpoHaptics.impactAsync).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    haptic('light');
    expect(ExpoHaptics.impactAsync).toHaveBeenCalledTimes(1);
  });
  it('honors the device preference and stays silent in background or web', async () => {
    const { haptic, setHapticsEnabled } = await import('../haptics');
    setHapticsEnabled(false);
    haptic('success');
    setHapticsEnabled(true);
    Object.assign(AppState, { currentState: 'background' });
    haptic('success');
    Object.assign(AppState, { currentState: 'inactive' });
    haptic('success');
    Object.assign(AppState, { currentState: 'active' });
    Object.assign(Platform, { OS: 'web' });
    haptic('success');
    expect(ExpoHaptics.notificationAsync).not.toHaveBeenCalled();
    Object.assign(Platform, { OS: 'ios' });
    haptic('success');
    expect(ExpoHaptics.notificationAsync).toHaveBeenCalledWith(ExpoHaptics.NotificationFeedbackType.Success);
  });
  it('uses Android semantic effects instead of vibration emulation', async () => {
    Object.assign(Platform, { OS: 'android' });
    const { haptic } = await import('../haptics');
    haptic('selection');
    expect(ExpoHaptics.performAndroidHapticsAsync).toHaveBeenLastCalledWith(ExpoHaptics.AndroidHaptics.Segment_Tick);
    vi.advanceTimersByTime(100);
    haptic('error');
    expect(ExpoHaptics.performAndroidHapticsAsync).toHaveBeenLastCalledWith(ExpoHaptics.AndroidHaptics.Reject);
    expect(ExpoHaptics.impactAsync).not.toHaveBeenCalled();
  });
  it('does not break an action if the native module rejects', async () => {
    vi.mocked(ExpoHaptics.selectionAsync).mockRejectedValueOnce(new Error('unavailable'));
    const { haptic } = await import('../haptics');
    expect(() => haptic('selection')).not.toThrow();
    await Promise.resolve();
  });
});
