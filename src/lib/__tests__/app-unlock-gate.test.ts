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
