import type { JMAPMethodCall } from '../api/types';
import { isCompanyMailServer } from './zyndmail-company';

/** Scope the client guard to the account being used, including detached accounts. */
export function hasCompanyNoDeletePolicy(
  credentials: { serverUrl: string; companyIdentity?: unknown } | null | undefined,
): boolean {
  return !!credentials && (isCompanyMailServer(credentials.serverUrl) || !!credentials.companyIdentity);
}

export function assertCompanyDeleteActionAllowed(noDelete: boolean): void {
  if (noDelete) throw new Error('Mail deletion is disabled by your organization');
}

/** Keep destructive folder affordances aligned with the company request guard. */
export function canOfferEmptyFolder(
  noDelete: boolean,
  role: string | null | undefined,
  inJunk: boolean,
  hasMessages: boolean,
): boolean {
  return !noDelete && (role === 'trash' || inJunk) && hasMessages;
}

/** A company account must never ask JMAP to destroy mail or a mailbox. */
export function assertMailDeletionAllowed(
  methodCalls: JMAPMethodCall[],
  noDelete: boolean,
): void {
  if (!noDelete) return;

  for (const [method, args] of methodCalls) {
    if (method === 'EmailSubmission/set' && 'onSuccessDestroyEmail' in args) {
      throw new Error('Mail deletion is disabled by your organization');
    }
    if (method !== 'Email/set' && method !== 'Mailbox/set') continue;
    if ('destroy' in args || '#destroy' in args) {
      throw new Error('Mail deletion is disabled by your organization');
    }
  }
}
