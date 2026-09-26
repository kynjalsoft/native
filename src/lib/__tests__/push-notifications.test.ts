import { describe, it, expect, vi, beforeEach } from 'vitest';

// Provide the Android native FCM surface setupPushNotifications needs. The
// global test-setup mocks react-native with an empty NativeModules, so override
// it here with a BulwarkFcm module and a pre-33 Platform.Version (which skips
// the runtime permission request).
vi.mock('react-native', () => {
  class NativeEventEmitter {
    addListener() {
      return { remove: () => undefined };
    }
  }
  return {
    Platform: { OS: 'android', Version: 30, select: <T,>(s: { default?: T; android?: T }) => s.android ?? s.default },
    NativeModules: {
      BulwarkFcm: {
        getToken: vi.fn(async () => 'fcm-token-xyz'),
        deleteToken: vi.fn(async () => undefined),
        dismissMailNotifications: vi.fn(async () => undefined),
        disableMailAccount: vi.fn(async () => undefined),
        activateMailAccount: vi.fn(async () => undefined),
      },
    },
    NativeEventEmitter,
    PermissionsAndroid: { RESULTS: { GRANTED: 'granted' }, request: vi.fn(async () => 'granted') },
  };
});

vi.mock('../../api/jmap-client', () => ({
  jmapClient: {
    username: 'user@example.com',
    serverUrl: 'https://mail.example.com',
    accountId: 'jmap-primary',
    currentSession: { capabilities: { 'urn:ietf:params:jmap:core': {} } },
  },
}));

vi.mock('../../api/email', () => ({
  getMailboxes: vi.fn(async () => [
    { id: 'inbox', role: 'inbox', accountId: 'jmap-primary' },
    { id: 'junk', role: 'junk', accountId: 'jmap-primary' },
  ]),
  getSharedMailboxes: vi.fn(async () => []),
}));

