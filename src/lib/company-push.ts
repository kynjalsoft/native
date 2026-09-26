import { useSettingsStore } from '../stores/settings-store';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { jmapClient } from '../api/jmap-client';
import { getEmails } from '../api/email';
import { useAccountStore } from '../stores/account-store';
import { generateAccountId } from './account-utils';
import { isCompanyMailServer, validateCompanyAccessToken, ZYNDMAIL_COMPANY } from './zyndmail-company';

const INSTALLATION_KEY = 'zyndmail.production.push.installation.v1';
const REGISTRATION_KEY = 'zyndmail.production.push.registration.v1';
const PREFERENCE_KEY = 'zyndmail.production.push.preference.v1';
const RENEW_AFTER_MS = 30 * 60_000;
const RELAY_UNAVAILABLE = 'Company mail alerts are temporarily unavailable. Please try again later.';
const OPAQUE_REFERENCE = /^[A-Za-z0-9_-]{22,256}$/;
const REVOCATION_KEY = /^[A-Za-z0-9_+/=-]{43,512}$/;
const storageOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
};

interface Registration {
  subject: string;
  registrationId: string;
  revocationKey?: string;
  renewedAt: number;
  routingVersion?: number;
  previews?: boolean;
  revocationPending?: boolean;
}

export type CompanyPushStatus =
  | { status: 'OFF' | 'NOT_REQUESTED' | 'DENIED' | 'ACTIVE' }
  | { status: 'PENDING'; reason: string }
  | { status: 'REVOKE_PENDING'; reason: string }
  | { status: 'UNAVAILABLE'; reason: string }
  | { status: 'ERROR'; reason: string };

export const companyPushPreviewPending: CompanyPushStatus = {
  status: 'PENDING',
  reason: 'Previews are off on this device. Server synchronization is pending; rich background notifications may continue until it succeeds.',
};

export const companyPushRevocationPendingStatus: Extract<CompanyPushStatus, { status: 'REVOKE_PENDING' }> = {
  status: 'REVOKE_PENDING',
  reason: 'Mail alerts are off on this device. Server revocation is pending; background notifications may continue until it succeeds.',
};

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

