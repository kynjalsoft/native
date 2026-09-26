export type PersonalNotificationTapResult = 'opened' | 'retry' | 'ignored';

export async function openFetchedPersonalNotification<T>(
  accountId: string,
  fetchMessage: () => Promise<T | undefined>,
  readOwner: () => { activeAccountId: string | null; sessionAccountId: string | null },
  isReady: () => boolean,
  navigate: (message: T | undefined) => void,
): Promise<PersonalNotificationTapResult> {
  try {
    const message = await fetchMessage();
    if (!isReady()) return 'retry';
    const owner = readOwner();
    if (owner.activeAccountId !== accountId || owner.sessionAccountId !== accountId) return 'ignored';
    navigate(message);
    return 'opened';
  } catch {
    return 'retry';
  }
}
