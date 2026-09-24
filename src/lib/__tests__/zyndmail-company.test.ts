import { describe, expect, it } from 'vitest';
import {
  ZYNDMAIL_COMPANY,
  isCompanyMailServer,
  validateCompanyAccessToken,
  validateCompanyIdToken,
  validateCompanyMetadata,
  validateCompanyTokenEndpoint,
} from '../zyndmail-company';

function jwt(payload: Record<string, unknown>): string {
  return `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify(payload)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}.signature`;
}

const future = Math.floor(Date.now() / 1000) + 3600;
const access = () => jwt({
  iss: ZYNDMAIL_COMPANY.issuer,
  aud: ['account', ZYNDMAIL_COMPANY.audience],
  sub: 'staff-123',
  exp: future,
});

describe('ZyndPay Staff mail boundary', () => {
  it('uses a candidate client and callback distinct from the installed ZyndMail app', () => {
    expect(ZYNDMAIL_COMPANY.clientId).toBe('zyndmail-mobile');
    expect(ZYNDMAIL_COMPANY.redirectUri).toBe('zyndmail://oauth/callback');
  });

  it('matches only the configured company mail origin', () => {
    expect(isCompanyMailServer('https://mail.zyndpay.io/')).toBe(true);
    expect(isCompanyMailServer('https://mail.zyndpay.io.evil.example')).toBe(false);
    expect(isCompanyMailServer('http://mail.zyndpay.io')).toBe(false);
    expect(isCompanyMailServer('https://mail.zyndpay.io/other')).toBe(false);
    expect(isCompanyMailServer('https://mail.zyndpay.io/.well-known/jmap')).toBe(false);
    expect(isCompanyMailServer('https://mail.zyndpay.io/?next=https://evil.example')).toBe(false);
    expect(isCompanyMailServer('https://mail.zyndpay.io:8443/')).toBe(false);
  });

  it('pins discovery to the exact staff issuer and its HTTPS origin', () => {
    const metadata = {
      issuer: ZYNDMAIL_COMPANY.issuer,
      authorization_endpoint: `${ZYNDMAIL_COMPANY.issuer}/protocol/openid-connect/auth`,
      token_endpoint: `${ZYNDMAIL_COMPANY.issuer}/protocol/openid-connect/token`,
      revocation_endpoint: `${ZYNDMAIL_COMPANY.issuer}/protocol/openid-connect/revoke`,
    };
    expect(() => validateCompanyMetadata(metadata)).not.toThrow();
    expect(() => validateCompanyMetadata({ ...metadata, issuer: 'https://other.example' })).toThrow();
    expect(() => validateCompanyMetadata({ ...metadata, token_endpoint: 'https://evil.example/token' })).toThrow();
    expect(() => validateCompanyMetadata({ ...metadata, authorization_endpoint: 'http://webmail.zyndpay.io/auth' })).toThrow();
  });

  it('allows only the approved mobile or company webmail client at the pinned token endpoint', () => {
    expect(() => validateCompanyTokenEndpoint(ZYNDMAIL_COMPANY.tokenEndpoint, ZYNDMAIL_COMPANY.clientId)).not.toThrow();
    expect(() => validateCompanyTokenEndpoint(ZYNDMAIL_COMPANY.tokenEndpoint, 'zyndmail-native-preview')).toThrow();
    expect(() => validateCompanyTokenEndpoint(ZYNDMAIL_COMPANY.tokenEndpoint, 'bulwark-webmail')).not.toThrow();
    expect(() => validateCompanyTokenEndpoint('https://evil.example/token', 'bulwark-webmail')).toThrow();
    expect(() => validateCompanyTokenEndpoint(ZYNDMAIL_COMPANY.tokenEndpoint, 'unapproved-client')).toThrow();
  });

  it('rejects a stale, foreign-audience or changed-subject access token', () => {
    expect(validateCompanyAccessToken(access()).subject).toBe('staff-123');
    expect(() => validateCompanyAccessToken(access(), 'other-staff')).toThrow();
    expect(() => validateCompanyAccessToken(jwt({ iss: ZYNDMAIL_COMPANY.issuer, aud: 'other', sub: 'staff-123', exp: future }))).toThrow();
    expect(() => validateCompanyAccessToken(jwt({ iss: ZYNDMAIL_COMPANY.issuer, aud: 'stalwart', sub: 'staff-123', exp: 1 }))).toThrow();
  });

  it('binds the identity token to the login nonce and mobile client', () => {
    const id = jwt({ iss: ZYNDMAIL_COMPANY.issuer, aud: ZYNDMAIL_COMPANY.clientId, sub: 'staff-123', nonce: 'one-time', exp: future });
    expect(() => validateCompanyIdToken(id, 'one-time', 'staff-123')).not.toThrow();
    expect(() => validateCompanyIdToken(id, 'different', 'staff-123')).toThrow();
    expect(() => validateCompanyIdToken(id, 'one-time', 'other-staff')).toThrow();
  });
});
