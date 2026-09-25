import type { EmailAddress, Identity } from '../api/types';
import { generateSubAddress } from './sub-addressing';
import { sanitizeDisplayName } from './rfc5322-mailbox';
// Synced byte-for-byte from zyndpay/frontend/libs/shared/mail-core/src/sender-display.ts.
// Run `node scripts/sync-sender-display.mjs --check` from this native repo
// when the sibling ZyndPay workspace is present.
import { senderDisplayName } from '../vendor/mail-core/sender-display';

export { senderDisplayName };

export function identityPickerDisplayName(identity: Identity): string {
  return senderDisplayName(identity.email, sanitizeDisplayName(identity.name));
}

/** Only the visible From name is governed. JMAP identity selection stays with the caller. */
export function resolveOutboundSender(
  identity: Identity,
  options: {
    fromOverride?: { name: string; email: string } | null;
    subAddressTag?: string;
    subAddressDelimiter?: string;
  } = {},
): { from: EmailAddress; envelopeMailFrom?: string } {
  const overrideEmail = options.fromOverride?.email.trim();
  const email = overrideEmail
    || (options.subAddressTag
      ? generateSubAddress(identity.email, options.subAddressTag, options.subAddressDelimiter)
      : identity.email);
  const configuredName = overrideEmail
    ? options.fromOverride?.name
    : identity.name;
  // A tagged identity retains the governed label of its base identity.
  const policyEmail = overrideEmail || identity.email;
  const name = senderDisplayName(policyEmail, sanitizeDisplayName(configuredName));
  const from: EmailAddress = name ? { name, email } : { email };
  const envelopeMailFrom = email.toLowerCase() !== identity.email.toLowerCase()
    ? identity.email
    : undefined;
  return { from, envelopeMailFrom };
}
