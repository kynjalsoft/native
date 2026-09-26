import { describe, expect, it, vi } from 'vitest';
import { openFetchedPersonalNotification, ownsPersonalNotificationTap, resolveLegacyPersonalNotification } from '../personal-notification-tap';

describe('personal notification tap', () => {
  it('retries an email fetched after the active account switches', async () => {
    let finishFetch!: (message: { id: string; threadId: string }) => void;
    const fetchMessage = vi.fn(() => new Promise<{ id: string; threadId: string }>((resolve) => {
      finishFetch = resolve;
    }));
    const navigate = vi.fn();
    const owner = {
      activeAccountId: 'alice@mail.example.com',
      sessionUsername: 'alice', sessionServerUrl: 'https://mail.example.com',
    };
    const opening = openFetchedPersonalNotification(
      'alice@mail.example.com', fetchMessage, () => owner, () => true, navigate,
    );

    owner.activeAccountId = 'bob@mail.example.com';
    owner.sessionUsername = 'bob';
    finishFetch({ id: 'message-a', threadId: 'thread-a' });

    expect(await opening).toBe('retry');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('uses the local identity while fetching from a distinct JMAP account', async () => {
    const navigate = vi.fn();
    const owner = {
      activeAccountId: 'alice@mail.example.com',
      sessionUsername: 'bob', sessionServerUrl: 'https://mail.example.com',
    };
    const getMessage = vi.fn(async (jmapAccountId: string) => ({ id: 'message-a', jmapAccountId }));

    expect(await openFetchedPersonalNotification(
      'alice@mail.example.com', () => getMessage('u1'), () => owner, () => true, navigate,
    )).toBe('retry');
    expect(navigate).not.toHaveBeenCalled();

    owner.sessionUsername = 'alice';
    expect(ownsPersonalNotificationTap('alice@mail.example.com', owner)).toBe(true);
    expect(await openFetchedPersonalNotification(
      'alice@mail.example.com', () => getMessage('u1'), () => owner, () => true, navigate,
    )).toBe('opened');
    expect(getMessage).toHaveBeenCalledWith('u1');
    expect(navigate).toHaveBeenCalledWith({ id: 'message-a', jmapAccountId: 'u1' });
  });

  it('does not navigate after a switch starts before the fetch completes', async () => {
    let finish!: (message: { id: string }) => void;
    const owner = { activeAccountId: 'alice@mail.example.com', sessionUsername: 'alice',
      sessionServerUrl: 'https://mail.example.com', switching: false };
    const navigate = vi.fn();
    const opening = openFetchedPersonalNotification('alice@mail.example.com',
      () => new Promise((resolve) => { finish = resolve; }), () => owner, () => true, navigate);
    owner.switching = true;
    finish({ id: 'message-a' });
    await expect(opening).resolves.toBe('retry');
    expect(navigate).not.toHaveBeenCalled();

    owner.switching = false;
    await expect(openFetchedPersonalNotification('alice@mail.example.com',
      async () => ({ id: 'message-a' }), () => owner, () => true, navigate)).resolves.toBe('opened');
    expect(navigate).toHaveBeenCalledWith({ id: 'message-a' });
  });

  it('opens a prior-build message only in its unique authorized JMAP account', async () => {
    const owner = { activeAccountId: 'alice@mail.example.com', sessionUsername: 'alice',
      sessionServerUrl: 'https://mail.example.com', switching: false };
    const fetchMessage = vi.fn(async (jmapAccountId: string) => jmapAccountId === 'shared'
      ? { id: 'old-message', threadId: 'verified-thread' } : undefined);
    const navigate = vi.fn();
    expect(await openFetchedPersonalNotification(owner.activeAccountId,
      () => resolveLegacyPersonalNotification('old-message', ['primary', 'shared'], fetchMessage),
      () => owner, () => true, navigate)).toBe('opened');
    expect(fetchMessage).toHaveBeenCalledWith('primary');
    expect(fetchMessage).toHaveBeenCalledWith('shared');
    expect(navigate).toHaveBeenCalledWith({
      email: { id: 'old-message', threadId: 'verified-thread' }, jmapAccountId: 'shared',
    });
  });

  it('keeps missing, ambiguous, and offline prior-build messages pending', async () => {
    const owner = { activeAccountId: 'alice@mail.example.com', sessionUsername: 'alice',
      sessionServerUrl: 'https://mail.example.com' };
    const navigate = vi.fn();
    const open = (fetchMessage: (accountId: string) => Promise<{ id: string } | undefined>) =>
      openFetchedPersonalNotification(owner.activeAccountId,
        () => resolveLegacyPersonalNotification('old-message', ['primary', 'shared'], fetchMessage),
        () => owner, () => true, navigate);
    expect(await open(async () => undefined)).toBe('retry');
    expect(await open(async () => ({ id: 'old-message' }))).toBe('retry');
    expect(await open(async (accountId) => {
      if (accountId === 'shared') throw new Error('Offline');
      return { id: 'old-message' };
    })).toBe('retry');
    expect(navigate).not.toHaveBeenCalled();
  });
});
