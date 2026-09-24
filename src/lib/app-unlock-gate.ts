/**
 * iOS briefly reports `inactive` while Face ID covers the app. Only an actual
 * background transition invalidates a successful unlock. Keep this state
 * separate from React rendering so an old biometric promise cannot unlock a
 * mailbox after the user leaves the app.
 */
export class AppUnlockGate {
  private backgroundEpoch = 0;
  private verifiedWhileInactive = false;

  begin(): number {
    this.verifiedWhileInactive = false;
    return this.backgroundEpoch;
  }

  isCurrent(epoch: number): boolean {
    return epoch === this.backgroundEpoch;
  }

  verified(epoch: number, appState: string | null): boolean {
    if (!this.isCurrent(epoch)) return false;
    this.verifiedWhileInactive = appState !== 'active';
    return appState === 'active';
  }

  active(): boolean {
    if (!this.verifiedWhileInactive) return false;
    this.verifiedWhileInactive = false;
    return true;
  }

  background(): void {
    this.backgroundEpoch += 1;
    this.verifiedWhileInactive = false;
  }

  cancel(): void {
    this.verifiedWhileInactive = false;
  }
}

/** Hide private mail in the app-switcher snapshot, including Face ID's inactive interval. */
export function shouldHideMailForAppState(appState: string | null): boolean {
  return appState !== 'active';
}
