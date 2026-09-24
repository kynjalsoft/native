import type { JMAPMethodCall } from '../api/types';

/** A company build must never ask JMAP to destroy mail or a mailbox. */
export function assertMailDeletionAllowed(
  methodCalls: JMAPMethodCall[],
  noDelete = process.env.EXPO_PUBLIC_ZYNDMAIL_NO_DELETE === '1',
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
