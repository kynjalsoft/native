import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  fetchLatestRelease,
  resolveApkSha256,
  UPDATE_REPO,
  UpdateRateLimitedError,
  type LatestRelease,
} from '../api/updates';
import { isNewer } from '../lib/version-compare';
import { downloadAndInstallApk, type InstallProgress } from '../lib/install-update';
import { supportsSideloadUpdates } from '../lib/platform-capabilities';

const STORAGE_KEY = 'webmail:updates:v1';
const MIN_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PENDING_APK_INTERVAL_MS = 2 * 60 * 1000;
// After GitHub rate-limits us, stay quiet for a while instead of retrying on
// every launch (the unauthenticated limit resets hourly).
const RATE_LIMIT_BACKOFF_MS = 60 * 60 * 1000;

interface PersistedUpdates {
  releaseRepo: string;
  autoCheck: boolean;
  lastCheckedAt: number;
  cachedLatest: LatestRelease | null;
  dismissedTag: string | null;
  rateLimitedUntil: number;
}

const DEFAULT_PERSISTED: PersistedUpdates = {
  releaseRepo: UPDATE_REPO,
  autoCheck: true,
  lastCheckedAt: 0,
  cachedLatest: null,
  dismissedTag: null,
  rateLimitedUntil: 0,
};

export interface UpdatesState extends PersistedUpdates {
  hydrated: boolean;
  checking: boolean;
  installing: boolean;
  installProgress: InstallProgress | null;
  error: string | null;

  hydrate: () => Promise<void>;
  setAutoCheck: (enabled: boolean) => void;
  checkNow: (opts?: { force?: boolean }) => Promise<void>;
  installLatest: () => Promise<void>;
  dismissCurrent: () => void;
  currentVersion: () => string;
  hasUpdate: () => boolean;
  // Security / deprecated releases cannot be dismissed (webmail parity).
  isMandatory: () => boolean;
}

function persist(state: PersistedUpdates): void {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((err) => {
    console.warn('[updates-store] persist failed', err);
  });
}

function snapshot(s: UpdatesState): PersistedUpdates {
  return {
    releaseRepo: UPDATE_REPO,
    autoCheck: s.autoCheck,
    lastCheckedAt: s.lastCheckedAt,
    cachedLatest: s.cachedLatest,
    dismissedTag: s.dismissedTag,
    rateLimitedUntil: s.rateLimitedUntil,
  };
}

// Releases cached by an older build lack the newer fields.
function normalizeRelease(release: LatestRelease | null | undefined): LatestRelease | null {
  if (!release || typeof release !== 'object' || typeof release.tag !== 'string') return null;
  return {
    ...release,
    sha256Asset: release.sha256Asset ?? null,
    apkSha256: release.apkSha256 ?? null,
    severity: release.severity === 'security' || release.severity === 'deprecated' ? release.severity : 'normal',
    advisoryUrl: release.advisoryUrl ?? null,
  };
}

export const useUpdatesStore = create<UpdatesState>((set, get) => ({
  ...DEFAULT_PERSISTED,
  hydrated: false,
  checking: false,
  installing: false,
  installProgress: null,
  error: null,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedUpdates>;
        // A prior installation may have cached an APK from a different
        // repository. Never display or install it after switching release
        // sources, even before the first successful network check.
        const sameRepo = parsed.releaseRepo === UPDATE_REPO;
        set({
          ...DEFAULT_PERSISTED,
          ...parsed,
          releaseRepo: UPDATE_REPO,
          autoCheck: typeof parsed.autoCheck === 'boolean' ? parsed.autoCheck : DEFAULT_PERSISTED.autoCheck,
          cachedLatest: sameRepo ? normalizeRelease(parsed.cachedLatest) : null,
          lastCheckedAt: sameRepo ? parsed.lastCheckedAt ?? 0 : 0,
          dismissedTag: sameRepo ? parsed.dismissedTag ?? null : null,
          rateLimitedUntil: sameRepo ? parsed.rateLimitedUntil ?? 0 : 0,
          hydrated: true,
        });
        if (!sameRepo) persist(snapshot(get()));
      } else {
        set({ hydrated: true });
      }
    } catch (err) {
      console.warn('[updates-store] hydrate failed', err);
      set({ hydrated: true });
    }
  },

  setAutoCheck: (enabled) => {
    set({ autoCheck: enabled });
    persist(snapshot(get()));
  },

  checkNow: async (opts) => {
    // On platforms without sideloading there is nothing actionable to report,
    // so skip the GitHub round-trip entirely rather than caching a release the
    // user can never install.
    if (!supportsSideloadUpdates) return;
    const s = get();
    if (s.checking) return;
    const now = Date.now();
    if (!opts?.force && now < s.rateLimitedUntil) return;
    const waitingForApk =
      s.cachedLatest != null && !s.cachedLatest.apkAsset && get().hasUpdate();
    const interval = waitingForApk ? PENDING_APK_INTERVAL_MS : MIN_CHECK_INTERVAL_MS;
    if (!opts?.force && now - s.lastCheckedAt < interval) return;
    set({ checking: true, error: null });
    try {
      const latest = await fetchLatestRelease();
      set({ lastCheckedAt: now, cachedLatest: latest, rateLimitedUntil: 0, checking: false });
      persist(snapshot(get()));
    } catch (err) {
      if (err instanceof UpdateRateLimitedError) {
        // Not an error the user can act on: back off quietly and keep
        // whatever we last cached.
        set({ checking: false, rateLimitedUntil: now + RATE_LIMIT_BACKOFF_MS, lastCheckedAt: now });
        persist(snapshot(get()));
        return;
      }
      set({ checking: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  installLatest: async () => {
    if (!supportsSideloadUpdates) return;
    const s = get();
    if (s.installing || !s.cachedLatest?.apkAsset) return;
    set({ installing: true, error: null, installProgress: { phase: 'downloading', progress: 0 } });
    try {
      // The checksum companion is only fetched now, not on every check.
      const expectedSha256 = await resolveApkSha256(s.cachedLatest);
      await downloadAndInstallApk(
        { asset: s.cachedLatest.apkAsset, expectedSha256 },
        (p) => {
          set({ installProgress: p });
        },
      );
      set({ installing: false, installProgress: null });
    } catch (err) {
      set({
        installing: false,
        installProgress: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  dismissCurrent: () => {
    const s = get();
    if (s.isMandatory()) return;
    const tag = s.cachedLatest?.tag ?? null;
    set({ dismissedTag: tag });
    persist(snapshot(get()));
  },

  currentVersion: () => Constants.expoConfig?.version ?? '0.0.0',

  hasUpdate: () => {
    if (!supportsSideloadUpdates) return false;
    const s = get();
    if (!s.cachedLatest) return false;
    const current = Constants.expoConfig?.version ?? '0.0.0';
    return isNewer(s.cachedLatest.tag, current);
  },

  isMandatory: () => {
    const s = get();
    if (!s.hasUpdate() || !s.cachedLatest) return false;
    return s.cachedLatest.severity === 'security' || s.cachedLatest.severity === 'deprecated';
  },
}));