async function relayFetch(path: string, bearer: string | null, init: RequestInit): Promise<Response> {
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
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
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
interface RelayHealth { ready: boolean; previewMode: boolean }

async function relayHealth(): Promise<RelayHealth> {
  const origin = companyPushRelayOrigin();
  if (!origin) return { ready: false, previewMode: false };
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 5_000);
  try {
    // The old webmail fallback issued a cacheable 301 for this path. A fresh
    // probe URL prevents iOS from reusing that redirect after the relay goes live.
    const response = await fetch(`${origin}/v1/push-health?probe=${Date.now().toString(36)}`, {
      method: 'GET', redirect: 'error', signal: abort.signal,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) return { ready: false, previewMode: false };
    const body = await response.json() as Record<string, unknown>;
    return {
      ready: body.status === 'ok',
      // Visible sender/subject text crosses Expo/APNs/FCM. The mail relay
      // must explicitly advertise that it implements this newer contract.
      previewMode: body.previewMode === 'sender-subject-snippet-v1',
    };
  } catch {
    return { ready: false, previewMode: false };
  } finally {
    clearTimeout(timeout);
  }
}

export async function companyPushPreviewAvailable(): Promise<boolean> {
  const health = await relayHealth();
  return health.ready && health.previewMode;
}

export async function companyPushPreviewModeActive(accountId: string): Promise<boolean> {
  const settings = useSettingsStore.getState();
  if (!settings.hydrated || !settings.emailNotificationsEnabled || !settings.notificationPreviewsEnabled ||
      revoking.has(accountId) ||
      generateAccountId(jmapClient.username ?? '', jmapClient.serverUrl ?? '') !== accountId ||
      !isCompanyMailServer(jmapClient.serverUrl ?? '')) return false;
  try {
    const [registration, preferredSubject, tokens] = await Promise.all([
      readRegistration(), preferenceSubject(), jmapClient.getStoredOAuthTokens(accountId),
    ]);
    const current = useSettingsStore.getState();
    return current.hydrated && current.emailNotificationsEnabled && current.notificationPreviewsEnabled &&
      !revoking.has(accountId) &&
      generateAccountId(jmapClient.username ?? '', jmapClient.serverUrl ?? '') === accountId &&
      !!registration?.registrationId && registration.routingVersion === 3 &&
      registration.previews === true && registration.revocationPending !== true &&
      registration.subject === preferredSubject &&
      tokens?.clientId === ZYNDMAIL_COMPANY.clientId &&
      tokens.companyIdentity?.subject === registration.subject;
  } catch {
    return false;
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
      ? { subject: value.subject, registrationId: value.registrationId,
          revocationKey: typeof value.revocationKey === 'string' && REVOCATION_KEY.test(value.revocationKey) ? value.revocationKey : undefined,
          renewedAt: value.renewedAt ?? 0, routingVersion: value.routingVersion, previews: value.previews, revocationPending: value.revocationPending === true }
      : null;
  } catch {
    return null;
  }
}

/** The opaque push cannot name a mailbox. Match its secure installation
 * registration to a saved staff OAuth subject before resolving a tap. */
export async function registeredCompanyPushAccountId(): Promise<string | null> {
  const registration = await readRegistration();
  if (!registration) return null;
  for (const account of useAccountStore.getState().accounts) {
    if (!isCompanyMailServer(account.serverUrl)) continue;
    const tokens = await jmapClient.getStoredOAuthTokens(account.id).catch(() => null);
    if (tokens?.companyIdentity?.subject === registration.subject) return account.id;
  }
  return null;
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
    const updated = await jmapClient.refreshStoredOAuthCredentials(accountId, credentials);
    if (!updated) return null;
    tokens = await jmapClient.getStoredOAuthTokens(accountId);
    if (!tokens) return null;
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

/** Routing remains opaque; visible mail text is bounded and never interpreted as markup. */
export function isCompanyPushPresentation(content: Notifications.NotificationContent): boolean {
  const safe = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 &&
    value.length <= max && !/[\u0000-\u0009\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value);
  return safe(content.title, 160) && safe(content.body, 725) &&
    !content.subtitle && parseCompanyPushPayload(content.data) !== null;
}

export function isGenericCompanyPushPresentation(content: Notifications.NotificationContent): boolean {
  return isCompanyPushPresentation(content) && content.title === 'ZyndMail' &&
    content.body === 'New ZyndPay Mail activity';
}

/** Remove already displayed mail text when alerts are disabled, previews are
 * turned off, or the staff account leaves this device. */
export async function dismissCompanyPushNotifications(): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(presented
      .filter((notification) => parseCompanyPushPayload(notification.request.content.data) !== null)
      .map((notification) => Notifications.dismissNotificationAsync(notification.request.identifier)));
  } catch {
    // The relay revocation and local preference remain the safety boundary.
  }
}

export async function companyPushStatus(accountId: string): Promise<CompanyPushStatus> {
  if (!useSettingsStore.getState().emailNotificationsEnabled) {
    const [registration, tokens] = await Promise.all([
      readRegistration(), jmapClient.getStoredOAuthTokens(accountId).catch(() => null),
    ]);
    return registration?.subject && registration.subject === tokens?.companyIdentity?.subject
      ? companyPushRevocationPendingStatus : { status: 'OFF' };
  }
  const problem = configurationError();
  if (problem) return { status: 'UNAVAILABLE', reason: problem };
  const session = await currentCompanySession(accountId);
  if (!session) return { status: 'UNAVAILABLE', reason: 'Sign in with ZyndPay Staff to enable mail alerts.' };
  const registration = await readRegistration();
  if (registration && registration.subject !== session.subject) {
    return { status: 'ERROR', reason: 'An earlier staff registration must be revoked first.' };
  }
  if (!registration && !(await relayHealth()).ready) return { status: 'UNAVAILABLE', reason: RELAY_UNAVAILABLE };
  if (registration?.revocationPending) return companyPushRevocationPendingStatus;
  if (await preferenceSubject() !== session.subject) return { status: 'OFF' };
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status === 'undetermined') return { status: 'NOT_REQUESTED' };
  if (!permission.granted) return { status: 'DENIED' };
  if (registration?.routingVersion === 3 && registration.previews === true &&
      !useSettingsStore.getState().notificationPreviewsEnabled) {
    return companyPushPreviewPending;
  }
  return registration ? { status: 'ACTIVE' } : { status: 'ERROR', reason: 'Register this device again.' };
}

