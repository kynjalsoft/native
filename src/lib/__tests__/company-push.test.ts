import { beforeEach, describe, expect, it, vi } from 'vitest';

const records = vi.hoisted(() => new Map<string, string>());
const expoToken = vi.hoisted(() => vi.fn(async () => ({ data: 'ExpoPushToken[ABCDEFGHIJKLMNOP1234567890]' })));
const registerChannel = vi.hoisted(() => vi.fn(async () => undefined));
const presented = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const dismiss = vi.hoisted(() => vi.fn(async () => undefined));
const getEmails = vi.hoisted(() => vi.fn(async () => [{ id: 'message', threadId: 'authoritative-thread' }]));
const session = vi.hoisted(() => ({
  username: 'staff@zyndpay.io',
  serverUrl: 'https://mail.zyndpay.io',
  ensureFreshToken: vi.fn(async () => undefined),
  getStoredOAuthTokens: vi.fn(async () => null as unknown),
  getStoredCredentials: vi.fn(async () => null as unknown),
}));

vi.mock('expo-constants', () => ({ default: {
  easConfig: { projectId: 'e9054c93-18de-4d6a-bc34-38c020130b82' },
  expoConfig: { android: { package: 'io.zyndpay.mail' } },
} }));
vi.mock('expo-device', () => ({ isDevice: true }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => records.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { records.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { records.delete(key); }),
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 6,
}));
vi.mock('expo-notifications', () => ({
  getExpoPushTokenAsync: expoToken,
  getPermissionsAsync: vi.fn(async () => ({ granted: true, status: 'granted' })),
  requestPermissionsAsync: vi.fn(async () => ({ granted: true, status: 'granted' })),
  setNotificationChannelAsync: registerChannel,
  getPresentedNotificationsAsync: presented,
  dismissNotificationAsync: dismiss,
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
  AndroidNotificationVisibility: { PRIVATE: 0, PUBLIC: 1 },
}));
vi.mock('../../api/jmap-client', () => ({ jmapClient: session }));
vi.mock('../../api/email', () => ({ getEmails }));

import { isCompanyPushPresentation, isGenericCompanyPushPresentation, parseCompanyPushDestination, companyPushPreviewAvailable, companyPushPreviewModeActive, companyPushPreviewOptOutPending, companyPushRevocationPending, companyPushRelayOrigin, companyPushStatus, parseCompanyPushPayload, reconcileCompanyPush, reconcilePendingCompanyPushRevocation, registerCompanyPush, revokeCompanyPush, resolveCompanyPush } from '../company-push';
import { useSettingsStore } from '../../stores/settings-store';
import { useAccountStore } from '../../stores/account-store';
import { ZYNDMAIL_COMPANY } from '../zyndmail-company';

const accountId = 'staff@zyndpay.io@mail.zyndpay.io';
const jwt = (subject: string) => {
  const payload = { iss: ZYNDMAIL_COMPANY.issuer, aud: ['stalwart'], sub: subject, exp: Date.now() / 1000 + 3600 };
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
};

beforeEach(() => {
  records.clear();
  session.username = 'staff@zyndpay.io';
  session.serverUrl = 'https://mail.zyndpay.io';
  useAccountStore.setState({ accounts: [] });
  useSettingsStore.setState({ hydrated: true, notificationPreviewsEnabled: true, emailNotificationsEnabled: true });
  vi.clearAllMocks();
  process.env.EXPO_PUBLIC_MAIL_PUSH_RELAY_ORIGIN = 'https://mail.zyndpay.io';
  const accessToken = jwt('staff-subject');
  session.getStoredOAuthTokens.mockResolvedValue({
    accessToken, clientId: ZYNDMAIL_COMPANY.clientId,
    companyIdentity: { issuer: ZYNDMAIL_COMPANY.issuer, audience: 'stalwart', subject: 'staff-subject' },
  });
  session.getStoredCredentials.mockResolvedValue({ serverUrl: 'https://mail.zyndpay.io' });
});

