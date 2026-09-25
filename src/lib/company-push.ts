import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { jmapClient } from '../api/jmap-client';
import { generateAccountId } from './account-utils';
import { refreshOAuthAccessToken } from './oauth';
import { isCompanyMailServer, validateCompanyAccessToken, ZYNDMAIL_COMPANY } from './zyndmail-company';

const INSTALLATION_KEY = 'zyndmail.production.push.installation.v1';
const REGISTRATION_KEY = 'zyndmail.production.push.registration.v1';
const PREFERENCE_KEY = 'zyndmail.production.push.preference.v1';
const RENEW_AFTER_MS = 30 * 60_000;
const RELAY_UNAVAILABLE = 'Company mail alerts are temporarily unavailable. Please try again later.';
const OPAQUE_REFERENCE = /^[A-Za-z0-9_-]{22,256}$/;
const storageOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
};

interface Registration {
  subject: string;
  registrationId: string;
  renewedAt: number;
}

export type CompanyPushStatus =
  | { status: 'OFF' | 'NOT_REQUESTED' | 'DENIED' | 'ACTIVE' }
  | { status: 'UNAVAILABLE'; reason: string }
  | { status: 'ERROR'; reason: string };

/** No default: this must be the reviewed mail-plane relay, never the public Bulwark relay. */
export function companyPushRelayOrigin(): string | null {
  const value = process.env.EXPO_PUBLIC_MAIL_PUSH_RELAY_ORIGIN;
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        (url.pathname !== '/' && url.pathname !== '')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function projectId(): string | null {
  const value = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function appId(): string | null {
  const value = Platform.OS === 'ios'
    ? Constants.expoConfig?.ios?.bundleIdentifier
    : Constants.expoConfig?.android?.package;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function configurationError(): string | null {
  if (!Device.isDevice) return 'A physical device is required for mail push.';
  if (!companyPushRelayOrigin()) return 'The company mail push relay is not configured.';
  if (!projectId() || !appId()) return 'This signed app has no EAS push identity.';
  return null;
}

async function relayFetch(path: string, bearer: string, init: RequestInit): Promise<Response> {
  const origin = companyPushRelayOrigin();
  if (!origin) throw new Error('The company mail push relay is not configured.');
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  try {
    return await fetch(`${origin}/${path}`, {
      ...init,
      redirect: 'error',
      signal: abort.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
    });
  } catch {
    throw new Error(RELAY_UNAVAILABLE);
  } finally {
    clearTimeout(timeout);
  }
}

/** Probe the relay before asking for OS permission or an Expo token. Never follow
 * a redirect from the mail host to webmail with a staff bearer token. */
async function relayReady(): Promise<boolean> {
  const origin = companyPushRelayOrigin();
  if (!origin) return false;
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 5_000);
  try {
    // The old webmail fallback issued a cacheable 301 for this path. A fresh
    // probe URL prevents iOS from reusing that redirect after the relay goes live.
    const response = await fetch(`${origin}/v1/push-health?probe=${Date.now().toString(36)}`, {
      method: 'GET', redirect: 'error', signal: abort.signal,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) return false;
    const body = await response.json() as Record<string, unknown>;
    return body.status === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function installationId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALLATION_KEY, storageOptions);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(INSTALLATION_KEY, created, storageOptions);
  return created;
}

async function readRegistration(): Promise<Registration | null> {
  const raw = await SecureStore.getItemAsync(REGISTRATION_KEY, storageOptions);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Registration>;
    return typeof value.subject === 'string' && typeof value.registrationId === 'string'
      ? { subject: value.subject, registrationId: value.registrationId, renewedAt: value.renewedAt ?? 0 }
      : null;
  } catch {
    return null;
  }
}

async function preferenceSubject(): Promise<string | null> {
  return SecureStore.getItemAsync(PREFERENCE_KEY, storageOptions);
}

async function currentCompanySession(accountId: string): Promise<{ subject: string; bearer: string } | null> {
  if (generateAccountId(jmapClient.username ?? '', jmapClient.serverUrl ?? '') !== accountId ||
      !isCompanyMailServer(jmapClient.serverUrl ?? '')) return null;
  await jmapClient.ensureFreshToken();
  const tokens = await jmapClient.getStoredOAuthTokens(accountId);
  if (!tokens?.companyIdentity || tokens.clientId !== ZYNDMAIL_COMPANY.clientId) return null;
  const identity = validateCompanyAccessToken(tokens.accessToken, tokens.companyIdentity.subject);
  if (generateAccountId(jmapClient.username ?? '', jmapClient.serverUrl ?? '') !== accountId) return null;
  return { subject: identity.subject, bearer: tokens.accessToken };
}

async function storedCompanySession(accountId: string): Promise<{ subject: string; bearer: string } | null> {
  const credentials = await jmapClient.getStoredCredentials(accountId);
  if (!credentials || !isCompanyMailServer(credentials.serverUrl)) return null;
  let tokens = await jmapClient.getStoredOAuthTokens(accountId);
  if (!tokens?.companyIdentity || tokens.clientId !== ZYNDMAIL_COMPANY.clientId) return null;
  const expectedSubject = tokens.companyIdentity.subject;
  if (tokens.expiresAt && tokens.expiresAt < Date.now() + 60_000) {
    tokens = await refreshOAuthAccessToken(tokens);
    await jmapClient.setStoredCredentials(accountId, {
      ...credentials, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });
  }
  const identity = validateCompanyAccessToken(tokens.accessToken, expectedSubject);
  return { subject: identity.subject, bearer: tokens.accessToken };
}

export function parseCompanyPushPayload(value: unknown): { version: 1; notificationRef: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== 'notificationRef' || keys[1] !== 'version' ||
      record.version !== 1 || typeof record.notificationRef !== 'string' ||
      !OPAQUE_REFERENCE.test(record.notificationRef)) return null;
  return { version: 1, notificationRef: record.notificationRef };
}

/** The server may only send an opaque, content-free mail alert. */
export function isCompanyPushPresentation(content: Notifications.NotificationContent): boolean {
  return content.title === 'ZyndMail' && content.body === 'New ZyndPay Mail activity' &&
    !content.subtitle && parseCompanyPushPayload(content.data) !== null;
}

export async function companyPushStatus(accountId: string): Promise<CompanyPushStatus> {
  const problem = configurationError();
  if (problem) return { status: 'UNAVAILABLE', reason: problem };
  const session = await currentCompanySession(accountId);
  if (!session) return { status: 'UNAVAILABLE', reason: 'Sign in with ZyndPay Staff to enable mail alerts.' };
  const registration = await readRegistration();
  if (registration && registration.subject !== session.subject) {
    return { status: 'ERROR', reason: 'An earlier staff registration must be revoked first.' };
  }
  if (!registration && !await relayReady()) return { status: 'UNAVAILABLE', reason: RELAY_UNAVAILABLE };
  if (await preferenceSubject() !== session.subject) return { status: 'OFF' };
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status === 'undetermined') return { status: 'NOT_REQUESTED' };
  if (!permission.granted) return { status: 'DENIED' };
  return registration ? { status: 'ACTIVE' } : { status: 'ERROR', reason: 'Register this device again.' };
}

