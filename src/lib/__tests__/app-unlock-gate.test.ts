import { describe, expect, it } from 'vitest';
import { AppUnlockGate, shouldHideMailForAppState } from '../app-unlock-gate';

describe('mailbox device unlock', () => {
  it('covers the app-switcher snapshot without treating Face ID inactivity as a lock', () => {
    expect(shouldHideMailForAppState('inactive')).toBe(true);
    expect(shouldHideMailForAppState('background')).toBe(true);
    expect(shouldHideMailForAppState('active')).toBe(false);
  });
  it('waits for focus after Face ID makes iOS inactive', () => {
    const gate = new AppUnlockGate();
    const attempt = gate.begin();
    expect(gate.verified(attempt, 'inactive')).toBe(false);
    expect(gate.active()).toBe(true);
    expect(gate.active()).toBe(false);
  });

  it('rejects late Face ID success after the app backgrounds', () => {
    const gate = new AppUnlockGate();
    const attempt = gate.begin();
    gate.background();
    expect(gate.verified(attempt, 'active')).toBe(false);
    expect(gate.active()).toBe(false);
  });

  it('does not carry a canceled or old success into a new attempt', () => {
    const gate = new AppUnlockGate();
    const old = gate.begin();
    expect(gate.verified(old, 'inactive')).toBe(false);
    gate.cancel();
    expect(gate.active()).toBe(false);
    gate.background();
    const next = gate.begin();
    expect(gate.isCurrent(old)).toBe(false);
    expect(gate.verified(next, 'active')).toBe(true);
  });
});


describe('mailbox return window', () => {
  it('preserves a verified unlock across a brief link or app switch', () => {
    const gate = new AppUnlockGate();
    gate.verified(gate.begin(), 'active');
    gate.background(1_000);
    gate.active(6_000);
    expect(gate.isLocked).toBe(false);
  });

  it('requires verification after a minute away, but never times out active reading', () => {
    const gate = new AppUnlockGate();
    gate.verified(gate.begin(), 'active');
    gate.active(600_000);
    expect(gate.isLocked).toBe(false);
    gate.background(600_000);
    gate.active(660_000);
    expect(gate.isLocked).toBe(true);
  });

  it('does not extend the return window on duplicate background events', () => {
    const gate = new AppUnlockGate();
    gate.verified(gate.begin(), 'active');
    gate.background(1_000);
    gate.background(59_000);
    gate.active(61_000);
    expect(gate.isLocked).toBe(true);
  });

  it('never grants a return window to an unverified launch or pending Face ID result', () => {
    const gate = new AppUnlockGate();
    gate.background(1_000);
    gate.active(2_000);
    expect(gate.isLocked).toBe(true);
    const attempt = gate.begin();
    gate.verified(attempt, 'inactive');
    gate.background(3_000);
    gate.active(4_000);
    expect(gate.isLocked).toBe(true);
    expect(gate.verified(attempt, 'active')).toBe(false);
  });

  it('invalidates an in-flight verification on sign-out', () => {
    const gate = new AppUnlockGate();
    const attempt = gate.begin();
    gate.cancel();
    expect(gate.verified(attempt, 'active')).toBe(false);
    expect(gate.isLocked).toBe(true);
  });

  it('fails closed if the clock moves backwards while away', () => {
    const gate = new AppUnlockGate();
    gate.verified(gate.begin(), 'active');
    gate.background(2_000);
    gate.active(1_000);
    expect(gate.isLocked).toBe(true);
  });
});