vi.mock('../../api/push', () => ({
  listPushSubscriptions: vi.fn(async () => []),
  createPushSubscription: vi.fn(async () => 'new-server-id'),
  verifyPushSubscription: vi.fn(async () => undefined),
  destroyPushSubscription: vi.fn(async () => undefined),
  updatePushSubscription: vi.fn(async () => true),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  setupPushNotifications,
  deviceClientIdKey,
  isValidRelayUrl,
  readPushJmapAccountIds,
  PushSetupError,
  teardownPushNotificationsForAccount,
} from '../push-notifications';
import {
  listPushSubscriptions,
  createPushSubscription,
  destroyPushSubscription,
  updatePushSubscription,
} from '../../api/push';
import { jmapClient } from '../../api/jmap-client';
import { NativeModules } from 'react-native';
import { generateAccountId } from '../account-utils';
import { useAccountStore } from '../../stores/account-store';
import { useSettingsStore } from '../../stores/settings-store';

const OUR_DCID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ACCOUNT_ID = generateAccountId('user@example.com', 'https://mail.example.com');
const RELAY = 'https://relay.example.com';

// State the fake relay reports for each foreign deviceClientId's /active probe.
type RelayState = 'dead' | 'live' | 'unknown';

function installFetch(states: Record<string, RelayState>): void {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/push/register')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
    }
    if (url.includes('/api/push/verify/')) {
      return { ok: true, status: 200, json: async () => ({ verificationCode: 'CODE' }) } as Response;
    }
    const active = url.match(/\/api\/push\/active\/([^/?]+)$/);
    if (active) {
      const dcid = decodeURIComponent(active[1]);
      const state = states[dcid] ?? 'unknown';
      if (state === 'unknown') {
        return { ok: false, status: 404, json: async () => ({ error: 'Unknown subscription' }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ active: state === 'live' }) } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

const destroyMock = destroyPushSubscription as ReturnType<typeof vi.fn>;
const listMock = listPushSubscriptions as ReturnType<typeof vi.fn>;
const createMock = createPushSubscription as ReturnType<typeof vi.fn>;
const updateMock = updatePushSubscription as ReturnType<typeof vi.fn>;
const SUB_KEY = 'push:subscriptionId:v2:' + ACCOUNT_ID;

function sub(id: string, deviceClientId: string) {
  return { id, deviceClientId, expires: new Date(Date.now() + 86400000).toISOString(), types: ['Email'] };
}

describe('setupPushNotifications leftover reaping', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await AsyncStorage.clear();
    // Pin our deviceClientId so we control which leftovers are "ours".
    await AsyncStorage.setItem(deviceClientIdKey(ACCOUNT_ID), OUR_DCID);
  });

  it('reactivates native posting only after valid account setup with email alerts enabled', async () => {
    useAccountStore.setState({ accounts: [{ id: ACCOUNT_ID, serverUrl: 'https://mail.example.com' } as never] });
    useSettingsStore.setState({ hydrated: true, emailNotificationsEnabled: true });
    listMock.mockResolvedValue([]);
    installFetch({});
    try {
      expect((await setupPushNotifications({ relayBaseUrl: RELAY })).verified).toBe(true);
      const native = (NativeModules as { BulwarkFcm: {
        activateMailAccount: ReturnType<typeof vi.fn>;
      } }).BulwarkFcm;
      expect(native.activateMailAccount).toHaveBeenCalledWith(ACCOUNT_ID);
      native.activateMailAccount.mockClear();
      useSettingsStore.setState({ emailNotificationsEnabled: false });
      listMock.mockResolvedValue([sub('new-server-id', OUR_DCID)]);
      expect((await setupPushNotifications({ relayBaseUrl: RELAY })).verified).toBe(true);
      expect(native.activateMailAccount).not.toHaveBeenCalled();
    } finally {
      useAccountStore.setState({ accounts: [], activeAccountId: null });
      useSettingsStore.setState({ hydrated: false, emailNotificationsEnabled: true });
    }
  });

  it('reaps our own and relay-confirmed-dead leftovers, keeps live and unverifiable ones', async () => {
    listMock.mockResolvedValue([
      sub('own-old', OUR_DCID), // our own previous attempt -> reap
      sub('foreign-dead', 'deaddeaddeaddeaddeaddeaddeaddead'), // relay: dead -> reap
      sub('foreign-live', 'livelivelivelivelivelivelivelive'), // relay: live -> keep
      sub('foreign-unknown', 'unknwunknwunknwunknwunknwunknwun'), // relay: 404 -> keep
    ]);
    installFetch({
      deaddeaddeaddeaddeaddeaddeaddead: 'dead',
      livelivelivelivelivelivelivelive: 'live',
      unknwunknwunknwunknwunknwunknwun: 'unknown',
    });

    const result = await setupPushNotifications({ relayBaseUrl: RELAY });

    expect(result.verified).toBe(true);
    const reaped = destroyMock.mock.calls.map((c) => c[0]);
    expect(reaped).toContain('own-old');
    expect(reaped).toContain('foreign-dead');
    expect(reaped).not.toContain('foreign-live');
    expect(reaped).not.toContain('foreign-unknown');
  });

  it('keeps foreign subs when the relay probe fails (network error)', async () => {
    listMock.mockResolvedValue([sub('foreign-x', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')]);
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/push/register')) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      if (url.includes('/api/push/verify/')) {
        return { ok: true, status: 200, json: async () => ({ verificationCode: 'CODE' }) } as Response;
      }
      if (url.includes('/api/push/active/')) throw new Error('network down');
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    await setupPushNotifications({ relayBaseUrl: RELAY });

    expect(destroyMock.mock.calls.map((c) => c[0])).not.toContain('foreign-x');
  });

  it('coalesces concurrent setups into a single flow (no subscription swarm)', async () => {
    listMock.mockResolvedValue([]);
    installFetch({});

    // Fire several overlapping setups, as App.tsx does while auth settles and
    // on FCM token refresh. Only one underlying JMAP subscription must be made.
    const results = await Promise.all([
      setupPushNotifications({ relayBaseUrl: RELAY }),
      setupPushNotifications({ relayBaseUrl: RELAY }),
      setupPushNotifications({ relayBaseUrl: RELAY }),
    ]);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => r.subscriptionId)).size).toBe(1);
  });
});

