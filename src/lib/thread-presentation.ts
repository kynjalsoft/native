import type { Email, Mailbox } from '../api/types';

/** The message opened from the list is the only card initially expanded. */
export function initiallyExpandedThreadMessage(openedId: string, messages: Email[]): string {
  return messages.some((message) => message.id === openedId)
    ? openedId
    : messages[messages.length - 1]?.id ?? openedId;
}

/**
 * A conversation may include replies filed in Sent even when opened from
 * Inbox. Show the actual folder of each message, not the folder of the row
 * that opened the conversation. Shared mailbox ids are prefixed locally but
 * Email.mailboxIds always contains the raw JMAP ids.
 */
export function threadMessageFolder(
  email: Pick<Email, 'mailboxIds'>,
  mailboxes: Mailbox[],
  openedMailboxId: string | null,
): string | null {
  const present = mailboxes.filter((mailbox) =>
    !!email.mailboxIds?.[mailbox.originalId ?? mailbox.id],
  );
  if (present.length === 0) return null;
  const opened = present.find((mailbox) => mailbox.id === openedMailboxId);
  if (opened) return opened.name;
  const recognizable = present.find((mailbox) =>
    mailbox.role === 'sent' || mailbox.role === 'inbox' || mailbox.role === 'drafts',
  );
  return (recognizable ?? present[0]).name;
}
