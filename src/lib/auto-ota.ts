interface MailUpdateContext {
  appIsActive: boolean;
  appLocked: boolean;
  lockEnabled?: boolean;
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

/** Use an idle mailbox; when app lock is enabled, apply before verification. */
export function canAutoReloadMailUpdate(context: MailUpdateContext): boolean {
  return context.appIsActive && (context.appLocked || context.lockEnabled === false) && !context.unlockBusy && context.routeName === 'Mail' &&
    context.authRestored && context.authenticated && !context.authenticating &&
    context.liveSession && !context.outboxFlushing && !context.sendUndoPending &&
    !context.mailListBusy;
}
