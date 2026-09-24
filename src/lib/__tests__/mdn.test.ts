import { describe, it, expect } from 'vitest';
import { buildMdnMessage, encodeHeaderWord, rfc5322Date } from '../mdn';

describe('buildMdnMessage', () => {
  it('builds a two-part multipart/report with CRLF line endings', () => {
    const raw = buildMdnMessage({
      to: 'sender@remote.example',
      fromEmail: 'me@x.example',
      fromName: 'Me',
      originalMessageId: ['orig@remote.example'],
      originalSubject: 'Hello',
      originalRecipient: 'me@x.example',
      automatic: false,
    });
    expect(raw).toContain('From: Me <me@x.example>\r\n');
    expect(raw).toContain('To: sender@remote.example\r\n');
    expect(raw).toContain('Subject: Read: Hello\r\n');
    expect(raw).toContain('In-Reply-To: <orig@remote.example>\r\n');
    expect(raw).toContain('Content-Type: multipart/report; report-type=disposition-notification;');
    expect(raw).toContain('Content-Type: message/disposition-notification\r\n');
    expect(raw).toContain('Original-Message-ID: <orig@remote.example>\r\n');
    expect(raw).toContain('Final-Recipient: rfc822;me@x.example\r\n');
    expect(raw).toContain('Reporting-UA: x.example; ZyndMail\r\n');
    expect(raw).toContain('Disposition: manual-action/MDN-sent-manually; displayed\r\n');
    expect(raw.split('\n').every((l) => l === '' || l.endsWith('\r'))).toBe(true);
  });

  it('marks automatic receipts and encodes non-ASCII headers', () => {
    const raw = buildMdnMessage({
      to: 'a@b.example',
      fromEmail: 'me@x.example',
      fromName: 'Jürgen',
      automatic: true,
      subject: 'Gelesen: Grüße',
    });
    expect(raw).toContain('Disposition: automatic-action/MDN-sent-automatically; displayed');
    expect(raw).toContain('From: =?UTF-8?B?');
    expect(raw).toContain('Subject: =?UTF-8?B?');
    expect(raw).not.toContain('In-Reply-To');
  });
});

describe('helpers', () => {
  it('leaves ASCII header words alone', () => {
    expect(encodeHeaderWord('plain')).toBe('plain');
  });
  it('formats RFC 5322 dates in UTC', () => {
    expect(rfc5322Date(new Date(Date.UTC(2026, 4, 28, 14, 23, 0)))).toBe('Thu, 28 May 2026 14:23:00 +0000');
  });
});
