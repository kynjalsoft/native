import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';

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

import { isCompanyPushPresentation, isGenericCompanyPushPresentation, parseCompanyPushDestination, companyPushModeActive, companyPushPreviewAvailable, companyPushPreviewModeActive, companyPushPreviewOptOutPending, companyPushRevocationPending, companyPushRelayOrigin, companyPushStatus, parseCompanyPushPayload, reconcileCompanyPush, reconcileDisabledCompanyPush, reconcilePendingCompanyPushRevocation, registerCompanyPush, registeredCompanyPushAccountId, revokeCompanyPush, revokeEvictedCompanyPush, resolveCompanyPush } from '../company-push';
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

  it('rejects generic relay enrollment while previews are enabled', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => ({
      ok: true, status: 200,
      json: async () => url.includes('/v1/push-health?')
        ? { status: 'ok' } : { registrationId: 'registration-1' },
      request: init.body ? JSON.parse(init.body as string) : null,
    }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await companyPushPreviewAvailable()).toBe(false);
    expect(await registerCompanyPush(accountId, true)).toMatchObject({ status: 'UNAVAILABLE' });
    expect(fetchMock.mock.calls.some(([, init]) => init.method === 'PUT')).toBe(false);
    useSettingsStore.setState({ notificationPreviewsEnabled: false });
    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    const [, request] = fetchMock.mock.calls.find(([, init]) => init.method === 'PUT')!;
    expect(JSON.parse(request.body as string)).not.toHaveProperty('previews');
    expect(registerChannel).toHaveBeenCalledWith('mail-activity', expect.objectContaining({
      importance: 3, lockscreenVisibility: 0, showBadge: false,
    }));
    expect(registerChannel).not.toHaveBeenCalledWith('mail-messages-v2', expect.anything());
    useSettingsStore.setState({ notificationPreviewsEnabled: true });
    expect(await companyPushStatus(accountId)).toMatchObject({ status: 'UNAVAILABLE' });
  });

  it('stops generic foreground presentation after push opt-out and while revocation is pending', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/v1/push-health?')) return { ok: true, status: 200,
        json: async () => ({ status: 'ok' }) };
      if (init.method === 'DELETE') return { ok: false, status: 503 };
      return { ok: true, status: 200, json: async () => ({ registrationId: 'registration-1' }) };
    }));

    useSettingsStore.setState({ notificationPreviewsEnabled: false });
    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    expect(await companyPushModeActive(accountId)).toBe(true);
    records.delete('zyndmail.production.push.preference.v1');
    expect(await companyPushModeActive(accountId)).toBe(false);
    records.set('zyndmail.production.push.preference.v1', 'staff-subject');
    expect(await revokeCompanyPush(accountId)).toBe(false);
    expect(await companyPushModeActive(accountId)).toBe(false);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBe(true);
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
      if (url.includes('/v1/push-health?')) return { ok: true, json: async () => ({ status: 'ok', previewMode: 'sender-subject-snippet-v1' }) };
      methods.push(init.method ?? 'GET');
      return { ok: true, status: 200, json: async () => ({ registrationId: 'new-registration' }) };
    }));
    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    expect(methods).toEqual(['DELETE', 'PUT']);
  });

  it('replaces this mailbox registration after its authenticated subject changes', async () => {
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/v1/push-health?')) return { ok: true, status: 200,
        json: async () => ({ status: 'ok', previewMode: 'sender-subject-snippet-v1' }) };
      methods.push(init.method ?? 'GET');
      return { ok: true, status: 200,
        json: async () => ({ registrationId: methods.length === 1 ? 'old-registration' : 'new-registration' }) };
    }));
    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    const newSubject = 'replacement-subject';
    session.getStoredOAuthTokens.mockResolvedValue({
      accessToken: jwt(newSubject), clientId: ZYNDMAIL_COMPANY.clientId,
      companyIdentity: { issuer: ZYNDMAIL_COMPANY.issuer, audience: 'stalwart', subject: newSubject },
    });
    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    expect(methods).toEqual(['PUT', 'DELETE', 'PUT']);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!)).toMatchObject({
      accountId, subject: newSubject, registrationId: 'new-registration',
    });
    expect(JSON.parse(records.get('zyndmail.production.push.preference.v1')!).accountIds).toContain(accountId);
  });

  it.each([true, false])('retires a changed-subject registration before returning OFF (owned: %s)', async (owned) => {
    const preferenceKey = 'zyndmail.production.push.preference.v1';
    const registrationKey = 'zyndmail.production.push.registration.v1';
    records.set(preferenceKey, JSON.stringify({ version: 3, accountIds: [accountId] }));
    records.set('zyndmail.production.push.account-subjects.v1', JSON.stringify([
      { accountId, subject: 'staff-subject' },
    ]));
    records.set(registrationKey, JSON.stringify({
      subject: 'staff-subject', ...(owned ? { accountId } : {}),
      registrationId: 'old-registration', renewedAt: Date.now(), routingVersion: 3, previews: true,
    }));
    session.getStoredOAuthTokens.mockResolvedValue({
      accessToken: jwt('replacement-subject'), clientId: ZYNDMAIL_COMPANY.clientId,
      companyIdentity: { issuer: ZYNDMAIL_COMPANY.issuer, audience: 'stalwart', subject: 'replacement-subject' },
    });
    let online = false;
    const fetchMock = vi.fn(async () => ({ ok: online, status: online ? 200 : 503 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await registerCompanyPush(accountId, false)).toMatchObject({ status: 'UNAVAILABLE' });
    expect(JSON.parse(records.get(registrationKey)!)).toMatchObject({
      registrationId: 'old-registration', revocationPending: true, revocationReason: 'required',
    });
    expect(records.has(preferenceKey)).toBe(false);
    online = true;
    expect(await registerCompanyPush(accountId, false)).toEqual({ status: 'OFF' });
    expect(records.has(registrationKey)).toBe(false);
    expect(fetchMock.mock.calls).toHaveLength(2);
  });

  it('does not restore migrated legacy consent after an overlapping opt-out', async () => {
    const preferenceKey = 'zyndmail.production.push.preference.v1';
    records.set(preferenceKey, JSON.stringify({ version: 2, subjects: ['staff-subject'] }));
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', accountId, registrationId: 'registration-1',
      renewedAt: Date.now(), routingVersion: 3, previews: true,
    }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
    let entered!: () => void;
    let release!: () => void;
    const reachedWrite = new Promise<void>((resolve) => { entered = resolve; });
    const heldWrite = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (key, value) => {
      entered();
      await heldWrite;
      records.set(key, value);
    });
    const status = companyPushStatus(accountId);
    await reachedWrite;
    const optOut = revokeCompanyPush(accountId);
    await vi.waitFor(() => expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBe(true));
    await Promise.race([optOut, new Promise((resolve) => setTimeout(resolve, 30))]);
    release();
    await Promise.all([status, optOut]);
    expect(records.has(preferenceKey)).toBe(false);
    expect(await registerCompanyPush(accountId, false)).toEqual({ status: 'OFF' });
  });

  it('preserves each staff account opt-in across A to B to A switching', async () => {
    const otherId = 'other@zyndpay.io@mail.zyndpay.io';
    useAccountStore.setState({ accounts: [
      { id: accountId, serverUrl: 'https://mail.zyndpay.io' } as never,
      { id: otherId, serverUrl: 'https://mail.zyndpay.io' } as never,
    ] });
    session.getStoredOAuthTokens.mockImplementation(async (id?: string) => {
      const subject = id === otherId ? 'other-subject' : 'staff-subject';
      return {
        accessToken: jwt(subject), clientId: ZYNDMAIL_COMPANY.clientId,
        companyIdentity: { issuer: ZYNDMAIL_COMPANY.issuer, audience: 'stalwart', subject },
      };
    });
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/v1/push-health?')) return { ok: true, status: 200,
        json: async () => ({ status: 'ok', previewMode: 'sender-subject-snippet-v1' }) };
      methods.push(init.method ?? 'GET');
      return { ok: true, status: 200, json: async () => ({
        registrationId: session.username === 'other@zyndpay.io' ? 'other-registration' : 'staff-registration',
      }) };
    }));

    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    records.set('zyndmail.production.push.preference.v1', 'staff-subject');
    session.username = 'other@zyndpay.io';
    expect(await registerCompanyPush(otherId, false, true)).toEqual({ status: 'OFF' });
    expect(await companyPushStatus(otherId)).toEqual({ status: 'OFF' });
    expect(methods).toEqual(['PUT']);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).subject).toBe('staff-subject');

    session.username = 'staff@zyndpay.io';
    expect(await registerCompanyPush(accountId, false)).toEqual({ status: 'ACTIVE' });
    session.username = 'other@zyndpay.io';
    expect(await registerCompanyPush(otherId, true)).toEqual({ status: 'ACTIVE' });
    session.username = 'staff@zyndpay.io';
    expect(await registerCompanyPush(accountId, false)).toEqual({ status: 'ACTIVE' });
    session.username = 'other@zyndpay.io';
    expect(await registerCompanyPush(otherId, false)).toEqual({ status: 'ACTIVE' });
    expect(methods).toEqual(['PUT', 'DELETE', 'PUT', 'DELETE', 'PUT', 'DELETE', 'PUT']);
  });

  it('keeps surviving consent when staff accounts share an OIDC subject', async () => {
    const otherId = 'other@zyndpay.io@mail.zyndpay.io';
    useAccountStore.setState({ accounts: [
      { id: accountId, serverUrl: 'https://mail.zyndpay.io' } as never,
      { id: otherId, serverUrl: 'https://mail.zyndpay.io' } as never,
    ] });
    let nextRegistration = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => url.includes('/v1/push-health?')
        ? { status: 'ok', previewMode: 'sender-subject-snippet-v1' }
        : { registrationId: `registration-${++nextRegistration}` },
    })));
    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    session.username = 'other@zyndpay.io';
    expect(await registerCompanyPush(otherId, false)).toEqual({ status: 'OFF' });
    expect(await registerCompanyPush(otherId, true)).toEqual({ status: 'ACTIVE' });
    expect(await revokeCompanyPush(accountId, false, true)).toBe(true);
    expect(JSON.parse(records.get('zyndmail.production.push.preference.v1')!).accountIds).toEqual([otherId]);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).accountId).toBe(otherId);
    expect(await companyPushStatus(otherId)).toEqual({ status: 'ACTIVE' });
  });

  it('does not grant ambiguous legacy subject consent to both saved accounts', async () => {
    const otherId = 'other@zyndpay.io@mail.zyndpay.io';
    useAccountStore.setState({ accounts: [
      { id: accountId, serverUrl: 'https://mail.zyndpay.io' } as never,
      { id: otherId, serverUrl: 'https://mail.zyndpay.io' } as never,
    ] });
    records.set('zyndmail.production.push.account-subjects.v1', JSON.stringify([
      { accountId, subject: 'staff-subject' }, { accountId: otherId, subject: 'staff-subject' },
    ]));
    records.set('zyndmail.production.push.preference.v1', 'staff-subject');
    expect(await registerCompanyPush(accountId, false)).toEqual({ status: 'OFF' });
    session.username = 'other@zyndpay.io';
    expect(await registerCompanyPush(otherId, false)).toEqual({ status: 'OFF' });
    expect(JSON.parse(records.get('zyndmail.production.push.preference.v1')!)).toEqual({ version: 3, accountIds: [] });
  });

  it('preserves the returning staff account opt-in while settings reconciles a failed switch', async () => {
    const otherId = 'other@zyndpay.io@mail.zyndpay.io';
    useAccountStore.setState({ accounts: [
      { id: accountId, serverUrl: 'https://mail.zyndpay.io' } as never,
      { id: otherId, serverUrl: 'https://mail.zyndpay.io' } as never,
    ] });
    session.getStoredOAuthTokens.mockImplementation(async (id?: string) => {
      const subject = id === otherId ? 'other-subject' : 'staff-subject';
      return {
        accessToken: jwt(subject), clientId: ZYNDMAIL_COMPANY.clientId,
        companyIdentity: { issuer: ZYNDMAIL_COMPANY.issuer, audience: 'stalwart', subject },
      };
    });
    let relayAvailable = true;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/v1/push-health?')) return { ok: true, status: 200,
        json: async () => ({ status: 'ok', previewMode: 'sender-subject-snippet-v1' }) };
      if (init.method === 'DELETE') return { ok: relayAvailable, status: relayAvailable ? 200 : 503 };
      return { ok: true, status: 200, json: async () => ({ registrationId: 'registration-1' }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    records.set('zyndmail.production.push.preference.v1', JSON.stringify({
      version: 2, subjects: ['staff-subject', 'other-subject'],
    }));
    relayAvailable = false;
    session.username = 'other@zyndpay.io';
    expect(await registerCompanyPush(otherId, false, true)).toMatchObject({ status: 'ERROR' });
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBe(true);

    session.username = 'staff@zyndpay.io';
    expect(await companyPushStatus(accountId)).toMatchObject({ status: 'REVOKE_PENDING' });
    expect(await reconcileCompanyPush(accountId)).toMatchObject({ status: 'REVOKE_PENDING' });
    expect(JSON.parse(records.get('zyndmail.production.push.preference.v1')!).accountIds).toContain(accountId);

    relayAvailable = true;
    expect(await reconcileCompanyPush(accountId)).toEqual({ status: 'ACTIVE' });
    expect(await companyPushStatus(accountId)).toEqual({ status: 'ACTIVE' });
    expect(JSON.parse(records.get('zyndmail.production.push.preference.v1')!).accountIds).toContain(accountId);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).subject).toBe('staff-subject');
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
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationReason).toBe('global-email-off');
    deleteFails = false;
    expect(await reconcileCompanyPush(accountId)).toEqual({ status: 'OFF' });
    expect(await companyPushRevocationPending(accountId)).toBe(false);
    expect(await companyPushStatus(accountId)).toEqual({ status: 'OFF' });
  });

  it('cancels offline global-off revocation when Email returns on without deleting the registration', async () => {
    let deleteAvailable = false;
    let putAvailable = true;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/v1/push-health?')) return { ok: true, status: 200,
        json: async () => ({ status: 'ok', previewMode: 'sender-subject-snippet-v1' }) };
      if (init.method === 'DELETE') return { ok: deleteAvailable, status: deleteAvailable ? 200 : 503 };
      return { ok: putAvailable, status: putAvailable ? 200 : 503,
        json: async () => ({ registrationId: 'registration-1' }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    useSettingsStore.setState({ emailNotificationsEnabled: false });
    expect(await reconcileCompanyPush(accountId)).toMatchObject({ status: 'REVOKE_PENDING' });
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationReason).toBe('global-email-off');
    const deletions = fetchMock.mock.calls.filter(([, init]) => init.method === 'DELETE').length;

    useSettingsStore.setState({ emailNotificationsEnabled: true });
    deleteAvailable = true;
    putAvailable = false;
    expect(await reconcileCompanyPush(accountId)).toMatchObject({ status: 'ERROR' });
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'DELETE')).toHaveLength(deletions);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!)).toMatchObject({
      registrationId: 'registration-1', revocationPending: false,
    });
    expect(await companyPushRevocationPending(accountId)).toBe(false);
  });

  it('keeps explicit opt-out revocation pending through an Email off-on toggle', async () => {
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', accountId, registrationId: 'registration-1', renewedAt: Date.now(),
    }));
    records.set('zyndmail.production.push.preference.v1', 'staff-subject');
    let relayAvailable = false;
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: relayAvailable, status: relayAvailable ? 200 : 503,
    }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await revokeCompanyPush(accountId)).toBe(false);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationReason).toBe('required');
    useSettingsStore.setState({ emailNotificationsEnabled: false });
    expect(await reconcileDisabledCompanyPush()).toBe(true);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationReason).toBe('required');
    useSettingsStore.setState({ emailNotificationsEnabled: true });
    relayAvailable = true;
    expect(await reconcilePendingCompanyPushRevocation()).toBe(false);
    expect(records.has('zyndmail.production.push.registration.v1')).toBe(false);
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'DELETE').length).toBeGreaterThan(1);
  });

  it('cancels queued staff global-off revocation after a rapid off-on toggle', async () => {
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', accountId, registrationId: 'staff-registration',
      renewedAt: Date.now(), routingVersion: 3, previews: true,
    }));
    records.set('zyndmail.production.push.preference.v1', 'staff-subject');
    const otherId = 'other@zyndpay.io@mail.zyndpay.io';
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    session.username = 'other@zyndpay.io';
    session.ensureFreshToken.mockImplementationOnce(async () => { started(); await held; });
    const blocker = registerCompanyPush(otherId, false);
    await entered;
    session.username = 'staff@zyndpay.io';
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/v1/push-health?')) return { ok: true, status: 200,
        json: async () => ({ status: 'ok', previewMode: 'sender-subject-snippet-v1' }) };
      methods.push(init.method ?? 'GET');
      return { ok: true, status: 200, json: async () => ({ registrationId: 'staff-registration' }) };
    }));
    useSettingsStore.setState({ emailNotificationsEnabled: false });
    const off = reconcileCompanyPush(accountId);
    useSettingsStore.setState({ emailNotificationsEnabled: true });
    const on = reconcileCompanyPush(accountId);
    release();

    await blocker;
    expect(await off).toEqual({ status: 'ACTIVE' });
    expect(await on).toEqual({ status: 'ACTIVE' });
    expect(methods).not.toContain('DELETE');
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!)).toMatchObject({
      accountId, registrationId: 'staff-registration',
    });
    expect(JSON.parse(records.get('zyndmail.production.push.preference.v1')!).accountIds).toContain(accountId);
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

  it.each([true, false])('retries missing-token logout with revocation key: %s', async (withKey) => {
    const revocationKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64url');
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', accountId, registrationId: 'registration-1',
      ...(withKey ? { revocationKey } : {}), renewedAt: Date.now(),
    }));
    records.set('zyndmail.production.push.installation.v1', 'saved-installation');
    records.set('zyndmail.production.push.preference.v1', JSON.stringify({
      version: 2, subjects: ['staff-subject', 'other-subject'],
    }));
    const otherId = 'other@zyndpay.io@mail.zyndpay.io';
    useAccountStore.setState({ accounts: [
      { id: accountId, serverUrl: 'https://mail.zyndpay.io' } as never,
      { id: otherId, serverUrl: 'https://mail.zyndpay.io' } as never,
    ] });
    records.set('zyndmail.production.push.account-subjects.v1', JSON.stringify([
      { accountId, subject: 'staff-subject' }, { accountId: otherId, subject: 'other-subject' },
    ]));
    session.getStoredOAuthTokens.mockRejectedValue(new Error('Unreadable tokens'));
    session.getStoredCredentials.mockResolvedValue(null);
    let relayAvailable = false;
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: relayAvailable, status: relayAvailable ? 200 : 503,
    }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await revokeCompanyPush(accountId)).toBe(false);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBe(true);
    expect(JSON.parse(records.get('zyndmail.production.push.preference.v1')!).accountIds).toEqual([otherId]);
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual(withKey
      ? { registrationId: 'registration-1', revocationKey }
      : { registrationId: 'registration-1', installationId: 'saved-installation' });

    useAccountStore.setState({ accounts: [{ id: otherId, serverUrl: 'https://mail.zyndpay.io' } as never] });
    expect(await reconcilePendingCompanyPushRevocation()).toBe(true);
    relayAvailable = true;
    expect(await reconcilePendingCompanyPushRevocation()).toBe(false);
    expect(records.has('zyndmail.production.push.registration.v1')).toBe(false);
    expect(JSON.parse(records.get('zyndmail.production.push.preference.v1')!).accountIds).toEqual([otherId]);
  });

  it('clears only the removed staff consent when another staff account owns the registration', async () => {
    const otherId = 'other@zyndpay.io@mail.zyndpay.io';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => ({
      ok: true, status: 200,
      json: async () => url.includes('/v1/push-health?')
        ? { status: 'ok', previewMode: 'sender-subject-snippet-v1' }
        : { registrationId: 'first-registration' },
    })));
    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'other-subject', accountId: otherId, registrationId: 'other-registration', renewedAt: Date.now(),
    }));
    records.set('zyndmail.production.push.preference.v1', JSON.stringify({
      version: 2, subjects: ['staff-subject', 'other-subject'],
    }));
    session.getStoredOAuthTokens.mockRejectedValue(new Error('Unreadable tokens'));
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await revokeCompanyPush(accountId, false, true)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!)).toMatchObject({
      accountId: otherId, registrationId: 'other-registration',
    });
    expect(JSON.parse(records.get('zyndmail.production.push.preference.v1')!).accountIds).toEqual([otherId]);
  });

  it('drops unowned legacy consent when removed staff identity cannot be recovered', async () => {
    const otherId = 'other@zyndpay.io@mail.zyndpay.io';
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'other-subject', accountId: otherId, registrationId: 'other-registration', renewedAt: Date.now(),
    }));
    records.set('zyndmail.production.push.preference.v1', JSON.stringify({
      version: 2, subjects: ['staff-subject', 'other-subject', 'unmapped-subject'],
    }));
    useAccountStore.setState({ accounts: [
      { id: accountId, serverUrl: 'https://mail.zyndpay.io' } as never,
      { id: otherId, serverUrl: 'https://mail.zyndpay.io' } as never,
    ] });
    session.getStoredOAuthTokens.mockRejectedValue(new Error('Unreadable tokens'));
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await revokeCompanyPush(accountId, false, true)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(records.get('zyndmail.production.push.preference.v1')!).accountIds).toEqual([otherId]);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).accountId).toBe(otherId);
  });

  it('keeps an evicted registration pending offline and retries without credentials', async () => {
    const revocationKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64url');
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', accountId, registrationId: 'registration-1', revocationKey,
      renewedAt: Date.now(), routingVersion: 3, previews: true,
    }));
    records.set('zyndmail.production.push.preference.v1', JSON.stringify({
      version: 2, subjects: ['staff-subject', 'other-subject'],
    }));
    session.getStoredOAuthTokens.mockResolvedValue(null);
    let relayAvailable = false;
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: relayAvailable, status: relayAvailable ? 200 : 503,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await revokeEvictedCompanyPush('other@zyndpay.io@mail.zyndpay.io');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBeUndefined();

    await revokeEvictedCompanyPush(accountId);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBe(true);
    expect(JSON.parse(records.get('zyndmail.production.push.preference.v1')!).subjects)
      .toEqual(['staff-subject', 'other-subject']);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      method: 'DELETE', headers: expect.not.objectContaining({ Authorization: expect.any(String) }),
    }));

    useAccountStore.setState({ accounts: [] });
    expect(await reconcilePendingCompanyPushRevocation()).toBe(true);
    relayAvailable = true;
    expect(await reconcilePendingCompanyPushRevocation()).toBe(false);
    expect(records.has('zyndmail.production.push.registration.v1')).toBe(false);
    expect(JSON.parse(records.get('zyndmail.production.push.preference.v1')!).subjects)
      .toEqual(['staff-subject', 'other-subject']);
  });

  it('keeps a surviving staff registration when legacy ownership is mapped and tokens are unreadable', async () => {
    const otherId = 'other@zyndpay.io@mail.zyndpay.io';
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'other-subject', registrationId: 'legacy-registration', renewedAt: Date.now(),
    }));
    records.set('zyndmail.production.push.account-subjects.v1', JSON.stringify([
      { accountId, subject: 'staff-subject' },
      { accountId: otherId, subject: 'other-subject' },
    ]));
    records.set('zyndmail.production.push.preference.v1', JSON.stringify({
      version: 2, subjects: ['staff-subject', 'other-subject'],
    }));
    records.set('zyndmail.production.push.installation.v1', 'legacy-installation');
    useAccountStore.setState({ accounts: [
      { id: accountId, serverUrl: 'https://mail.zyndpay.io' } as never,
      { id: otherId, serverUrl: 'https://mail.zyndpay.io' } as never,
    ] });
    session.getStoredOAuthTokens.mockRejectedValue(new Error('Unreadable tokens'));
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: false, status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await revokeEvictedCompanyPush(accountId);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!)).toMatchObject({
      subject: 'other-subject', registrationId: 'legacy-registration',
    });
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBeUndefined();
    expect(JSON.parse(records.get('zyndmail.production.push.preference.v1')!).subjects)
      .toEqual(['staff-subject', 'other-subject']);

    await revokeEvictedCompanyPush(otherId);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      registrationId: 'legacy-registration', installationId: 'legacy-installation',
    });
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

  it('retries a keyless legacy registration after its only staff account loses credentials', async () => {
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', registrationId: 'legacy-registration', renewedAt: Date.now(),
    }));
    useAccountStore.setState({ accounts: [{ id: accountId, serverUrl: 'https://mail.zyndpay.io' } as never] });
    records.set('zyndmail.production.push.installation.v1', 'legacy-installation');
    session.getStoredOAuthTokens.mockResolvedValue(null);
    session.getStoredCredentials.mockResolvedValue(null);
    let relayAvailable = false;
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: relayAvailable, status: relayAvailable ? 200 : 503,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await revokeEvictedCompanyPush(accountId);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      registrationId: 'legacy-registration', installationId: 'legacy-installation',
    });
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
    useAccountStore.setState({ accounts: [] });
    expect(await reconcilePendingCompanyPushRevocation()).toBe(true);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBe(true);

    relayAvailable = true;
    expect(await reconcilePendingCompanyPushRevocation()).toBe(false);
    expect(records.has('zyndmail.production.push.registration.v1')).toBe(false);
  });

  it('retires an ambiguous legacy registration without erasing surviving staff consent', async () => {
    const otherId = 'other@zyndpay.io@mail.zyndpay.io';
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', registrationId: 'legacy-registration', renewedAt: Date.now(),
    }));
    records.set('zyndmail.production.push.installation.v1', 'legacy-installation');
    records.set('zyndmail.production.push.preference.v1', JSON.stringify({
      version: 2, subjects: ['staff-subject', 'other-subject'],
    }));
    useAccountStore.setState({ accounts: [
      { id: accountId, serverUrl: 'https://mail.zyndpay.io' } as never,
      { id: otherId, serverUrl: 'https://mail.zyndpay.io' } as never,
    ] });
    session.getStoredOAuthTokens.mockImplementation(async (id?: string) => id === otherId ? {
      accessToken: jwt('other-subject'), clientId: ZYNDMAIL_COMPANY.clientId,
      companyIdentity: { issuer: ZYNDMAIL_COMPANY.issuer, audience: 'stalwart', subject: 'other-subject' },
    } : null);
    let relayAvailable = false;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/v1/push-health?')) return { ok: true, status: 200,
        json: async () => ({ status: 'ok', previewMode: 'sender-subject-snippet-v1' }) };
      if (init.method === 'DELETE') return { ok: relayAvailable, status: relayAvailable ? 200 : 503 };
      return { ok: true, status: 200, json: async () => ({ registrationId: 'other-registration' }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    await revokeEvictedCompanyPush(accountId);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBe(true);
    expect(JSON.parse(records.get('zyndmail.production.push.preference.v1')!).subjects)
      .toEqual(['staff-subject', 'other-subject']);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      registrationId: 'legacy-registration', installationId: 'legacy-installation',
    });
    useAccountStore.setState({ accounts: [{ id: otherId, serverUrl: 'https://mail.zyndpay.io' } as never] });
    session.username = 'other@zyndpay.io';
    expect(await registerCompanyPush(otherId, false)).toMatchObject({ status: 'UNAVAILABLE' });
    relayAvailable = true;
    expect(await registerCompanyPush(otherId, false)).toEqual({ status: 'ACTIVE' });
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!)).toMatchObject({
      accountId: otherId, subject: 'other-subject', registrationId: 'other-registration',
    });
    expect(JSON.parse(records.get('zyndmail.production.push.preference.v1')!).accountIds)
      .toContain(otherId);
  });

  it('revokes saved staff push when global email alerts are disabled on a personal account', async () => {
    const revocationKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64url');
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', accountId, registrationId: 'staff-registration', revocationKey,
      renewedAt: Date.now(), routingVersion: 3, previews: true,
    }));
    records.set('zyndmail.production.push.preference.v1', 'staff-subject');
    session.username = 'personal@example.com';
    session.serverUrl = 'https://mail.example.com';
    session.getStoredOAuthTokens.mockResolvedValue(null);
    useSettingsStore.setState({ emailNotificationsEnabled: false });
    let relayAvailable = false;
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: relayAvailable, status: relayAvailable ? 200 : 503,
    }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await reconcileDisabledCompanyPush()).toBe(true);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBe(true);
    expect(records.get('zyndmail.production.push.preference.v1')).toBe('staff-subject');
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      registrationId: 'staff-registration', revocationKey,
    });
    relayAvailable = true;
    expect(await reconcileDisabledCompanyPush()).toBe(false);
    expect(records.has('zyndmail.production.push.registration.v1')).toBe(false);
    expect(records.get('zyndmail.production.push.preference.v1')).toBe('staff-subject');
  });

  it('cancels queued global-off revocation after a personal-account off-on toggle', async () => {
    const otherId = 'other@zyndpay.io@mail.zyndpay.io';
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', accountId, registrationId: 'staff-registration',
      renewedAt: Date.now(), routingVersion: 3, previews: true,
    }));
    records.set('zyndmail.production.push.preference.v1', JSON.stringify({
      version: 2, subjects: ['staff-subject'],
    }));
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    session.username = 'other@zyndpay.io';
    session.ensureFreshToken.mockImplementationOnce(async () => { started(); await held; });
    const blockedRegistration = registerCompanyPush(otherId, false);
    await entered;
    session.username = 'personal@example.com';
    session.serverUrl = 'https://mail.example.com';
    useSettingsStore.setState({ emailNotificationsEnabled: false });
    const queuedRevocation = reconcileDisabledCompanyPush();
    useSettingsStore.setState({ emailNotificationsEnabled: true });
    release();

    expect(await blockedRegistration).toMatchObject({ status: 'UNAVAILABLE' });
    expect(await queuedRevocation).toBe(false);
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!)).toMatchObject({
      registrationId: 'staff-registration',
    });
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!).revocationPending).toBeUndefined();
    expect(JSON.parse(records.get('zyndmail.production.push.preference.v1')!).subjects).toEqual(['staff-subject']);
  });

  it('serializes overlapping staff enrollment and keeps the newer owner registration', async () => {
    const otherId = 'other@zyndpay.io@mail.zyndpay.io';
    const firstToken = jwt('staff-subject');
    const secondToken = jwt('other-subject');
    session.getStoredOAuthTokens.mockImplementation(async (id?: string) => ({
      accessToken: id === otherId ? secondToken : firstToken,
      clientId: ZYNDMAIL_COMPANY.clientId,
      companyIdentity: { issuer: ZYNDMAIL_COMPANY.issuer, audience: 'stalwart',
        subject: id === otherId ? 'other-subject' : 'staff-subject' },
    }));
    let firstPutStarted!: () => void;
    let releaseFirstPut!: () => void;
    const started = new Promise<void>((resolve) => { firstPutStarted = resolve; });
    const held = new Promise<void>((resolve) => { releaseFirstPut = resolve; });
    const methods: Array<{ method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/v1/push-health?')) return { ok: true, status: 200,
        json: async () => ({ status: 'ok', previewMode: 'sender-subject-snippet-v1' }) };
      const method = init.method ?? 'GET';
      methods.push({ method, body: JSON.parse(init.body as string) });
      if (method === 'DELETE') return { ok: true, status: 200 };
      if ((init.headers as Record<string, string>).Authorization === `Bearer ${firstToken}`) {
        firstPutStarted();
        await held;
        return { ok: true, status: 200, json: async () => ({ registrationId: 'first-registration' }) };
      }
      return { ok: true, status: 200, json: async () => ({ registrationId: 'second-registration' }) };
    }));

    const first = registerCompanyPush(accountId, true);
    await started;
    session.username = 'other@zyndpay.io';
    const second = registerCompanyPush(otherId, true);
    releaseFirstPut();
    expect(await first).toMatchObject({ status: 'ERROR' });
    expect(await second).toEqual({ status: 'ACTIVE' });
    expect(methods.map((request) => request.method)).toEqual(['PUT', 'DELETE', 'PUT']);
    expect(methods[1].body).toEqual({ registrationId: 'first-registration' });
    expect(JSON.parse(records.get('zyndmail.production.push.registration.v1')!)).toMatchObject({
      accountId: otherId, subject: 'other-subject', registrationId: 'second-registration',
    });
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
      if (url.includes('/v1/push-health?')) return { ok: true, json: async () => ({ status: 'ok', previewMode: 'sender-subject-snippet-v1' }) };
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
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => ({
      ok: init.method !== 'DELETE', status: init.method === 'DELETE' ? 503 : 200,
      json: async () => url.includes('/v1/push-health?')
        ? { status: 'ok', previewMode: 'sender-subject-snippet-v1' } : { registrationId: 'registration-1' },
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
  it('routes shared-subject taps only through the registration owner', async () => {
    const otherId = 'other@zyndpay.io@mail.zyndpay.io';
    useAccountStore.setState({ accounts: [
      { id: accountId, serverUrl: 'https://mail.zyndpay.io' } as never,
      { id: otherId, serverUrl: 'https://mail.zyndpay.io' } as never,
    ] });
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', accountId: otherId,
      registrationId: 'other-registration', renewedAt: Date.now(),
    }));
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ target: 'MESSAGE', accountId: 'shared', emailId: 'message' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const payload = { version: 1, notificationRef: 'a'.repeat(24) };

    expect(await registeredCompanyPushAccountId()).toBe(otherId);
    expect(await resolveCompanyPush(accountId, payload)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    session.username = 'other@zyndpay.io';
    expect(await resolveCompanyPush(otherId, payload)).toEqual({
      target: 'EMAIL', accountId: 'shared', emailId: 'message', threadId: 'authoritative-thread',
    });
    expect(getEmails).toHaveBeenCalledWith(['message'], 'shared');

    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', registrationId: 'legacy-registration', renewedAt: Date.now(),
    }));
    expect(await registeredCompanyPushAccountId()).toBeNull();
    useAccountStore.setState({ accounts: [{ id: otherId, serverUrl: 'https://mail.zyndpay.io' } as never] });
    expect(await registeredCompanyPushAccountId()).toBe(otherId);
  });

  it('accepts documented message targets and ignores an old thread hint', () => {
    expect(parseCompanyPushDestination({ target: 'ACCOUNT', accountId: 'shared' })).toBeNull();
    expect(parseCompanyPushDestination({ target: 'MESSAGE', accountId: 'shared', emailId: 'message' })).toEqual({ target: 'MESSAGE', accountId: 'shared', emailId: 'message' });
    expect(parseCompanyPushDestination({ target: 'EMAIL', accountId: 'shared', emailId: 'message', threadId: 'untrusted' })).toBeNull();
    expect(parseCompanyPushDestination({ target: 'INBOX' })).toBeNull();
  });
  it('rejects malformed targets and injected URLs', () => {
    expect(parseCompanyPushDestination({ target: 'EMAIL', accountId: '', emailId: 'id', threadId: 't' })).toBeNull();
    expect(parseCompanyPushDestination({ target: 'INBOX', url: 'https://example.com' })).toBeNull();
    expect(parseCompanyPushDestination(null)).toBeNull();
  });

  it('rejects undocumented relay targets without fetching a message', async () => {
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', registrationId: 'registration-1', renewedAt: Date.now(),
    }));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ target: 'EMAIL', accountId: 'shared', emailId: 'message', threadId: 'stale-thread' }),
    })));
    expect(await resolveCompanyPush(accountId, { version: 1, notificationRef: 'a'.repeat(24) })).toBeNull();
    expect(getEmails).not.toHaveBeenCalled();
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

  it('never routes expired or foreign references to another inbox', async () => {
    records.set('zyndmail.production.push.registration.v1', JSON.stringify({
      subject: 'staff-subject', accountId, registrationId: 'registration-1', renewedAt: Date.now(),
    }));
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ target: 'INBOX' }) });
    vi.stubGlobal('fetch', fetchMock);
    const payload = { version: 1, notificationRef: 'c'.repeat(24) };
    expect(await resolveCompanyPush(accountId, payload)).toBeNull();
    expect(await resolveCompanyPush(accountId, payload)).toBeNull();
    expect(getEmails).not.toHaveBeenCalled();
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
