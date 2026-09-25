/**
 * iOS briefly reports `inactive` while Face ID covers the app. Only an actual
 * background transition invalidates a successful unlock. Keep this state
 * separate from React rendering so an old biometric promise cannot unlock a
 * mailbox after the user leaves the app.
 */
export const MAIL_LOCK_RETURN_WINDOW_MS = 60_000;

export class AppUnlockGate {
  private backgroundEpoch = 0;
  private verifiedWhileInactive = false;
  private unlocked = false;
  private backgroundAt: number | null = null;

  get isLocked(): boolean {
    return !this.unlocked;
  }

  begin(): number {
    this.backgroundEpoch += 1;
    this.verifiedWhileInactive = false;
    return this.backgroundEpoch;
  }

  isCurrent(epoch: number): boolean {
    return epoch === this.backgroundEpoch;
  }

  verified(epoch: number, appState: string | null): boolean {
    if (!this.isCurrent(epoch) || (appState !== 'active' && appState !== 'inactive')) return false;
    this.verifiedWhileInactive = appState === 'inactive';
    if (appState === 'active') this.unlocked = true;
    return appState === 'active';
  }

  active(now = Date.now()): boolean {
    // Evaluate elapsed absence on resume; never run an inactivity timer while
    // someone is reading or composing. The privacy cover hides background mail.
    if (this.backgroundAt !== null) {
      const elapsed = now - this.backgroundAt;
      if (elapsed < 0 || elapsed >= MAIL_LOCK_RETURN_WINDOW_MS) this.unlocked = false;
      this.backgroundAt = null;
    }
    if (!this.verifiedWhileInactive) return false;
    this.verifiedWhileInactive = false;
    this.unlocked = true;
    return true;
  }

  background(now = Date.now()): void {
    if (this.backgroundAt === null) this.backgroundAt = now;
    this.backgroundEpoch += 1;
    this.verifiedWhileInactive = false;
  }

  cancel(): void {
    this.backgroundEpoch += 1;
    this.unlocked = false;
    this.backgroundAt = null;
    this.verifiedWhileInactive = false;
  }
}

/** Hide private mail in the app-switcher snapshot, including Face ID's inactive interval. */
export function shouldHideMailForAppState(appState: string | null): boolean {
  return appState !== 'active';
}

/** Preferences must hydrate before a protected mailbox can be displayed. */
export function requiresMailboxUnlock(hydrated: boolean, enabled: boolean, locked: boolean): boolean {
  return !hydrated || (enabled && locked);
}
