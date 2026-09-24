import { describe, expect, it } from 'vitest';
import { assertMailDeletionAllowed, hasCompanyNoDeletePolicy } from '../zyndmail-mail-policy';
import type { JMAPMethodCall } from '../../api/types';

const call = (name: string, args: Record<string, unknown>): JMAPMethodCall => [name, args, '0'];

describe('company no-delete mail policy', () => {
  it('applies per company account without restricting a public account in the same app', () => {
    expect(hasCompanyNoDeletePolicy({ serverUrl: 'https://mail.zyndpay.io' })).toBe(true);
    expect(hasCompanyNoDeletePolicy({ serverUrl: 'https://mail.zyndpay.io.evil.example' })).toBe(false);
    expect(hasCompanyNoDeletePolicy({ serverUrl: 'https://mail.example.com' })).toBe(false);
    expect(hasCompanyNoDeletePolicy({ serverUrl: 'https://mail.example.com', companyIdentity: { subject: 'staff' } })).toBe(true);
  });
  it('rejects direct and result-referenced Email/set destruction', () => {
    expect(() => assertMailDeletionAllowed([call('Email/set', { accountId: 'a', destroy: ['e'] })], true)).toThrow(/disabled/);
    expect(() => assertMailDeletionAllowed([call('Email/set', { accountId: 'a', '#destroy': { resultOf: 'q' } })], true)).toThrow(/disabled/);
  });

  it('rejects mailbox destruction while permitting non-destructive mail operations', () => {
    expect(() => assertMailDeletionAllowed([call('Mailbox/set', { accountId: 'a', destroy: ['m'] })], true)).toThrow(/disabled/);
    expect(() => assertMailDeletionAllowed([call('EmailSubmission/set', { onSuccessDestroyEmail: ['e'] })], true)).toThrow(/disabled/);
    expect(() => assertMailDeletionAllowed([
      call('Email/set', { accountId: 'a', update: { e: { 'keywords/$seen': true } } }),
      call('EmailSubmission/set', { accountId: 'a', create: { s: { emailId: 'e' } } }),
    ], true)).not.toThrow();
  });

  it('leaves generic Bulwark behavior unchanged when company mode is off', () => {
    expect(() => assertMailDeletionAllowed([call('Email/set', { destroy: ['e'] })], false)).not.toThrow();
  });
});