const inFlight = new Map<string, Promise<CompanyPushStatus>>();

export function registerCompanyPush(accountId: string, requestPermission: boolean, force = false): Promise<CompanyPushStatus> {
  const existing = inFlight.get(accountId);
  if (existing) return existing;
  const run = registerCompanyPushInner(accountId, requestPermission, force)
    .catch((error): CompanyPushStatus => ({
      status: 'ERROR', reason: error instanceof Error ? error.message : 'Mail push registration failed.',
    }))
    .finally(() => { inFlight.delete(accountId); });
  inFlight.set(accountId, run);
  return run;
}

async function registerCompanyPushInner(accountId: string, requestPermission: boolean, force: boolean): Promise<CompanyPushStatus> {
  const problem = configurationError();
  if (problem) return { status: 'UNAVAILABLE', reason: problem };
  const session = await currentCompanySession(accountId);
  if (!session) return { status: 'UNAVAILABLE', reason: 'Sign in with ZyndPay Staff to enable mail alerts.' };
  const previous = await readRegistration();
  if (previous && previous.subject !== session.subject) {
    return { status: 'ERROR', reason: 'An earlier staff registration must be revoked first.' };
  }
  if (!requestPermission && await preferenceSubject() !== session.subject) return { status: 'OFF' };
  if (previous && !force && !requestPermission && Date.now() - previous.renewedAt < RENEW_AFTER_MS) return companyPushStatus(accountId);
  if (!await relayReady()) return { status: 'UNAVAILABLE', reason: RELAY_UNAVAILABLE };
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('mail-activity', {
      name: 'Mail activity',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      showBadge: false,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted || !requestPermission ? current : await Notifications.requestPermissionsAsync();
  if (permission.status === 'undetermined') return { status: 'NOT_REQUESTED' };
  if (!permission.granted) return { status: 'DENIED' };
  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId: projectId()! });
    // A logout/account switch during token acquisition must not register the old identity.
    if (generateAccountId(jmapClient.username ?? '', jmapClient.serverUrl ?? '') !== accountId) {
      return { status: 'ERROR', reason: 'The active mail account changed. Please try again.' };
    }
    const response = await relayFetch('v1/device-registrations/current', session.bearer, {
      method: 'PUT',
      body: JSON.stringify({
        installationId: await installationId(),
        expoPushToken: token.data,
        projectId: projectId(),
        appId: appId(),
        platform: Platform.OS,
        environment: 'production',
      }),
    });
    if (!response.ok) throw new Error(`Mail push registration failed (${response.status}).`);
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.registrationId !== 'string' || !body.registrationId) {
      throw new Error('The mail relay returned an invalid registration.');
    }
    await SecureStore.setItemAsync(REGISTRATION_KEY, JSON.stringify({
      subject: session.subject, registrationId: body.registrationId, renewedAt: Date.now(),
    }), storageOptions);
    if (generateAccountId(jmapClient.username ?? '', jmapClient.serverUrl ?? '') !== accountId) {
      // Preserve the local reference until the relay confirms revocation. A
      // user switch must never orphan a live registration on this device.
      const revoked = await relayFetch('v1/device-registrations/current', session.bearer, {
        method: 'DELETE', body: JSON.stringify({ registrationId: body.registrationId }),
      }).then((result) => result.ok || result.status === 404 || result.status === 410).catch(() => false);
      if (revoked) await SecureStore.deleteItemAsync(REGISTRATION_KEY, storageOptions);
      return { status: 'ERROR', reason: 'The active mail account changed during registration.' };
    }
    await SecureStore.setItemAsync(PREFERENCE_KEY, session.subject, storageOptions);
    return { status: 'ACTIVE' };
  } catch (error) {
    return { status: 'ERROR', reason: error instanceof Error ? error.message : 'Mail push registration failed.' };
  }
}

