import type { Email, Identity, Mailbox } from '../api/types';

export type MessageDeliveryContext = {
  kind: 'sent' | 'copied' | 'blindCopied' | 'addressed' | 'to';
  address: string;
};

function matchesIdentity(address: string, identities: Identity[]): boolean {
  const normalized = address.trim().toLowerCase();
  return identities.some((identity) => {
    const own = identity.email.trim().toLowerCase();
    if (normalized === own) return true;
    const at = normalized.indexOf('@');
    const plus = normalized.indexOf('+');
    return plus > 0 && plus < at && `${normalized.slice(0, plus)}${normalized.slice(at)}` === own;
  });
}

/** Explain how this message reached the mailbox without guessing who sent it. */
export function messageDeliveryContext(
  email: Pick<Email, 'to' | 'cc' | 'bcc'>,
  identities: Identity[],
  isSent: boolean,
): MessageDeliveryContext | null {
  if (isSent) {
    const recipient = email.to?.[0] ?? email.cc?.[0] ?? email.bcc?.[0];
    return recipient ? { kind: 'sent', address: recipient.email } : null;
  }
  for (const [kind, recipients] of [
    ['addressed', email.to], ['copied', email.cc], ['blindCopied', email.bcc],
  ] as const) {
    const own = recipients?.find((recipient) => matchesIdentity(recipient.email, identities));
    if (own) return { kind, address: own.email };
  }
  const recipient = email.to?.[0];
  return recipient ? { kind: 'to', address: recipient.email } : null;
}

export function deliveryContextLabel(
  context: MessageDeliveryContext,
  t: (key: string, fallback: string, params: { address: string }) => string,
): string {
  const labels = {
    sent: ['threads.sent_to', 'Sent to {address}'],
    copied: ['threads.copied_to', 'Copied to {address}'],
    blindCopied: ['threads.blind_copied_to', 'Blind copied to {address}'],
    addressed: ['threads.addressed_to', 'Addressed to {address}'],
    to: ['threads.to_recipient', 'To {address}'],
  } as const;
  const [key, fallback] = labels[context.kind];
  return t(key, fallback, { address: context.address });
}

/** The message opened from the list is the only card initially expanded. */
export function initiallyExpandedThreadMessage(openedId: string, messages: Email[]): string {
  return messages.some((message) => message.id === openedId)
    ? openedId
    : messages[messages.length - 1]?.id ?? openedId;
}

/** Drafts belong to the composer and Drafts folder, not the read timeline. */
export function visibleConversationMessages(messages: Email[], mailboxes: Mailbox[]): Email[] {
  const draftMailboxIds = new Set(
    mailboxes.filter((mailbox) => mailbox.role === 'drafts')
      .map((mailbox) => mailbox.originalId ?? mailbox.id),
  );
  return messages.filter((message) =>
    !message.keywords?.$draft &&
    !Object.keys(message.mailboxIds ?? {}).some((id) => draftMailboxIds.has(id)),
  );
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