describe('setupPushNotifications subscription shape', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await AsyncStorage.clear();
    await AsyncStorage.setItem(deviceClientIdKey(ACCOUNT_ID), OUR_DCID);
    (jmapClient as { currentSession: unknown }).currentSession = {
      capabilities: { 'urn:ietf:params:jmap:core': {} },
    };
    listMock.mockResolvedValue([]);
    updateMock.mockResolvedValue(true);
    installFetch({});
  });

  it('subscribes to EmailDelivery only', async () => {
    await setupPushNotifications({ relayBaseUrl: RELAY });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].types).toEqual(['EmailDelivery']);
    expect(createMock.mock.calls[0][0].emailPush).toBeUndefined();
  });

  it('records the JMAP account id so pushes can be routed per account', async () => {
    await setupPushNotifications({ relayBaseUrl: RELAY });
    expect(await readPushJmapAccountIds()).toEqual({ [ACCOUNT_ID]: 'jmap-primary' });
  });

  it('adds a junk-excluding emailPush filter when the server advertises emailpush', async () => {
    (jmapClient as { currentSession: unknown }).currentSession = {
      capabilities: { 'urn:ietf:params:jmap:emailpush': {} },
    };
    await setupPushNotifications({ relayBaseUrl: RELAY });
    const emailPush = createMock.mock.calls[0][0].emailPush;
    expect(emailPush['jmap-primary']).toEqual({
      filter: {
        operator: 'AND',
        conditions: [{ notKeyword: '$junk' }, { inMailboxOtherThan: ['junk'] }],
      },
      properties: ['id', 'threadId'],
      urgency: 'high',
    });
  });

  it('patches types on an existing subscription that still listens to Email/Mailbox', async () => {
    await AsyncStorage.setItem(SUB_KEY, 'existing');
    listMock.mockResolvedValue([
      { id: 'existing', deviceClientId: OUR_DCID, expires: new Date(Date.now() + 80 * 86400000).toISOString(), types: ['Email', 'EmailDelivery', 'Mailbox'] },
    ]);
    const result = await setupPushNotifications({ relayBaseUrl: RELAY });
    expect(result.subscriptionId).toBe('existing');
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][1].types).toEqual(['EmailDelivery']);
  });

  it('leaves a healthy subscription alone', async () => {
    await AsyncStorage.setItem(SUB_KEY, 'existing');
    listMock.mockResolvedValue([
      { id: 'existing', deviceClientId: OUR_DCID, expires: new Date(Date.now() + 80 * 86400000).toISOString(), types: ['EmailDelivery'] },
    ]);
    await setupPushNotifications({ relayBaseUrl: RELAY });
    expect(updateMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('forceRecreate destroys the recorded subscription and creates a new one', async () => {
    await AsyncStorage.setItem(SUB_KEY, 'existing');
    listMock.mockResolvedValue([
      { id: 'existing', deviceClientId: OUR_DCID, expires: new Date(Date.now() + 80 * 86400000).toISOString(), types: ['EmailDelivery'] },
    ]);
    const result = await setupPushNotifications({ relayBaseUrl: RELAY, forceRecreate: true });
    expect(destroyMock.mock.calls.map((c) => c[0])).toContain('existing');
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(result.subscriptionId).toBe('new-server-id');
  });

  it('rejects plain-http relay URLs', async () => {
    await expect(setupPushNotifications({ relayBaseUrl: 'http://relay.example.com' })).rejects.toMatchObject({ phase: 'relay' });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('surfaces the relay error body and phase when registration fails', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'Invalid fcmToken' }),
    })) as unknown as typeof fetch;
    const err = await setupPushNotifications({ relayBaseUrl: RELAY }).catch((e) => e);
    expect(err).toBeInstanceOf(PushSetupError);
    expect(err.phase).toBe('relay');
    expect(err.message).toContain('Invalid fcmToken');
  });

  it('tags a Firebase token failure with the token phase', async () => {
    const native = (NativeModules as { BulwarkFcm: { getToken: ReturnType<typeof vi.fn> } }).BulwarkFcm;
    native.getToken.mockRejectedValueOnce(new Error('SERVICE_NOT_AVAILABLE'));
    const err = await setupPushNotifications({ relayBaseUrl: RELAY }).catch((e) => e);
    expect(err.phase).toBe('token');
    expect(err.message).toContain('SERVICE_NOT_AVAILABLE');
  });
});

