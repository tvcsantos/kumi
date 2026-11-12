// Finds the newest Kumi release on GitHub for a channel.

import { z } from 'zod';
import type { ReleaseInfo, UpdateChannel } from '@shared/api';
import { networkReason, type Fetch } from '../catalog/http';
import { compareVersions, parseVersion } from './version';

export const RELEASES_URL = 'https://api.github.com/repos/tvcsantos/kumi/releases?per_page=20';

const TIMEOUT_MS = 20_000;

const release = z.object({
  tag_name: z.string(),
  html_url: z.url({ protocol: /^https$/ }),
  name: z.string().nullish(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullish(),
});

/**
 * The newest release on the channel, or null when there is none.
 * `stable` skips pre-releases; drafts and tags that aren't versions are always skipped.
 */
export async function latestRelease(fetchImpl: Fetch, channel: UpdateChannel, userAgent: string): Promise<ReleaseInfo | null> {
  let res: Response;
  try {
    res = await fetchImpl(RELEASES_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': userAgent, 'X-GitHub-Api-Version': '2022-11-28' },
    });
  } catch (e) {
    throw new Error(`Couldn't reach GitHub: ${networkReason(e)}`);
  }
  if (!res.ok) {
    if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
      throw new Error("GitHub's rate limit was reached. Try again in an hour.");
    }
    throw new Error(`GitHub answered ${res.status} ${res.statusText}`.trim());
  }

  const list = z.array(z.unknown()).parse(await res.json());
  let best: { info: ReleaseInfo; version: NonNullable<ReturnType<typeof parseVersion>> } | null = null;
  for (const item of list) {
    const r = release.safeParse(item);
    if (!r.success || r.data.draft || (r.data.prerelease && channel === 'stable')) continue;
    const version = parseVersion(r.data.tag_name);
    if (!version) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    best = {
      version,
      info: {
        version: r.data.tag_name.replace(/^v/, ''),
        url: r.data.html_url,
        name: r.data.name ?? undefined,
        publishedAt: r.data.published_at ?? undefined,
        prerelease: r.data.prerelease,
      },
    };
  }
  return best?.info ?? null;
}
