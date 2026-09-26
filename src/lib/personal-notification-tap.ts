import { generateAccountId } from './account-utils';

export type PersonalNotificationTapResult = 'opened' | 'retry' | 'ignored';

export function ownsPersonalNotificationTap(
  accountId: string,
  owner: { activeAccountId: string | null; sessionUsername: string | null; sessionServerUrl: string | null; switching?: boolean },
): boolean {
  return !owner.switching && owner.activeAccountId === accountId && !!owner.sessionUsername && !!owner.sessionServerUrl &&
    generateAccountId(owner.sessionUsername, owner.sessionServerUrl) === accountId;
}

export async function openFetchedPersonalNotification<T>(
  accountId: string,
  fetchMessage: () => Promise<T | undefined>,
  readOwner: () => { activeAccountId: string | null; sessionUsername: string | null; sessionServerUrl: string | null; switching?: boolean },
  isReady: () => boolean,
  navigate: (message: T | undefined) => void,
): Promise<PersonalNotificationTapResult> {
  try {
    const message = await fetchMessage();
    if (!isReady()) return 'retry';
    const owner = readOwner();
    if (!ownsPersonalNotificationTap(accountId, owner)) return 'ignored';
    navigate(message);
    return 'opened';
  } catch {
    return 'retry';
  }
}