export async function companyPushPreviewOptOutPending(accountId: string): Promise<boolean> {
  if (useSettingsStore.getState().notificationPreviewsEnabled) return false;
  const [registration, tokens] = await Promise.all([
    readRegistration(),
    jmapClient.getStoredOAuthTokens(accountId).catch(() => null),
  ]);
  return !!registration && registration.routingVersion === 3 && registration.previews === true &&
    registration.revocationPending !== true &&
    registration.subject === tokens?.companyIdentity?.subject;
}

export async function companyPushRevocationPending(accountId: string): Promise<boolean> {
  const [registration, tokens] = await Promise.all([
    readRegistration(), jmapClient.getStoredOAuthTokens(accountId).catch(() => null),
  ]);
  return registration?.revocationPending === true && !!registration.registrationId &&
    registration.subject === tokens?.companyIdentity?.subject;
}

export async function hasPendingCompanyPushRevocation(): Promise<boolean> {
  return (await readRegistration())?.revocationPending === true;
}

async function deleteRegistration(registration: Registration, bearer: string | null): Promise<boolean> {
  if (!bearer && !registration.revocationKey) return false;
  try {
    const response = await relayFetch('v1/device-registrations/current', bearer, {
      method: 'DELETE',
      body: JSON.stringify(bearer
        ? { registrationId: registration.registrationId }
        : { registrationId: registration.registrationId, revocationKey: registration.revocationKey }),
    });
    if (!response.ok && response.status !== 404 && response.status !== 410) return false;
    const current = await readRegistration();
    if (current?.subject === registration.subject && current.registrationId === registration.registrationId) {
      await SecureStore.deleteItemAsync(REGISTRATION_KEY, storageOptions);
    }
    return true;
  } catch {
    return false;
  }
}

const inFlight = new Map<string, { promise: Promise<CompanyPushStatus>; previews: boolean; requestPermission: boolean; force: boolean }>();
const revoking = new Set<string>();

export function registerCompanyPush(accountId: string, requestPermission: boolean, force = false): Promise<CompanyPushStatus> {
  if (revoking.has(accountId)) return Promise.resolve({ status: 'OFF' });
  const previews = useSettingsStore.getState().notificationPreviewsEnabled;
  const existing = inFlight.get(accountId);
  if (existing) {
    if (existing.previews === previews && (!requestPermission || existing.requestPermission) &&
        (!force || existing.force)) return existing.promise;
    return existing.promise.then(() =>
      useSettingsStore.getState().notificationPreviewsEnabled === previews
        ? registerCompanyPush(accountId, requestPermission, force)
        : companyPushStatus(accountId));
  }
  const run = registerCompanyPushInner(accountId, requestPermission, force, previews)
    .catch((error): CompanyPushStatus => ({
      status: 'ERROR', reason: error instanceof Error ? error.message : 'Mail push registration failed.',
    }))
    .finally(() => { if (inFlight.get(accountId)?.promise === run) inFlight.delete(accountId); });
  inFlight.set(accountId, { promise: run, previews, requestPermission, force });
  return run;
}

