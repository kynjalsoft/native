interface MailUpdateContext {
  appIsActive: boolean;
  routeName: string | null;
  authRestored: boolean;
  authenticated: boolean;
  authenticating: boolean;
  liveSession: boolean;
  outboxFlushing: boolean;
  sendUndoPending: boolean;
  mailListBusy: boolean;
}

/** Reload only at the idle mail list, never over a draft or in-flight action. */
export function canAutoReloadMailUpdate(context: MailUpdateContext): boolean {
  return context.appIsActive && context.routeName === 'Mail' &&
    context.authRestored && context.authenticated && !context.authenticating &&
    context.liveSession && !context.outboxFlushing && !context.sendUndoPending &&
    !context.mailListBusy;
}
