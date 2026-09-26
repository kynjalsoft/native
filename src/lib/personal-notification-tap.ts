import { generateAccountId } from './account-utils';

export type PersonalNotificationTapResult = 'opened' | 'retry' | 'ignored';

export function ownsPersonalNotificationTap(
  accountId: string,
  owner: { activeAccountId: string | null; sessionUsername: string | null; sessionServerUrl: string | null; switching?: boolean },
): boolean {
  return !owner.switching && owner.activeAccountId === accountId && !!owner.sessionUsername && !!owner.sessionServerUrl &&
    generateAccountId(owner.sessionUsername, owner.sessionServerUrl) === accountId;
}

export async function resolveLegacyPersonalNotification<T extends { id: string }>(
  emailId: string,
  mailAccountIds: string[],
  fetchMessage: (jmapAccountId: string) => Promise<T | undefined>,
): Promise<{ email: T; jmapAccountId: string } | undefined> {
  const matches = await Promise.all([...new Set(mailAccountIds)].map(async (jmapAccountId) => {
    const email = await fetchMessage(jmapAccountId);
    return email?.id === emailId ? { email, jmapAccountId } : undefined;
  }));
  const found = matches.filter((match): match is { email: T; jmapAccountId: string } => !!match);
  return found.length === 1 ? found[0] : undefined;
}

export async function openFetchedPersonalNotification<T>(
  accountId: string,
  fetchMessage: () => Promise<T | undefined>,
  readOwner: () => { activeAccountId: string | null; sessionUsername: string | null; sessionServerUrl: string | null; switching?: boolean },
  isReady: () => boolean,
  navigate: (message: T) => void,
): Promise<PersonalNotificationTapResult> {
  try {
    const message = await fetchMessage();
    if (!isReady()) return 'retry';
    const owner = readOwner();
    if (!ownsPersonalNotificationTap(accountId, owner)) return 'retry';
    if (message === undefined) return 'retry';
    navigate(message);
    return 'opened';
  } catch {
    return 'retry';
  }
}