describe('teardownPushNotificationsForAccount', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await AsyncStorage.clear();
    installFetch({});
  });

  it('destroys every server subscription for this device but keeps the FCM token', async () => {
    await AsyncStorage.setItem(deviceClientIdKey(ACCOUNT_ID), OUR_DCID);
    await AsyncStorage.setItem(SUB_KEY, 'recorded');
    await AsyncStorage.setItem('push:relayBaseUrl:v1', RELAY);
    listMock.mockResolvedValue([
      sub('recorded', OUR_DCID),
      sub('untracked', OUR_DCID),
      sub('foreign', 'ffffffffffffffffffffffffffffffff'),
    ]);
    await teardownPushNotificationsForAccount(ACCOUNT_ID);
    const destroyed = destroyMock.mock.calls.map((c) => c[0]);
    expect(destroyed).toContain('recorded');
    expect(destroyed).toContain('untracked');
    expect(destroyed).not.toContain('foreign');
    const native = (NativeModules as { BulwarkFcm: {
      deleteToken: ReturnType<typeof vi.fn>;
      dismissMailNotifications: ReturnType<typeof vi.fn>;
      disableMailAccount: ReturnType<typeof vi.fn>;
    } }).BulwarkFcm;
    expect(native.deleteToken).not.toHaveBeenCalled();
    expect(native.disableMailAccount).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(native.dismissMailNotifications).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(await AsyncStorage.getItem(SUB_KEY)).toBeNull();
  });

  it('closes native posting before dismissing account cards', async () => {
    const native = (NativeModules as { BulwarkFcm: {
      disableMailAccount: ReturnType<typeof vi.fn>;
      dismissMailNotifications: ReturnType<typeof vi.fn>;
    } }).BulwarkFcm;
    let release!: () => void;
    native.disableMailAccount.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const teardown = teardownPushNotificationsForAccount(ACCOUNT_ID);
    await vi.waitFor(() => expect(native.disableMailAccount).toHaveBeenCalledWith(ACCOUNT_ID));
    expect(native.dismissMailNotifications).not.toHaveBeenCalled();
    release();
    await teardown;
    expect(native.dismissMailNotifications).toHaveBeenCalledWith(ACCOUNT_ID);
  });
});

describe('isValidRelayUrl', () => {
  it('requires https except for loopback development hosts', () => {
    expect(isValidRelayUrl('https://relay.example.com')).toBe(true);
    expect(isValidRelayUrl('https://relay.example.com/')).toBe(true);
    expect(isValidRelayUrl('http://relay.example.com')).toBe(false);
    expect(isValidRelayUrl('http://localhost:3003')).toBe(true);
    expect(isValidRelayUrl('http://10.0.2.2:3003')).toBe(true);
    expect(isValidRelayUrl('relay.example.com')).toBe(false);
    expect(isValidRelayUrl('')).toBe(false);
  });
});