export async function revokeCompanyPush(accountId: string): Promise<boolean> {
  const pending = inFlight.get(accountId);
  if (pending) await pending.catch(() => undefined);
  // A failed token refresh or relay outage must not silently re-enable push
  // after opt-out. Only clear this account's preference, since a different
  // staff account may be active on the same device.
  const tokens = await jmapClient.getStoredOAuthTokens(accountId).catch(() => null);
  if (tokens?.companyIdentity?.subject &&
      await preferenceSubject() === tokens.companyIdentity.subject) {
    await SecureStore.deleteItemAsync(PREFERENCE_KEY, storageOptions);
  }
  const session = await storedCompanySession(accountId).catch(() => null);
  if (!session) return false;
  const registration = await readRegistration();
  if (!registration || registration.subject !== session.subject) return true;
  try {
    const response = await relayFetch('v1/device-registrations/current', session.bearer, {
      method: 'DELETE', body: JSON.stringify({ registrationId: registration.registrationId }),
    });
    if (!response.ok && response.status !== 404 && response.status !== 410) return false;
    await SecureStore.deleteItemAsync(REGISTRATION_KEY, storageOptions);
    return true;
  } catch {
    return false;
  }
}

export async function resolveCompanyPush(accountId: string, value: unknown): Promise<boolean> {
  const payload = parseCompanyPushPayload(value);
  if (!payload) return false;
  const session = await currentCompanySession(accountId).catch(() => null);
  const registration = await readRegistration();
  if (!session || !registration || registration.subject !== session.subject) return false;
  try {
    const response = await relayFetch('v1/notification-references/resolve', session.bearer, {
      method: 'POST',
      body: JSON.stringify({ installationId: await installationId(), notificationRef: payload.notificationRef }),
    });
    if (response.status === 404 || response.status === 410) return true;
    if (!response.ok) return false;
    const result = await response.json() as Record<string, unknown>;
    // Current relay intentionally resolves only to a generic All Inboxes target.
    return Object.keys(result).length === 1 && result.target === 'INBOX';
  } catch {
    return false;
  }
}