async function registerCompanyPushInner(accountId: string, requestPermission: boolean, force: boolean, desiredPreviews: boolean): Promise<CompanyPushStatus> {
  const problem = configurationError();
  if (problem) return { status: 'UNAVAILABLE', reason: problem };
  const session = await currentCompanySession(accountId);
  if (!session) return { status: 'UNAVAILABLE', reason: 'Sign in with ZyndPay Staff to enable mail alerts.' };
  let previous = await readRegistration();
  if (previous?.revocationPending && previous.subject !== session.subject) {
    if (await reconcilePendingCompanyPushRevocation()) {
      return { status: 'UNAVAILABLE', reason: 'The previous staff registration is awaiting server revocation. Retry when the mail relay is available.' };
    }
    previous = await readRegistration();
  }
  if (previous && previous.subject !== session.subject) {
    // One installation has one staff registration. Switching staff identities
    // must retire the earlier subject before enrolling the new one.
    const oldIds = useAccountStore.getState().accounts
      .filter((account) => account.id !== accountId && isCompanyMailServer(account.serverUrl))
      .map((account) => account.id);
    let revoked = false;
    for (const oldId of oldIds) {
      const tokens = await jmapClient.getStoredOAuthTokens(oldId).catch(() => null);
      if (tokens?.companyIdentity?.subject !== previous.subject) continue;
      revoked = await revokeCompanyPush(oldId);
      break;
    }
    if (!revoked) {
      return { status: 'ERROR', reason: 'The previous staff registration could not be revoked. Retry when the mail relay is available.' };
    }
    previous = await readRegistration();
  }
  if (!useSettingsStore.getState().emailNotificationsEnabled) return { status: 'OFF' };
  if (!requestPermission && await preferenceSubject() !== session.subject) return { status: 'OFF' };
  const health = await relayHealth();
  if (!health.ready) return { status: 'UNAVAILABLE', reason: RELAY_UNAVAILABLE };
  const previews = health.previewMode && desiredPreviews;
  const routingVersion = health.previewMode ? 3 : 2;
  if (previous?.previews === previews && previous?.routingVersion === routingVersion && !force && !requestPermission && Date.now() - previous.renewedAt < RENEW_AFTER_MS) return companyPushStatus(accountId);
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('mail-activity', {
      name: 'Mail activity',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      showBadge: false,
    });
    if (health.previewMode) await Notifications.setNotificationChannelAsync('mail-messages-v2', {
      name: 'New mail',
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: true,
      sound: 'default',
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
        ...(health.previewMode ? { previews } : {}),
      }),
    });
    if (!response.ok) throw new Error(`Mail push registration failed (${response.status}).`);
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.registrationId !== 'string' || !body.registrationId) {
      throw new Error('The mail relay returned an invalid registration.');
    }
    const registration: Registration = {
      subject: session.subject, registrationId: body.registrationId,
      ...(typeof body.revocationKey === 'string' && REVOCATION_KEY.test(body.revocationKey)
        ? { revocationKey: body.revocationKey }
        : previous?.registrationId === body.registrationId && previous.revocationKey
          ? { revocationKey: previous.revocationKey }
          : {}),
      renewedAt: Date.now(), routingVersion, previews,
    };
    await SecureStore.setItemAsync(REGISTRATION_KEY, JSON.stringify(registration), storageOptions);
    if (generateAccountId(jmapClient.username ?? '', jmapClient.serverUrl ?? '') !== accountId) {
      await SecureStore.setItemAsync(REGISTRATION_KEY, JSON.stringify({ ...registration, revocationPending: true }), storageOptions);
      if (!await deleteRegistration(registration, session.bearer)) await deleteRegistration(registration, null);
      return { status: 'ERROR', reason: 'The active mail account changed during registration.' };
    }
    await SecureStore.setItemAsync(PREFERENCE_KEY, session.subject, storageOptions);
    return { status: 'ACTIVE' };
  } catch (error) {
    return { status: 'ERROR', reason: error instanceof Error ? error.message : 'Mail push registration failed.' };
  }
}

export async function revokeCompanyPush(accountId: string): Promise<boolean> {
  revoking.add(accountId);
  try {
    const tokens = await jmapClient.getStoredOAuthTokens(accountId).catch(() => null);
    const subject = tokens?.companyIdentity?.subject;
    const initialRegistration = await readRegistration();
    if (subject && initialRegistration?.subject === subject) {
      await dismissCompanyPushNotifications();
    }
    const pending = inFlight.get(accountId)?.promise;
    if (pending) await pending.catch(() => undefined);
    const registration = await readRegistration();
    if (subject && registration?.subject === subject) {
      await SecureStore.setItemAsync(REGISTRATION_KEY, JSON.stringify({ ...registration, revocationPending: true }), storageOptions);
      await dismissCompanyPushNotifications();
    }
    if (subject && await preferenceSubject() === subject) {
      await SecureStore.deleteItemAsync(PREFERENCE_KEY, storageOptions);
    }
    if (!registration || registration.subject !== subject) return true;
    const isActiveOwner = generateAccountId(jmapClient.username ?? '', jmapClient.serverUrl ?? '') === accountId;
    if (!isActiveOwner && registration.revocationKey) return deleteRegistration(registration, null);
    const session = await storedCompanySession(accountId).catch(() => null);
    if (session?.subject === registration.subject && await deleteRegistration(registration, session.bearer)) return true;
    return deleteRegistration(registration, null);
  } finally {
    revoking.delete(accountId);
  }
}

