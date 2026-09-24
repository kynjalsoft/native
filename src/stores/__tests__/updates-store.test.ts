import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.62' } } }));
vi.mock('../../lib/install-update', () => ({ downloadAndInstallApk: vi.fn() }));
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UPDATE_REPO } from '../../api/updates';
import { useUpdatesStore } from '../updates-store';

describe('update source migration', () => {
  it('keeps the auto-check preference but discards a cached upstream APK', async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem('webmail:updates:v1', JSON.stringify({
      autoCheck: false,
      lastCheckedAt: Date.now(),
      cachedLatest: {
        tag: '99.0.0',
        name: 'Upstream release',
        htmlUrl: 'https://github.com/bulwarkmail/native/releases/tag/99.0.0',
        apkAsset: { name: 'upstream.apk', browser_download_url: 'https://example.com/upstream.apk', size: 1 },
      },
      dismissedTag: null,
      rateLimitedUntil: Date.now() + 60_000,
    }));

    await useUpdatesStore.getState().hydrate();
    const state = useUpdatesStore.getState();
    expect(state.autoCheck).toBe(false);
    expect(state.cachedLatest).toBeNull();
    expect(state.lastCheckedAt).toBe(0);
    expect(state.rateLimitedUntil).toBe(0);
    expect(state.hasUpdate()).toBe(false);
  });

  it('retains an update cached for the configured company repository', async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem('webmail:updates:v1', JSON.stringify({
      releaseRepo: UPDATE_REPO,
      autoCheck: true,
      lastCheckedAt: 123,
      cachedLatest: {
        tag: '99.0.0',
        name: 'Company release',
        htmlUrl: 'https://github.com/kynjalsoft/native/releases/tag/99.0.0',
        apkAsset: { name: 'company.apk', browser_download_url: 'https://example.com/company.apk', size: 1 },
      },
      dismissedTag: null,
      rateLimitedUntil: 0,
    }));

    await useUpdatesStore.getState().hydrate();
    const state = useUpdatesStore.getState();
    expect(state.cachedLatest?.apkAsset?.name).toBe('company.apk');
    expect(state.lastCheckedAt).toBe(123);
    expect(state.releaseRepo).toBe(UPDATE_REPO);
  });
});