describe('company Expo push boundary', () => {
  it('rejects untrusted origins and extra mail content in push data', () => {
    process.env.EXPO_PUBLIC_MAIL_PUSH_RELAY_ORIGIN = 'https://mail.zyndpay.io/other';
    expect(companyPushRelayOrigin()).toBeNull();
    expect(parseCompanyPushPayload({ version: 1, notificationRef: 'a'.repeat(24) })).not.toBeNull();
    expect(parseCompanyPushPayload({ version: 1, notificationRef: 'a'.repeat(24), subject: 'secret' })).toBeNull();
  });

  it('requires opt-in and registers the exact production identity without a mailbox payload', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => ({
      ok: true, status: 200,
      json: async () => url.includes('/v1/push-health?')
        ? { status: 'ok', previewMode: 'sender-subject-snippet-v1' } : { registrationId: 'registration-1' },
      request: init.body ? JSON.parse(init.body as string) : null,
    }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await registerCompanyPush(accountId, false)).toEqual({ status: 'OFF' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    expect(expoToken).toHaveBeenCalledWith({ projectId: 'e9054c93-18de-4d6a-bc34-38c020130b82' });
    expect(registerChannel).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls.find(([, request]) => request.method === 'PUT') as [string, RequestInit];
    expect(url).toBe('https://mail.zyndpay.io/v1/device-registrations/current');
    expect(JSON.parse(init.body as string)).toMatchObject({
      appId: 'io.zyndpay.mail', projectId: 'e9054c93-18de-4d6a-bc34-38c020130b82',
      platform: 'android', environment: 'production', previews: true,
    });
    expect(JSON.stringify(JSON.parse(init.body as string))).not.toMatch(/staff-subject|mailbox|subject/);
    expect(registerChannel).toHaveBeenCalledWith('mail-messages-v2', expect.objectContaining({ importance: 4, lockscreenVisibility: 1, sound: 'default' }));
    useSettingsStore.setState({ notificationPreviewsEnabled: false });
    expect(await registerCompanyPush(accountId, false)).toEqual({ status: 'ACTIVE' });
    const lastPut = fetchMock.mock.calls.filter(([, request]) => request.method === 'PUT').at(-1)!;
    expect(JSON.parse(lastPut[1].body as string).previews).toBe(false);
    presented.mockResolvedValueOnce([{ request: { identifier: 'visible-1', content: {
      data: { version: 1, notificationRef: 'a'.repeat(24) },
    } } }] as never);
    expect(await revokeCompanyPush(accountId)).toBe(true);
    expect(dismiss).toHaveBeenCalledWith('visible-1');
    expect(fetchMock.mock.calls.at(-1)?.[1].method).toBe('DELETE');
  });

  it('keeps generic relays content-free even when an old device preference asks for previews', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => ({
      ok: true, status: 200,
      json: async () => url.includes('/v1/push-health?')
        ? { status: 'ok' } : { registrationId: 'registration-1' },
      request: init.body ? JSON.parse(init.body as string) : null,
    }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await companyPushPreviewAvailable()).toBe(false);
    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    const [, request] = fetchMock.mock.calls.find(([, init]) => init.method === 'PUT')!;
    expect(JSON.parse(request.body as string)).not.toHaveProperty('previews');
    expect(registerChannel).toHaveBeenCalledWith('mail-activity', expect.objectContaining({
      importance: 3, lockscreenVisibility: 0, showBadge: false,
    }));
    expect(registerChannel).not.toHaveBeenCalledWith('mail-messages-v2', expect.anything());
  });

  it('honors the global email notification switch before asking for permission or a token', async () => {
    useSettingsStore.setState({ emailNotificationsEnabled: false });
    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'OFF' });
    expect(expoToken).not.toHaveBeenCalled();
  });

  it('revokes a different staff subject before registering this installation again', async () => {
    const oldId = 'old@zyndpay.io@mail.zyndpay.io';
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'old-subject', registrationId: 'old-registration', renewedAt: Date.now(),
    }));
    useAccountStore.setState({ accounts: [{ id: oldId, serverUrl: 'https://mail.zyndpay.io' } as never] });
    const newTokens = await session.getStoredOAuthTokens() as Record<string, unknown>;
    session.getStoredOAuthTokens.mockImplementation(async (id?: string) => id === oldId ? {
      ...newTokens, accessToken: jwt('old-subject'),
      companyIdentity: { issuer: ZYNDMAIL_COMPANY.issuer, audience: 'stalwart', subject: 'old-subject' },
    } : newTokens);
    session.getStoredCredentials.mockResolvedValue({ serverUrl: 'https://mail.zyndpay.io' });
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/v1/push-health?')) return { ok: true, json: async () => ({ status: 'ok' }) };
      methods.push(init.method ?? 'GET');
      return { ok: true, status: 200, json: async () => ({ registrationId: 'new-registration' }) };
    }));
    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    expect(methods).toEqual(['DELETE', 'PUT']);
  });

  it('force-renews a fresh local registration so a stale server subscription is upgraded', async () => {
    records.set('zyndmail.production.push.preference.v1', 'staff-subject');
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', registrationId: 'registration-1', renewedAt: Date.now(),
      routingVersion: 3, previews: true,
    }));
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => ({
      ok: true, status: 200,
      json: async () => url.includes('/v1/push-health?')
        ? { status: 'ok', previewMode: 'sender-subject-snippet-v1' } : { registrationId: 'registration-1' },
      request: init.body ? JSON.parse(init.body as string) : null,
    }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await registerCompanyPush(accountId, false, true)).toEqual({ status: 'ACTIVE' });
    const registration = fetchMock.mock.calls.find(([, request]) => request.method === 'PUT');
    expect(registration).toBeDefined();
    expect(JSON.parse(registration![1].body as string).previews).toBe(true);
  });

  it('applies a preview opt-out after an in-flight preview registration', async () => {
    let releasePut!: () => void;
    let enteredPut!: () => void;
    const blockedPut = new Promise<void>((resolve) => { releasePut = resolve; });
    const putStarted = new Promise<void>((resolve) => { enteredPut = resolve; });
    const requests: boolean[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/v1/push-health?')) return { ok: true, json: async () => ({ status: 'ok', previewMode: 'sender-subject-snippet-v1' }) };
      if (init.method === 'PUT') {
        requests.push(JSON.parse(init.body as string).previews);
        if (requests.length === 1) { enteredPut(); await blockedPut; }
      }
      return { ok: true, status: 200, json: async () => ({ registrationId: 'registration-1' }) };
    }));

    const first = registerCompanyPush(accountId, true);
    await putStarted;
    useSettingsStore.setState({ notificationPreviewsEnabled: false });
    const second = registerCompanyPush(accountId, false, true);
    releasePut();
    expect(await first).toEqual({ status: 'ACTIVE' });
    expect(await second).toEqual({ status: 'ACTIVE' });
    expect(requests).toEqual([true, false]);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).previews).toBe(false);
  });

  it('keeps opt-out pending through a relay outage and reconciles later', async () => {
    let relayReady = true;
    const requests: boolean[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/v1/push-health?')) return relayReady
        ? { ok: true, json: async () => ({ status: 'ok', previewMode: 'sender-subject-snippet-v1' }) }
        : { ok: false };
      if (init.method === 'PUT') requests.push(JSON.parse(init.body as string).previews);
      return { ok: true, status: 200, json: async () => ({ registrationId: 'registration-1' }) };
    }));

    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    useSettingsStore.setState({ notificationPreviewsEnabled: false });
    relayReady = false;
    expect((await registerCompanyPush(accountId, false, true)).status).toBe('UNAVAILABLE');
    expect(await companyPushStatus(accountId)).toMatchObject({ status: 'PENDING' });
    expect(await companyPushPreviewOptOutPending(accountId)).toBe(true);
    relayReady = true;
    expect(await registerCompanyPush(accountId, false, true)).toEqual({ status: 'ACTIVE' });
    expect(await companyPushStatus(accountId)).toEqual({ status: 'ACTIVE' });
    expect(requests).toEqual([true, false]);
  });

  it('clears foreground preview permission after revoking an in-flight registration', async () => {
    let releasePut!: () => void;
    let enteredPut!: () => void;
    const blockedPut = new Promise<void>((resolve) => { releasePut = resolve; });
    const putStarted = new Promise<void>((resolve) => { enteredPut = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/v1/push-health?')) return { ok: true, json: async () => ({ status: 'ok', previewMode: 'sender-subject-snippet-v1' }) };
      if (init.method === 'PUT') { enteredPut(); await blockedPut; }
      return { ok: true, status: 200, json: async () => ({ registrationId: 'registration-1' }) };
    }));

    const registration = registerCompanyPush(accountId, true);
    await putStarted;
    const revocation = revokeCompanyPush(accountId);
    releasePut();
    expect(await registration).toEqual({ status: 'ACTIVE' });
    expect(await revocation).toBe(true);
    expect(await companyPushPreviewModeActive(accountId)).toBe(false);
    expect(await companyPushStatus(accountId)).toEqual({ status: 'OFF' });
  });

  it('does not report preview reconciliation without an owned rich registration', async () => {
    useSettingsStore.setState({ notificationPreviewsEnabled: false });
    expect(await companyPushPreviewOptOutPending(accountId)).toBe(false);
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'other-subject', registrationId: 'other-registration', renewedAt: Date.now(),
      routingVersion: 3, previews: true,
    }));
    expect(await companyPushPreviewOptOutPending(accountId)).toBe(false);
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', registrationId: 'registration-1', renewedAt: Date.now(),
      routingVersion: 2, previews: false,
    }));
    expect(await companyPushPreviewOptOutPending(accountId)).toBe(false);
  });

  it('keeps the active registration visible when another staff account is removed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => url.includes('/v1/push-health?')
        ? { status: 'ok', previewMode: 'sender-subject-snippet-v1' } : { registrationId: 'registration-1' },
    })));
    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    const activeTokens = await session.getStoredOAuthTokens(accountId) as Record<string, unknown>;
    session.getStoredOAuthTokens.mockImplementation(async (id?: string) => id === 'other-account' ? {
      ...activeTokens,
      accessToken: jwt('other-subject'),
      companyIdentity: { issuer: ZYNDMAIL_COMPANY.issuer, audience: 'stalwart', subject: 'other-subject' },
    } : activeTokens);

    expect(await revokeCompanyPush('other-account')).toBe(true);
    expect(await companyPushPreviewModeActive(accountId)).toBe(true);
    expect(dismiss).not.toHaveBeenCalled();
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).subject).toBe('staff-subject');
  });

  it('presents a previously verified rich registration before renewal and rejects ownership changes', async () => {
    records.set('zyndmail.production.push.preference.v1', 'staff-subject');
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', registrationId: 'registration-1', renewedAt: Date.now(),
      routingVersion: 3, previews: true,
    }));
    expect(await companyPushPreviewModeActive(accountId)).toBe(true);
    expect(await companyPushPreviewModeActive('other-account')).toBe(false);
    useSettingsStore.setState({ notificationPreviewsEnabled: false });
    expect(await companyPushPreviewModeActive(accountId)).toBe(false);
    useSettingsStore.setState({ notificationPreviewsEnabled: true });
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'other-subject', registrationId: 'registration-2', renewedAt: Date.now(),
      routingVersion: 3, previews: true,
    }));
    expect(await companyPushPreviewModeActive(accountId)).toBe(false);
  });

  it('persists failed disable revocation and clears it on retry', async () => {
    let deleteFails = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/v1/push-health?')) return { ok: true, status: 200,
        json: async () => ({ status: 'ok', previewMode: 'sender-subject-snippet-v1' }) };
      if (init.method === 'DELETE') return { ok: !deleteFails, status: deleteFails ? 503 : 200 };
      return { ok: true, status: 200, json: async () => ({ registrationId: 'registration-1' }) };
    }));
    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    useSettingsStore.setState({ emailNotificationsEnabled: false });
    expect(await reconcileCompanyPush(accountId)).toMatchObject({ status: 'REVOKE_PENDING' });
    expect(await companyPushRevocationPending(accountId)).toBe(true);
    expect(await companyPushStatus(accountId)).toMatchObject({ status: 'REVOKE_PENDING' });
    expect(await companyPushPreviewModeActive(accountId)).toBe(false);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBe(true);
    deleteFails = false;
    expect(await reconcileCompanyPush(accountId)).toEqual({ status: 'OFF' });
    expect(await companyPushRevocationPending(accountId)).toBe(false);
    expect(await companyPushStatus(accountId)).toEqual({ status: 'OFF' });
  });

  it('retries pending revocation without staff authorization after switching to a personal account', async () => {
    const revocationKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64url');
    let relayReady = false;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/v1/push-health?')) return { ok: true, status: 200,
        json: async () => ({ status: 'ok', previewMode: 'sender-subject-snippet-v1' }) };
      if (init.method === 'DELETE') return { ok: relayReady, status: relayReady ? 200 : 503 };
      return { ok: true, status: 200, json: async () => ({ registrationId: 'registration-1', revocationKey }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationKey).toBe(revocationKey);
    useSettingsStore.setState({ emailNotificationsEnabled: false });
    expect(await reconcileCompanyPush(accountId)).toMatchObject({ status: 'REVOKE_PENDING' });

    session.username = 'personal@example.com';
    session.serverUrl = 'https://mail.example.com';
    session.getStoredOAuthTokens.mockResolvedValue(null);
    relayReady = true;
    const callsBeforeRecovery = fetchMock.mock.calls.length;
    expect(await reconcilePendingCompanyPushRevocation()).toBe(false);
    const recoveryCalls = fetchMock.mock.calls.slice(callsBeforeRecovery);
    expect(recoveryCalls).toHaveLength(1);
    expect(recoveryCalls[0][1]).toMatchObject({ method: 'DELETE', headers: {
      Accept: 'application/json', 'Content-Type': 'application/json',
    } });
    expect(JSON.parse(recoveryCalls[0][1].body as string)).toEqual({ registrationId: 'registration-1', revocationKey });
    expect(records.has('zyndmail.production.push.registration.v1')).toBe(false);
  });

  it('retries a failed logout revocation after staff credentials are erased', async () => {
    const revocationKey = Buffer.from(Array.from({ length: 32 }, (_, index) => 255 - index)).toString('base64url');
    let relayReady = false;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/v1/push-health?')) return { ok: true, status: 200,
        json: async () => ({ status: 'ok', previewMode: 'sender-subject-snippet-v1' }) };
      if (init.method === 'DELETE') return { ok: relayReady, status: relayReady ? 200 : 503 };
      return { ok: true, status: 200, json: async () => ({ registrationId: 'registration-1', revocationKey }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    expect(await revokeCompanyPush(accountId)).toBe(false);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBe(true);
    session.getStoredOAuthTokens.mockResolvedValue(null);
    session.getStoredCredentials.mockResolvedValue(null);
    session.username = '';
    session.serverUrl = '';
    useAccountStore.setState({ accounts: [] });
    relayReady = true;
    const callsBeforeRecovery = fetchMock.mock.calls.length;
    expect(await reconcilePendingCompanyPushRevocation()).toBe(false);
    const recoveryCalls = fetchMock.mock.calls.slice(callsBeforeRecovery);
    expect(recoveryCalls).toHaveLength(1);
    expect(recoveryCalls[0][1].headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(recoveryCalls[0][1].body as string)).toEqual({ registrationId: 'registration-1', revocationKey });
    expect(records.has('zyndmail.production.push.registration.v1')).toBe(false);
  });

  it('retires a logged-out staff registration before enrolling a different staff account', async () => {
    const oldKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64url');
    const newAccountId = 'other@zyndpay.io@mail.zyndpay.io';
    let relayReady = true;
    const requests: Array<{ method: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/v1/push-health?')) return {
        ok: true, status: 200, json: async () => ({ status: 'ok', previewMode: 'sender-subject-snippet-v1' }),
      };
      const method = init.method ?? 'GET';
      requests.push({ method, body: JSON.parse(init.body as string), headers: init.headers as Record<string, string> });
      if (method === 'DELETE') return { ok: relayReady, status: relayReady ? 200 : 503 };
      return { ok: true, status: 200, json: async () => ({
        registrationId: session.username === 'staff@zyndpay.io' ? 'old-registration' : 'new-registration',
        revocationKey: oldKey,
      }) };
    }));

    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    relayReady = false;
    expect(await revokeCompanyPush(accountId)).toBe(false);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBe(true);

    const newAccessToken = jwt('new-staff-subject');
    session.username = 'other@zyndpay.io';
    session.getStoredOAuthTokens.mockImplementation(async (id?: string) => id === newAccountId ? {
      accessToken: newAccessToken, clientId: ZYNDMAIL_COMPANY.clientId,
      companyIdentity: { issuer: ZYNDMAIL_COMPANY.issuer, audience: 'stalwart', subject: 'new-staff-subject' },
    } : null);
    session.getStoredCredentials.mockImplementation(async (id?: string) => id === newAccountId
      ? { serverUrl: 'https://mail.zyndpay.io' } : null);
    useAccountStore.setState({ accounts: [{ id: newAccountId, serverUrl: 'https://mail.zyndpay.io' } as never] });

    const beforeFailedEnrollment = requests.length;
    expect(await registerCompanyPush(newAccountId, true)).toMatchObject({ status: 'UNAVAILABLE' });
    expect(requests.slice(beforeFailedEnrollment)).toEqual([{
      method: 'DELETE', body: { registrationId: 'old-registration', revocationKey: oldKey },
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    }]);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBe(true);

    relayReady = true;
    const beforeRecoveredEnrollment = requests.length;
    expect(await registerCompanyPush(newAccountId, true)).toEqual({ status: 'ACTIVE' });
    const recovered = requests.slice(beforeRecoveredEnrollment);
    expect(recovered.map((request) => request.method)).toEqual(['DELETE', 'PUT']);
    expect(recovered[0].body).toEqual({ registrationId: 'old-registration', revocationKey: oldKey });
    expect(recovered[0].headers).not.toHaveProperty('Authorization');
    expect(recovered[1].headers.Authorization).toBe(`Bearer ${newAccessToken}`);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!)).toMatchObject({
      subject: 'new-staff-subject', registrationId: 'new-registration',
    });
    expect(await companyPushRevocationPending(newAccountId)).toBe(false);
  });

  it('keeps a keyless legacy revocation pending until its staff owner signs in again', async () => {
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', registrationId: 'legacy-registration', renewedAt: Date.now(),
      revocationPending: true,
    }));
    session.getStoredOAuthTokens.mockResolvedValue(null);
    session.getStoredCredentials.mockResolvedValue(null);
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await reconcilePendingCompanyPushRevocation()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBe(true);

    useAccountStore.setState({ accounts: [{ id: accountId, serverUrl: 'https://mail.zyndpay.io' } as never] });
    session.getStoredOAuthTokens.mockResolvedValue({
      accessToken: jwt('staff-subject'), clientId: ZYNDMAIL_COMPANY.clientId,
      companyIdentity: { issuer: ZYNDMAIL_COMPANY.issuer, audience: 'stalwart', subject: 'staff-subject' },
    });
    session.getStoredCredentials.mockResolvedValue({ serverUrl: 'https://mail.zyndpay.io' });
    expect(await reconcilePendingCompanyPushRevocation()).toBe(false);
    const [, deleteRequest] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(deleteRequest.headers).toHaveProperty('Authorization');
    expect(JSON.parse(deleteRequest.body as string)).toEqual({ registrationId: 'legacy-registration' });
    expect(records.has('zyndmail.production.push.registration.v1')).toBe(false);
  });

  it('does not invite or request notification permission when the production relay redirects to webmail', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('FetchRedirectException: Redirect is not allowed'); });
    vi.stubGlobal('fetch', fetchMock);
    expect(await companyPushStatus(accountId)).toMatchObject({ status: 'UNAVAILABLE' });
    const result = await registerCompanyPush(accountId, true);
    expect(result).toMatchObject({ status: 'UNAVAILABLE' });
    expect('reason' in result ? result.reason : '').not.toContain('FetchRedirectException');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/mail\.zyndpay\.io\/v1\/push-health\?probe=[a-z0-9]+$/), expect.objectContaining({
      method: 'GET', redirect: 'error',
      headers: expect.objectContaining({ 'Cache-Control': 'no-cache' }),
    }));
    expect(expoToken).not.toHaveBeenCalled();
  });

  it('does not expose a native redirect exception if registration redirects after a healthy probe', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/v1/push-health?')) return { ok: true, json: async () => ({ status: 'ok' }) };
      throw new TypeError('FetchRedirectException: Redirect is not allowed');
    }));
    const result = await registerCompanyPush(accountId, true);
    expect(result).toEqual({
      status: 'ERROR', reason: 'Company mail alerts are temporarily unavailable. Please try again later.',
    });
  });

  it('rejects a non-company OAuth client before asking Expo for a token', async () => {
    session.getStoredOAuthTokens.mockResolvedValue({
      accessToken: jwt('staff-subject'), clientId: 'bulwark-webmail',
      companyIdentity: { issuer: ZYNDMAIL_COMPANY.issuer, audience: 'stalwart', subject: 'staff-subject' },
    });
    expect((await registerCompanyPush(accountId, true)).status).toBe('UNAVAILABLE');
    expect(expoToken).not.toHaveBeenCalled();
  });

  it('keeps opt-out local when relay revocation cannot authenticate', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => url.includes('/v1/push-health?')
        ? { status: 'ok' } : { registrationId: 'registration-1' },
    })));
    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    const activeTokens = await session.getStoredOAuthTokens() as Record<string, unknown>;
    session.getStoredOAuthTokens.mockResolvedValueOnce(activeTokens);
    session.getStoredOAuthTokens.mockResolvedValueOnce({
      ...activeTokens,
      accessToken: 'expired-token',
    });
    expect(await revokeCompanyPush(accountId)).toBe(false);
    expect(await registerCompanyPush(accountId, false)).toEqual({ status: 'OFF' });
  });
});


