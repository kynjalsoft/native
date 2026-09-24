import { beforeEach, describe, expect, it, vi } from 'vitest';

const records = vi.hoisted(() => new Map<string, string>());
const expoToken = vi.hoisted(() => vi.fn(async () => ({ data: 'ExpoPushToken[ABCDEFGHIJKLMNOP1234567890]' })));
const registerChannel = vi.hoisted(() => vi.fn(async () => undefined));
const session = vi.hoisted(() => ({
  username: 'staff@zyndpay.io',
  serverUrl: 'https://mail.zyndpay.io',
  ensureFreshToken: vi.fn(async () => undefined),
  getStoredOAuthTokens: vi.fn(async () => null as unknown),
  getStoredCredentials: vi.fn(async () => null as unknown),
}));

vi.mock('expo-constants', () => ({ default: {
  easConfig: { projectId: '654a0262-9785-4753-8f37-9b0947b537a2' },
  expoConfig: { android: { package: 'io.zyndpay.mail.preview' } },
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
  AndroidImportance: { DEFAULT: 3 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
}));
vi.mock('../../api/jmap-client', () => ({ jmapClient: session }));

import { companyPushRelayOrigin, parseCompanyPushPayload, registerCompanyPush, revokeCompanyPush } from '../company-push';
import { ZYNDMAIL_COMPANY } from '../zyndmail-company';

const accountId = 'staff@zyndpay.io@mail.zyndpay.io';
const jwt = (subject: string) => {
  const payload = { iss: ZYNDMAIL_COMPANY.issuer, aud: ['stalwart'], sub: subject, exp: Date.now() / 1000 + 3600 };
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
};

beforeEach(() => {
  records.clear();
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

  it('requires opt-in and registers the exact preview identity without a mailbox payload', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true, status: 200, json: async () => ({ registrationId: 'registration-1' }),
      request: JSON.parse(init.body as string),
    }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await registerCompanyPush(accountId, false)).toEqual({ status: 'OFF' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await registerCompanyPush(accountId, true)).toEqual({ status: 'ACTIVE' });
    expect(expoToken).toHaveBeenCalledWith({ projectId: '654a0262-9785-4753-8f37-9b0947b537a2' });
    expect(registerChannel).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://mail.zyndpay.io/v1/device-registrations/current');
    expect(JSON.parse(init.body as string)).toMatchObject({
      appId: 'io.zyndpay.mail.preview', projectId: '654a0262-9785-4753-8f37-9b0947b537a2',
      platform: 'android', environment: 'production',
    });
    expect(JSON.stringify(JSON.parse(init.body as string))).not.toMatch(/staff-subject|mailbox|subject/);
    expect(await revokeCompanyPush(accountId)).toBe(true);
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
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
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ registrationId: 'registration-1' }),
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
