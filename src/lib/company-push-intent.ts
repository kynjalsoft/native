import type { CompanyPushDestination } from './company-push';

export interface CompanyPushResponseLike {
  notification: {
    request: {
      identifier: string;
      content: {
        title?: unknown;
        body?: unknown;
        subtitle?: unknown;
        data?: unknown;
      };
    };
  };
}

export interface CompanyPushAccountLike {
  id: string;
  serverUrl: string;
}

export interface CompanyPushNavigationReadiness {
  authenticated: boolean;
  locked: boolean;
  accountRegistryHydrated: boolean;
  navigationReady: boolean;
  activeAccountId: string | null;
  accounts: CompanyPushAccountLike[];
}

export interface CompanyPushIntentDependencies {
  response: CompanyPushResponseLike;
  readReadiness: () => CompanyPushNavigationReadiness;
  isCompanyMailServer: (serverUrl: string) => boolean;
  isCompanyPushPresentation: (content: CompanyPushResponseLike['notification']['request']['content']) => boolean;
  registeredCompanyAccountId?: () => Promise<string | null>;
  switchAccount: (accountId: string) => Promise<void>;
  resolveDestination: (accountId: string, data: unknown) => Promise<CompanyPushDestination | null>;
  navigateToEmail: (destination: Extract<CompanyPushDestination, { target: 'EMAIL' }>) => void;
  navigateToInbox: () => void;
  showInboxFallback: () => void;
  clearLastNotificationResponse: () => Promise<void>;
}

export type CompanyPushIntentResult = 'ignored' | 'deferred' | 'retry' | 'opened';

function readyToOpen(readiness: CompanyPushNavigationReadiness): boolean {
  return readiness.authenticated && !readiness.locked && readiness.accountRegistryHydrated &&
    readiness.navigationReady;
}

/**
 * Opens a notification only after the restored account and navigator are
 * usable. Callers retain the response whenever this returns `deferred` or
 * `retry`, so a cold-start race cannot silently discard a user's tap.
 */
export async function openCompanyPushIntent(
  dependencies: CompanyPushIntentDependencies,
): Promise<CompanyPushIntentResult> {
  const { response } = dependencies;
  const content = response.notification.request.content;
  if (!dependencies.isCompanyPushPresentation(content)) return 'ignored';

  let readiness = dependencies.readReadiness();
  if (!readyToOpen(readiness)) return 'deferred';

  try {
    const registeredId = dependencies.registeredCompanyAccountId
      ? await dependencies.registeredCompanyAccountId() : null;
    const companyAccount = registeredId
      ? readiness.accounts.find((account) => account.id === registeredId &&
        dependencies.isCompanyMailServer(account.serverUrl))
      : dependencies.registeredCompanyAccountId
        ? null
        : readiness.accounts.find((account) => dependencies.isCompanyMailServer(account.serverUrl));
    if (!companyAccount) return readiness.accounts.some((account) =>
      dependencies.isCompanyMailServer(account.serverUrl)) ? 'retry' : 'deferred';

    if (readiness.activeAccountId !== companyAccount.id) {
      await dependencies.switchAccount(companyAccount.id);
    }

    readiness = dependencies.readReadiness();
    if (!readyToOpen(readiness)) return 'deferred';
    if (readiness.activeAccountId !== companyAccount.id) return 'retry';

    const destination = await dependencies.resolveDestination(companyAccount.id, content.data);
    if (!destination) return 'retry';

    readiness = dependencies.readReadiness();
    if (!readyToOpen(readiness)) return 'deferred';
    if (readiness.activeAccountId !== companyAccount.id) return 'retry';

    if (destination.target === 'EMAIL') {
      dependencies.navigateToEmail(destination);
    } else {
      dependencies.navigateToInbox();
      dependencies.showInboxFallback();
    }

    // Navigation is the success boundary. A failure clearing Expo's cached
    // response must not cause the same tap to navigate a second time.
    await dependencies.clearLastNotificationResponse().catch(() => undefined);
    return 'opened';
  } catch {
    return 'retry';
  }
}