describe('company notification destination', () => {
  it('accepts documented account and message targets and ignores an old thread hint', () => {
    expect(parseCompanyPushDestination({ target: 'ACCOUNT', accountId: 'shared' })).toEqual({ target: 'ACCOUNT', accountId: 'shared' });
    expect(parseCompanyPushDestination({ target: 'MESSAGE', accountId: 'shared', emailId: 'message' })).toEqual({ target: 'MESSAGE', accountId: 'shared', emailId: 'message' });
    expect(parseCompanyPushDestination({ target: 'EMAIL', accountId: 'shared', emailId: 'message', threadId: 'untrusted' })).toEqual({ target: 'MESSAGE', accountId: 'shared', emailId: 'message' });
    expect(parseCompanyPushDestination({ target: 'INBOX' })).toEqual({ target: 'INBOX' });
  });
  it('rejects malformed targets and injected URLs', () => {
    expect(parseCompanyPushDestination({ target: 'EMAIL', accountId: '', emailId: 'id', threadId: 't' })).toBeNull();
    expect(parseCompanyPushDestination({ target: 'INBOX', url: 'https://example.com' })).toBeNull();
    expect(parseCompanyPushDestination(null)).toBeNull();
  });

  it('opens a resolved message using its current server thread, not the relay hint', async () => {
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', registrationId: 'registration-1', renewedAt: Date.now(),
    }));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ target: 'EMAIL', accountId: 'shared', emailId: 'message', threadId: 'stale-thread' }),
    })));
    expect(await resolveCompanyPush(accountId, { version: 1, notificationRef: 'a'.repeat(24) })).toEqual({
      target: 'EMAIL', accountId: 'shared', emailId: 'message', threadId: 'authoritative-thread',
    });
    expect(getEmails).toHaveBeenCalledWith(['message'], 'shared');
  });

  it('opens the new relay MESSAGE target at the exact shared-mailbox message', async () => {
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', registrationId: 'registration-1', renewedAt: Date.now(),
    }));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ target: 'MESSAGE', accountId: 'shared', emailId: 'message' }),
    })));
    expect(await resolveCompanyPush(accountId, { version: 1, notificationRef: 'b'.repeat(24) })).toEqual({
      target: 'EMAIL', accountId: 'shared', emailId: 'message', threadId: 'authoritative-thread',
    });
    expect(getEmails).toHaveBeenCalledWith(['message'], 'shared');
  });
});

describe('mail preview presentation and routing', () => {
  const content = { title: 'Ada Example', body: 'Meeting tomorrow\nPlease bring the notes.',
    data: { version: 1, notificationRef: 'a'.repeat(24) } };
  it('accepts real visible previews and legacy alerts with opaque routing', () => {
    expect(isCompanyPushPresentation(content as never)).toBe(true);
    expect(isCompanyPushPresentation({ ...content, title: 'ZyndMail', body: 'New ZyndPay Mail activity' } as never)).toBe(true);
    expect(isGenericCompanyPushPresentation(content as never)).toBe(false);
    expect(isGenericCompanyPushPresentation({ ...content, title: 'ZyndMail', body: 'New ZyndPay Mail activity' } as never)).toBe(true);
  });
  it('rejects invisible, oversized and malformed notifications', () => {
    for (const patch of [{ title: '' }, { body: ' ' }, { body: 'x'.repeat(726) }, { title: '\u202ehidden' },
      { data: { ...content.data, emailId: 'untrusted' } }]) {
      expect(isCompanyPushPresentation({ ...content, ...patch } as never)).toBe(false);
    }
  });
});
