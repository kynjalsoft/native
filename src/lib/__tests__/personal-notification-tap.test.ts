import { describe, expect, it, vi } from 'vitest';
import { openFetchedPersonalNotification, ownsPersonalNotificationTap } from '../personal-notification-tap';

describe('personal notification tap', () => {
  it('discards an email fetched after the active account switches', async () => {
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

    expect(await opening).toBe('ignored');
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
    )).toBe('ignored');
    expect(navigate).not.toHaveBeenCalled();

    owner.sessionUsername = 'alice';
    expect(ownsPersonalNotificationTap('alice@mail.example.com', owner)).toBe(true);
    expect(await openFetchedPersonalNotification(
      'alice@mail.example.com', () => getMessage('u1'), () => owner, () => true, navigate,
    )).toBe('opened');
    expect(getMessage).toHaveBeenCalledWith('u1');
    expect(navigate).toHaveBeenCalledWith({ id: 'message-a', jmapAccountId: 'u1' });
  });
});
