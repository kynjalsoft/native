import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchLatestRelease,
  parseSeverity,
  parseAdvisoryUrl,
  resolveApkSha256,
  stripMarkdown,
  UpdateRateLimitedError,
  type LatestRelease,
} from '../updates';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe('parseSeverity', () => {
  it('reads a severity line from the release body', () => {
    expect(parseSeverity('## Notes\nseverity: security\n- fix')).toBe('security');
    expect(parseSeverity('- Severity: Deprecated')).toBe('deprecated');
    expect(parseSeverity('nothing here')).toBe('normal');
    expect(parseSeverity('severity: bogus')).toBe('normal');
  });

  it('reads an advisory url', () => {
    expect(parseAdvisoryUrl('advisory: https://github.com/x/y/security/advisories/GHSA-1')).toBe(
      'https://github.com/x/y/security/advisories/GHSA-1',
    );
    expect(parseAdvisoryUrl('')).toBeNull();
  });
});

describe('stripMarkdown', () => {
  it('unwraps headings, emphasis, links and bullets and drops control lines', () => {
    const out = stripMarkdown('# Title\nseverity: security\n\n- **bold** and [link](https://x.y) `code`\n> quote');
    expect(out).toBe('Title\n\n• bold and link code\nquote');
  });
});

describe('fetchLatestRelease', () => {
  const release = (overrides: Record<string, unknown> = {}) => ({
    tag_name: '1.2.3',
    name: 'v1.2.3',
    html_url: 'https://github.com/kynjalsoft/zyndmail/releases/tag/1.2.3',
    published_at: '2026-01-01T00:00:00Z',
    body: '',
    assets: [
      { name: 'app.apk', browser_download_url: 'https://x/app.apk', size: 10 },
      { name: 'app.apk.sha256', browser_download_url: 'https://x/app.apk.sha256', size: 65 },
    ],
    ...overrides,
  });

  it('does not download the checksum companion during the check', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => release() }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const latest = await fetchLatestRelease();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/kynjalsoft/zyndmail/releases/latest',
      expect.any(Object),
    );
    expect(latest?.sha256Asset?.name).toBe('app.apk.sha256');
    expect(latest?.apkSha256).toBeNull();
    expect(latest?.severity).toBe('normal');
  });

  it('parses severity from the body', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => release({ body: 'severity: security\nadvisory: https://a.b/c' }),
    })) as unknown as typeof fetch;
    const latest = await fetchLatestRelease();
    expect(latest?.severity).toBe('security');
    expect(latest?.advisoryUrl).toBe('https://a.b/c');
  });

  it('throws UpdateRateLimitedError on 403/429', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 403 })) as unknown as typeof fetch;
    await expect(fetchLatestRelease()).rejects.toBeInstanceOf(UpdateRateLimitedError);
    global.fetch = vi.fn(async () => ({ ok: false, status: 429 })) as unknown as typeof fetch;
    await expect(fetchLatestRelease()).rejects.toBeInstanceOf(UpdateRateLimitedError);
  });
});

describe('resolveApkSha256', () => {
  const base: LatestRelease = {
    tag: '1', name: '1', htmlUrl: '', publishedAt: '', body: '',
    apkAsset: null, sha256Asset: null, apkSha256: null, severity: 'normal', advisoryUrl: null,
  };

  it('prefers the body hash and otherwise fetches the companion asset', async () => {
    const hash = 'a'.repeat(64);
    expect(await resolveApkSha256({ ...base, apkSha256: hash })).toBe(hash);
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => `${'b'.repeat(64)}  app.apk` })) as unknown as typeof fetch;
    expect(await resolveApkSha256({
      ...base,
      sha256Asset: { name: 'app.apk.sha256', browser_download_url: 'https://x', size: 1 },
    })).toBe('b'.repeat(64));
    expect(await resolveApkSha256(base)).toBeNull();
  });
});
