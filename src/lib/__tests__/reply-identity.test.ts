import { describe, it, expect } from 'vitest';
import { findReplyIdentityId, findDraftIdentityId, resolveReplyFrom, findComposeIdentityId } from '../reply-identity';
import type { Identity } from '../../api/types';

const identities: Identity[] = [
  { id: 'main', name: 'Me', email: 'me@example.com', mayDelete: false },
  { id: 'alias', name: 'Alias', email: 'me@example.com', mayDelete: true },
  { id: 'info', name: 'Info', email: 'info@example.com', mayDelete: true },
];

describe('findReplyIdentityId', () => {
  it('matches exact address across to/cc/bcc', () => {
    expect(findReplyIdentityId(identities, { bcc: [{ email: 'INFO@example.com' }] })).toBe('info');
  });

  it('falls back to the +tag-stripped address', () => {
    expect(findReplyIdentityId(identities, { to: [{ email: 'info+news@example.com' }] })).toBe('info');
  });

  it('returns null when nothing matches', () => {
    expect(findReplyIdentityId(identities, { to: [{ email: 'x@other.com' }] })).toBeNull();
    expect(findReplyIdentityId([], { to: [{ email: 'me@example.com' }] })).toBeNull();
  });
});

describe('findComposeIdentityId', () => {
  it('matches the account address', () => {
    expect(findComposeIdentityId(identities, 'info+x@example.com')).toBe('info');
    expect(findComposeIdentityId(identities, undefined)).toBeNull();
  });
});

describe('findDraftIdentityId', () => {
  it('disambiguates by name when two identities share an address', () => {
    expect(findDraftIdentityId(identities, { email: 'me@example.com', name: 'Alias' })).toBe('alias');
    expect(findDraftIdentityId(identities, { email: 'me@example.com', name: 'Someone' })).toBe('main');
  });

  it('restores a uniquely branded HQ personal identity from a saved draft', () => {
    const company = [
      { id: 'main', name: 'Alex Doe', email: 'alex@zyndpay.io' },
      { id: 'alias', name: 'Alex Legal', email: 'alex@zyndpay.io' },
    ] as Identity[];
    expect(findDraftIdentityId(company, { email: 'alex@zyndpay.io', name: 'Alex Legal | ZyndPay' })).toBe('alias');
  });
});

describe('resolveReplyFrom', () => {
  it('returns the identity without override on an exact match', () => {
    expect(resolveReplyFrom(identities, { to: [{ email: 'info@example.com' }] })).toEqual({ identityId: 'info' });
  });

  it('proposes a catch-all From override on an owned domain', () => {
    expect(resolveReplyFrom(identities, { to: [{ email: 'sales@example.com', name: 'Sales' }] })).toEqual({
      identityId: 'main',
      overrideEmail: 'sales@example.com',
      overrideName: 'Sales',
    });
  });

  it('returns null for foreign domains', () => {
    expect(resolveReplyFrom(identities, { to: [{ email: 'x@other.com' }] })).toBeNull();
  });
});
