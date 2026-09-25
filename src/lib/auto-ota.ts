interface MailUpdateContext {
  appIsActive: boolean;
  appLocked: boolean;
  unlockBusy: boolean;
  routeName: string | null;
  authRestored: boolean;
  authenticated: boolean;
  authenticating: boolean;
  liveSession: boolean;
  outboxFlushing: boolean;
  sendUndoPending: boolean;
  mailListBusy: boolean;
}

/** Apply before device verification, never restart a mailbox just unlocked by
 * Face ID. A downloaded update waits for the next safe locked foreground. */
export function canAutoReloadMailUpdate(context: MailUpdateContext): boolean {
  return context.appIsActive && context.appLocked && !context.unlockBusy && context.routeName === 'Mail' &&
    context.authRestored && context.authenticated && !context.authenticating &&
    context.liveSession && !context.outboxFlushing && !context.sendUndoPending &&
    !context.mailListBusy;
}
