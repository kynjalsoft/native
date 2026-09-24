import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openAuthSessionAsync, secureFetch } = vi.hoisted(() => ({
  openAuthSessionAsync: vi.fn(),
  secureFetch: vi.fn(),
}));
vi.mock('expo-web-browser', () => ({ openAuthSessionAsync, maybeCompleteAuthSession: vi.fn() }));
vi.mock('../client-cert', () => ({ secureFetch }));

import { loginWithPkce, type OAuthMetadata } from '../oauth-native';
import { ZYNDMAIL_COMPANY } from '../zyndmail-company';

function jwt(payload: Record<string, unknown>): string {
  return `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify(payload)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}.signature`;
}

const metadata: OAuthMetadata = {
  issuer: ZYNDMAIL_COMPANY.issuer,
  authorization_endpoint: `${ZYNDMAIL_COMPANY.issuer}/protocol/openid-connect/auth`,
  token_endpoint: `${ZYNDMAIL_COMPANY.issuer}/protocol/openid-connect/token`,
  revocation_endpoint: `${ZYNDMAIL_COMPANY.issuer}/protocol/openid-connect/revoke`,
};
const options = {
  company: true,
  clientId: ZYNDMAIL_COMPANY.clientId,
  redirectUri: ZYNDMAIL_COMPANY.redirectUri,
  scopes: 'openid profile email',
};

describe('company authorization code flow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the registered mobile client, PKCE and nonce before accepting tokens', async () => {
    openAuthSessionAsync.mockImplementation(async (authorizationUrl: string, redirectUri: string) => {
      const params = new URL(authorizationUrl).searchParams;
      expect(params.get('client_id')).toBe(ZYNDMAIL_COMPANY.clientId);
      expect(params.get('redirect_uri')).toBe(ZYNDMAIL_COMPANY.redirectUri);
      expect(params.get('code_challenge_method')).toBe('S256');
      const nonce = params.get('nonce');
      secureFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: jwt({ iss: ZYNDMAIL_COMPANY.issuer, aud: 'stalwart', sub: 'staff-123', exp: Math.floor(Date.now() / 1000) + 3600 }),
          id_token: jwt({ iss: ZYNDMAIL_COMPANY.issuer, aud: ZYNDMAIL_COMPANY.clientId, sub: 'staff-123', nonce, exp: Math.floor(Date.now() / 1000) + 3600 }),
          refresh_token: 'rotating-refresh-token',
        }),
      } as Response);
      return { type: 'success', url: `${redirectUri}?code=one-time-code&state=${params.get('state')}` };
    });

    const tokens = await loginWithPkce(ZYNDMAIL_COMPANY.mailOrigin, metadata, options);
    expect(tokens.companyIdentity?.subject).toBe('staff-123');
    expect(tokens.refreshToken).toBe('rotating-refresh-token');
    expect(secureFetch).toHaveBeenCalledWith(metadata.token_endpoint, expect.objectContaining({ method: 'POST' }));
  });

  it('rejects an altered issuer before opening the browser', async () => {
    await expect(loginWithPkce(ZYNDMAIL_COMPANY.mailOrigin, { ...metadata, issuer: 'https://evil.example' }, options)).rejects.toThrow('issuer');
    expect(openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it('rejects a callback to another app address before exchanging the code', async () => {
    openAuthSessionAsync.mockResolvedValueOnce({ type: 'success', url: 'zyndmailpreview://oauth/callback?code=attacker' });
    await expect(loginWithPkce(ZYNDMAIL_COMPANY.mailOrigin, metadata, options)).rejects.toThrow('unexpected app address');
    expect(secureFetch).not.toHaveBeenCalled();
  });
});
