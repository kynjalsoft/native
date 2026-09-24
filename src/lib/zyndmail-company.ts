/** Public connection details for the company mailbox, never credentials. */
export const ZYNDMAIL_COMPANY = {
  mailOrigin: 'https://mail.zyndpay.io',
  issuer: 'https://webmail.zyndpay.io/auth/realms/zyndpay-staff',
  clientId: 'zyndmail-native-preview',
  audience: 'stalwart',
  redirectUri: 'zyndmailpreview://oauth/callback',
  tokenEndpoint: 'https://webmail.zyndpay.io/auth/realms/zyndpay-staff/protocol/openid-connect/token',
} as const;

export interface CompanyIdentity {
  issuer: string;
  audience: string;
  subject: string;
}

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

export function isCompanyMailServer(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === ZYNDMAIL_COMPANY.mailOrigin &&
      !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === '/';
  } catch {
    return false;
  }
}

export function validateCompanyMetadata(metadata: {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
}): void {
  if (metadata.issuer !== ZYNDMAIL_COMPANY.issuer) {
    throw new Error('ZyndPay Staff identity issuer did not match.');
  }
  const expected = originOf(ZYNDMAIL_COMPANY.issuer);
  for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.revocation_endpoint]) {
    if (!endpoint || originOf(endpoint) !== expected) {
      throw new Error('ZyndPay Staff identity endpoint is not trusted.');
    }
  }
  if (metadata.token_endpoint !== ZYNDMAIL_COMPANY.tokenEndpoint) {
    throw new Error('ZyndPay Staff token endpoint did not match.');
  }
}

export function validateCompanyTokenEndpoint(tokenEndpoint: string, clientId: string): void {
  if (
    tokenEndpoint !== ZYNDMAIL_COMPANY.tokenEndpoint ||
    ![ZYNDMAIL_COMPANY.clientId, 'bulwark-webmail'].includes(clientId)
  ) {
    throw new Error('ZyndPay Staff token exchange is not trusted.');
  }
}

function payloadOf(token: string): Record<string, unknown> {
  const pieces = token.split('.');
  if (pieces.length !== 3) throw new Error('ZyndPay Staff returned an invalid token.');
  try {
    const base64 = pieces[1].replaceAll('-', '+').replaceAll('_', '/');
    return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as Record<string, unknown>;
  } catch {
    throw new Error('ZyndPay Staff returned an unreadable token.');
  }
}

function hasAudience(value: unknown, expected: string): boolean {
  return (Array.isArray(value) ? value : [value]).includes(expected);
}

export function validateCompanyAccessToken(token: string, expectedSubject?: string): CompanyIdentity & { expiresAt: number } {
  const payload = payloadOf(token);
  if (payload.iss !== ZYNDMAIL_COMPANY.issuer || !hasAudience(payload.aud, ZYNDMAIL_COMPANY.audience)) {
    throw new Error('The access token is not authorized for ZyndPay Mail.');
  }
  if (typeof payload.sub !== 'string' || !payload.sub || (expectedSubject && payload.sub !== expectedSubject)) {
    throw new Error('The ZyndPay Staff identity changed.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= Date.now() / 1000) {
    throw new Error('ZyndPay Staff returned an expired token.');
  }
  return {
    issuer: ZYNDMAIL_COMPANY.issuer,
    audience: ZYNDMAIL_COMPANY.audience,
    subject: payload.sub,
    expiresAt: payload.exp * 1000,
  };
}

export function validateCompanyIdToken(token: string | undefined, nonce: string, subject: string): void {
  if (!token) throw new Error('ZyndPay Staff did not return an identity token.');
  const payload = payloadOf(token);
  if (
    payload.iss !== ZYNDMAIL_COMPANY.issuer ||
    !hasAudience(payload.aud, ZYNDMAIL_COMPANY.clientId) ||
    payload.nonce !== nonce ||
    payload.sub !== subject ||
    typeof payload.exp !== 'number' || payload.exp <= Date.now() / 1000
  ) {
    throw new Error('The ZyndPay Staff identity response could not be bound to this sign-in.');
  }
}
