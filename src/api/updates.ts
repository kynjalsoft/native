export const UPDATE_REPO = 'kynjalsoft/zyndmail';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

// Mirrors the webmail's version-check severities: `security` and `deprecated`
// releases show a non-dismissable banner. Read from a `severity: <value>` line
// in the release body (GitHub Releases has no structured field for it).
export type UpdateSeverity = 'normal' | 'security' | 'deprecated';

export interface LatestRelease {
  tag: string;
  name: string;
  htmlUrl: string;
  publishedAt: string;
  body: string;
  apkAsset: ReleaseAsset | null;
  // Companion `*.apk.sha256` asset, fetched lazily on Install (see
  // resolveApkSha256) so the periodic check costs one request.
  sha256Asset: ReleaseAsset | null;
  // Lower-case hex SHA-256 of the APK when the release body lists one. Null
  // when it doesn't; the installer then relies on the companion asset or,
  // failing that, solely on Android's package signing check.
  apkSha256: string | null;
  severity: UpdateSeverity;
  // Optional advisory link from an `advisory: <url>` line in the body.
  advisoryUrl: string | null;
}

/** GitHub answered 403/429 (unauthenticated limit is 60 req/h/IP). */
export class UpdateRateLimitedError extends Error {
  constructor(status: number) {
    super(`GitHub API rate limited (${status})`);
    this.name = 'UpdateRateLimitedError';
  }
}

const SHA256_RE = /\b([a-f0-9]{64})\b/i;
const SEVERITY_RE = /^[ \t]*(?:[-*][ \t]*)?severity[ \t]*:[ \t]*(normal|security|deprecated)\b/im;
const ADVISORY_RE = /^[ \t]*(?:[-*][ \t]*)?advisory[ \t]*:[ \t]*(https?:\/\/\S+)/im;

export function parseSeverity(body: string): UpdateSeverity {
  const m = SEVERITY_RE.exec(body || '');
  return (m?.[1]?.toLowerCase() as UpdateSeverity | undefined) ?? 'normal';
}

export function parseAdvisoryUrl(body: string): string | null {
  const m = ADVISORY_RE.exec(body || '');
  return m ? m[1] : null;
}

function extractSha256(body: string, apkName: string | undefined): string | null {
  if (!body) return null;
  // Prefer a line that explicitly references the APK so we don't pick up the
  // hash of an unrelated asset.
  const lines = body.split(/\r?\n/);
  if (apkName) {
    for (const line of lines) {
      if (line.includes(apkName)) {
        const m = SHA256_RE.exec(line);
        if (m) return m[1].toLowerCase();
      }
    }
  }
  // Fallback: a single SHA256 anywhere in the body — common when the release
  // notes just list one checksum.
  const m = SHA256_RE.exec(body);
  return m ? m[1].toLowerCase() : null;
}

async function fetchCompanionSha256(asset: ReleaseAsset | null): Promise<string | null> {
  if (!asset) return null;
  try {
    const res = await fetch(asset.browser_download_url);
    if (!res.ok) return null;
    const text = await res.text();
    const m = SHA256_RE.exec(text);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * The checksum to verify the APK against: the release body's hash when it
 * lists one, else the companion `.sha256` asset (one extra request, made
 * only when the user actually installs).
 */
export async function resolveApkSha256(release: LatestRelease): Promise<string | null> {
  if (release.apkSha256) return release.apkSha256;
  return fetchCompanionSha256(release.sha256Asset);
}

/**
 * Turn GitHub release markdown into readable plain text: headings, emphasis,
 * links (kept as their label), code spans and list bullets are unwrapped.
 * Also strips the `severity:` / `advisory:` control lines.
 */
export function stripMarkdown(body: string): string {
  return (body || '')
    .replace(/\r\n/g, '\n')
    .replace(SEVERITY_RE, '')
    .replace(ADVISORY_RE, '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*\n?/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '• ')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function fetchLatestRelease(repo: string = UPDATE_REPO): Promise<LatestRelease | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 429) throw new UpdateRateLimitedError(res.status);
    throw new Error(`GitHub API ${res.status}`);
  }
  const json = (await res.json()) as {
    tag_name: string;
    name: string;
    html_url: string;
    published_at: string;
    body: string;
    assets: ReleaseAsset[];
  };
  const assets = Array.isArray(json.assets) ? json.assets : [];
  const apkAsset = assets.find((a) => a.name.endsWith('.apk')) ?? null;
  const sha256Asset = apkAsset
    ? assets.find(
        (a) => a.name === `${apkAsset.name}.sha256` || a.name === `${apkAsset.name}.SHA256`,
      ) ?? null
    : null;
  const body = json.body || '';
  return {
    tag: json.tag_name,
    name: json.name || json.tag_name,
    htmlUrl: json.html_url,
    publishedAt: json.published_at,
    body,
    apkAsset,
    sha256Asset,
    apkSha256: extractSha256(body, apkAsset?.name),
    severity: parseSeverity(body),
    advisoryUrl: parseAdvisoryUrl(body),
  };
}
