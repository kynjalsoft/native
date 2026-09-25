import { describe, expect, it } from 'vitest';
import type { Identity } from '../../api/types';
import { identityPickerDisplayName, resolveOutboundSender } from '../outbound-sender';

const identity = (id: string, email: string, name: string): Identity => ({
  id, email, name, mayDelete: false,
});

describe('governed mobile From presentation', () => {
  it('uses the configured full human name for HQ personal identities', () => {
    const person = identity('person-id', 'alex@zyndpay.io', 'Alex Doe');
    expect(identityPickerDisplayName(person)).toBe('Alex Doe | ZyndPay');
    expect(resolveOutboundSender(person).from).toEqual({ name: 'Alex Doe | ZyndPay', email: person.email });
    expect(resolveOutboundSender(identity('id', person.email, 'Alex Doe | ZyndPay')).from.name)
      .toBe('Alex Doe | ZyndPay');
  });

  it('uses the canonical role label for a shared address, never the delegate name', () => {
    const support = identity('delegate-id', 'SUPPORT@ZYNDPAY.IO', 'Alex Doe');
    expect(identityPickerDisplayName(support)).toBe('ZyndPay Support');
    expect(resolveOutboundSender(support).from).toEqual({ name: 'ZyndPay Support', email: support.email });
    expect(identityPickerDisplayName(identity('sales-id', 'sales@zyndpay.io', 'Alex Doe')))
      .toBe('ZyndPay Sales');
  });

  it('governs a catch-all role override but keeps the submitting identity and envelope separate', () => {
    const delegate = identity('delegate-id', 'alex@zyndpay.io', 'Alex Doe');
    expect(resolveOutboundSender(delegate, {
      fromOverride: { email: 'support@zyndpay.io', name: 'Alex Doe' },
    })).toEqual({
      from: { email: 'support@zyndpay.io', name: 'ZyndPay Support' },
      envelopeMailFrom: 'alex@zyndpay.io',
    });
  });

  it('uses the base identity label for a tagged sender address', () => {
    const support = identity('support-id', 'support@zyndpay.io', 'Delegate');
    expect(resolveOutboundSender(support, { subAddressTag: 'case', subAddressDelimiter: '+' })).toEqual({
      from: { email: 'support+case@zyndpay.io', name: 'ZyndPay Support' },
      envelopeMailFrom: 'support@zyndpay.io',
    });
  });

  it('leaves country, franchise and external configured names unchanged', () => {
    for (const email of ['agent@ci.zyndpay.io', 'person@example.org']) {
      expect(resolveOutboundSender(identity(email, email, 'Agent Name')).from.name).toBe('Agent Name');
      expect(identityPickerDisplayName(identity(email, email, 'Agent Name'))).toBe('Agent Name');
    }
    expect(identityPickerDisplayName(identity('network', 'network@franchise.zyndpay.io', 'Delegate')))
      .toBe('ZyndPay Network');
  });

  it('sanitizes a configured mailbox string before building the visible name', () => {
    expect(resolveOutboundSender(identity('id', 'alex@zyndpay.io', 'Alex Doe <alex@zyndpay.io>')).from.name)
      .toBe('Alex Doe | ZyndPay');
  });
});