export async function reconcilePendingCompanyPushRevocation(): Promise<boolean> {
  const registration = await readRegistration();
  if (!registration?.revocationPending) return false;
  if (registration.revocationKey) {
    await deleteRegistration(registration, null);
  } else {
    for (const account of useAccountStore.getState().accounts) {
      if (!isCompanyMailServer(account.serverUrl)) continue;
      const tokens = await jmapClient.getStoredOAuthTokens(account.id).catch(() => null);
      if (tokens?.companyIdentity?.subject !== registration.subject) continue;
      await revokeCompanyPush(account.id);
      break;
    }
  }
  return hasPendingCompanyPushRevocation();
}

export async function reconcileCompanyPush(accountId: string): Promise<CompanyPushStatus> {
  const enabled = useSettingsStore.getState().emailNotificationsEnabled;
  if (!enabled || await companyPushRevocationPending(accountId)) {
    if (!await revokeCompanyPush(accountId)) return companyPushRevocationPendingStatus;
    if (!enabled) return { status: 'OFF' };
  }
  return registerCompanyPush(accountId, false, true);
}

export type CompanyPushDestination = { target: 'INBOX' } | {
  target: 'EMAIL'; accountId: string; emailId: string; threadId: string;
};

export type CompanyPushReferenceTarget = { target: 'INBOX' } | {
  target: 'ACCOUNT'; accountId: string;
} | { target: 'MESSAGE'; accountId: string; emailId: string };

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

/** Accept the documented relay response and the older EMAIL shape; always
 * verify the message and thread against JMAP before navigating. */
export function parseCompanyPushDestination(value: unknown): CompanyPushReferenceTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (result.target === 'INBOX' && Object.keys(result).length === 1) return { target: 'INBOX' };
  if (result.target === 'ACCOUNT' && Object.keys(result).length === 2 && validIdentifier(result.accountId)) {
    return { target: 'ACCOUNT', accountId: result.accountId };
  }
  if (result.target === 'MESSAGE' && Object.keys(result).length === 3 &&
      validIdentifier(result.accountId) && validIdentifier(result.emailId)) {
    return { target: 'MESSAGE', accountId: result.accountId, emailId: result.emailId };
  }
  if (result.target === 'EMAIL' && Object.keys(result).length === 4 &&
      validIdentifier(result.accountId) && validIdentifier(result.emailId) && validIdentifier(result.threadId)) {
    return { target: 'MESSAGE', accountId: result.accountId, emailId: result.emailId };
  }
  return null;
}

export async function resolveCompanyPush(accountId: string, value: unknown): Promise<CompanyPushDestination | null> {
  const payload = parseCompanyPushPayload(value);
  if (!payload) return null;
  const session = await currentCompanySession(accountId).catch(() => null);
  const registration = await readRegistration();
  if (!session || !registration || registration.subject !== session.subject) return null;
  try {
    const response = await relayFetch('v1/notification-references/resolve', session.bearer, {
      method: 'POST',
      body: JSON.stringify({ installationId: await installationId(), notificationRef: payload.notificationRef }),
    });
    if (response.status === 404 || response.status === 410) return { target: 'INBOX' };
    if (!response.ok) return null;
    const result = await response.json() as Record<string, unknown>;
    const target = parseCompanyPushDestination(result);
    if (!target) return null;
    if (target.target !== 'MESSAGE') return { target: 'INBOX' };
    const [email] = await getEmails([target.emailId], target.accountId);
    if (!email) return { target: 'INBOX' };
    return {
      target: 'EMAIL', accountId: target.accountId, emailId: email.id, threadId: email.threadId,
    };
  } catch {
    return null;
  }
}
