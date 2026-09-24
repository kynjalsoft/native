import { describe, expect, it } from 'vitest';
import { canAutoReloadMailUpdate } from '../auto-ota';

const idle = {
  appIsActive: true,
  routeName: 'Mail',
  authRestored: true,
  authenticated: true,
  authenticating: false,
  liveSession: true,
  outboxFlushing: false,
  sendUndoPending: false,
  mailListBusy: false,
};

describe('automatic OTA activation', () => {
  it('applies a downloaded update from the idle mail list', () => {
    expect(canAutoReloadMailUpdate(idle)).toBe(true);
  });

  it.each(['Compose', 'EmailThread', 'AddAccount', 'Settings', 'UnifiedInbox'])(
    'defers while %s is open', (routeName) => {
      expect(canAutoReloadMailUpdate({ ...idle, routeName })).toBe(false);
    },
  );

  it('defers through auth restoration, account work, backgrounding, outbox replay and undo send', () => {
    expect(canAutoReloadMailUpdate({ ...idle, authRestored: false })).toBe(false);
    expect(canAutoReloadMailUpdate({ ...idle, authenticated: false })).toBe(false);
    expect(canAutoReloadMailUpdate({ ...idle, authenticating: true })).toBe(false);
    expect(canAutoReloadMailUpdate({ ...idle, liveSession: false })).toBe(false);
    expect(canAutoReloadMailUpdate({ ...idle, appIsActive: false })).toBe(false);
    expect(canAutoReloadMailUpdate({ ...idle, outboxFlushing: true })).toBe(false);
    expect(canAutoReloadMailUpdate({ ...idle, sendUndoPending: true })).toBe(false);
    expect(canAutoReloadMailUpdate({ ...idle, mailListBusy: true })).toBe(false);
  });
});
