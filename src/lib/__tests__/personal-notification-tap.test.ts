import { describe, expect, it, vi } from 'vitest';
import { openFetchedPersonalNotification } from '../personal-notification-tap';

describe('personal notification tap', () => {
  it('discards an email fetched after the active account switches', async () => {
    let finishFetch!: (message: { id: string; threadId: string }) => void;
    const fetchMessage = vi.fn(() => new Promise<{ id: string; threadId: string }>((resolve) => {
      finishFetch = resolve;
    }));
    const navigate = vi.fn();
    const owner = { activeAccountId: 'staff-a', sessionAccountId: 'staff-a' };
    const opening = openFetchedPersonalNotification(
      'staff-a', fetchMessage, () => owner, () => true, navigate,
    );

    owner.activeAccountId = 'staff-b';
    owner.sessionAccountId = 'staff-b';
    finishFetch({ id: 'message-a', threadId: 'thread-a' });

    expect(await opening).toBe('ignored');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('requires the JMAP session to still own the fetched email', async () => {
    const navigate = vi.fn();
    const owner = { activeAccountId: 'staff-a', sessionAccountId: 'staff-b' };

    expect(await openFetchedPersonalNotification(
      'staff-a', async () => ({ id: 'message-a' }), () => owner, () => true, navigate,
    )).toBe('ignored');
    expect(navigate).not.toHaveBeenCalled();

    owner.sessionAccountId = 'staff-a';
    expect(await openFetchedPersonalNotification(
      'staff-a', async () => ({ id: 'message-a' }), () => owner, () => true, navigate,
    )).toBe('opened');
    expect(navigate).toHaveBeenCalledWith({ id: 'message-a' });
  });
});
