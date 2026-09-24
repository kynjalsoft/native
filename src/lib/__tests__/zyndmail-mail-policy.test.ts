import { describe, expect, it } from 'vitest';
import { assertMailDeletionAllowed } from '../zyndmail-mail-policy';
import type { JMAPMethodCall } from '../../api/types';

const call = (name: string, args: Record<string, unknown>): JMAPMethodCall => [name, args, '0'];

describe('company no-delete mail policy', () => {
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
