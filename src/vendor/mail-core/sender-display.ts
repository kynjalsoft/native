/**
 * Outbound names for the governed HQ identities. This changes only the
 * human-readable From name, never the identity id, address or account used
 * for JMAP submission. Other organizations keep their configured names.
 */
const HQ_ROLE_NAMES: Readonly<Record<string, string>> = {
  'admin@zyndpay.io': 'ZyndPay Administration',
  'people@zyndpay.io': 'ZyndPay People',
  'finance@zyndpay.io': 'ZyndPay Finance',
  'hello@zyndpay.io': 'ZyndPay',
  'support@zyndpay.io': 'ZyndPay Support',
  'sales@zyndpay.io': 'ZyndPay Sales',
  'legal@zyndpay.io': 'ZyndPay Legal',
  'treasury@zyndpay.io': 'ZyndPay Treasury',
  'compliance@zyndpay.io': 'ZyndPay Compliance',
  'privacy@zyndpay.io': 'ZyndPay Privacy',
  'abuse@zyndpay.io': 'ZyndPay Abuse',
  'postmaster@zyndpay.io': 'ZyndPay Postmaster',
  'dmarc@zyndpay.io': 'ZyndPay DMARC',
  'network@franchise.zyndpay.io': 'ZyndPay Network',
};

export function senderDisplayName(
  email: string,
  configuredName: string | null | undefined,
): string {
  const address = email.trim().toLowerCase();
  const roleName = HQ_ROLE_NAMES[address];
  if (roleName) return roleName;

  const name = Array.from(configuredName ?? '', (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? ' ' : character;
  })
    .join('')
    .trim()
    .replace(/\s+/g, ' ');
  if (!address.endsWith('@zyndpay.io')) return name;
  if (!name) return 'ZyndPay';
  return /\|\s*ZyndPay$/i.test(name) ? name : `${name} | ZyndPay`;
}
