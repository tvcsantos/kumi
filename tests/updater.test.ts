import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateChannel } from '@shared/api';
import type { Fetch } from '../src/main/catalog/http';
import { latestRelease, RELEASES_URL } from '../src/main/updater/github';
import { BREW_UPGRADE, CASKROOMS, detectInstallKind } from '../src/main/updater/install-kind';
import { CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, UpdateService } from '../src/main/updater/service';
import { compareVersions, isNewer, parseVersion } from '../src/main/updater/version';

const rel = (tag: string, extra: { draft?: boolean; prerelease?: boolean } = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/tvcsantos/kumi/releases/tag/${tag}`,
  name: `Kumi ${tag.slice(1)}`,
  draft: false,
  prerelease: false,
  published_at: '2026-11-01T00:00:00Z',
  ...extra,
});

function fakeFetch(body: unknown, init: ResponseInit = { status: 200 }, calls: { url: string; headers: Record<string, string> }[] = []): Fetch {
  return (async (input: string | URL, req?: RequestInit) => {
    calls.push({ url: String(input), headers: (req?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify(body), init);
  }) as Fetch;
}

describe('versions', () => {
  it('parses tags with and without v', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
    expect(parseVersion('0.2.0-rc.1')).toEqual({ major: 0, minor: 2, patch: 0, pre: ['rc', '1'] });
    expect(parseVersion('nightly')).toBeNull();
  });

  it('orders releases the semver way', () => {
    const sorted = ['0.2.0', '0.1.10', '0.2.0-rc.2', '0.2.0-rc.10', '0.1.4', '0.2.0-beta', '0.2.0-rc.1'].sort((a, b) => compareVersions(parseVersion(a)!, parseVersion(b)!));
    expect(sorted).toEqual(['0.1.4', '0.1.10', '0.2.0-beta', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.0-rc.10', '0.2.0']);
  });

  it('treats unparseable versions as never newer', () => {
    expect(isNewer('0.1.5', '0.1.4')).toBe(true);
    expect(isNewer('0.1.4', '0.1.4')).toBe(false);
    expect(isNewer('0.2.0', '0.2.0-rc.1')).toBe(true);
    expect(isNewer('garbage', '0.1.4')).toBe(false);
  });
});

describe('install kind', () => {
  const facts = (over: Partial<Parameters<typeof detectInstallKind>[0]>) =>
    detectInstallKind({ platform: 'darwin', isPackaged: true, env: {}, exists: () => false, ...over });

  it('tells Homebrew installs apart from DMG ones', () => {
    expect(facts({})).toBe('mac');
    for (const room of CASKROOMS) expect(facts({ exists: (p) => p === room })).toBe('homebrew');
  });

  it('knows the other platforms and dev builds', () => {
    expect(facts({ isPackaged: false, exists: () => true })).toBe('dev');
    expect(facts({ platform: 'win32' })).toBe('windows');
    expect(facts({ platform: 'linux', env: { APPIMAGE: '/home/me/Kumi.AppImage' } })).toBe('appimage');
    expect(facts({ platform: 'linux' })).toBe('linux-package');
  });
});

describe('latestRelease', () => {
  const list = [rel('v0.1.3'), rel('v0.3.0', { draft: true }), rel('v0.2.0-rc.1', { prerelease: true }), rel('v0.1.4'), rel('latest-docs'), { junk: true }];

  it('picks the newest stable release, skipping drafts, pre-releases and odd tags', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const r = await latestRelease(fakeFetch(list, { status: 200 }, calls), 'stable', 'Kumi/0.1.3');
    expect(r).toEqual({ version: '0.1.4', url: rel('v0.1.4').html_url, name: 'Kumi 0.1.4', publishedAt: '2026-11-01T00:00:00Z', prerelease: false });
    expect(calls[0]!.url).toBe(RELEASES_URL);
    expect(calls[0]!.headers['User-Agent']).toBe('Kumi/0.1.3');
  });

  it('includes release candidates on the prerelease channel', async () => {
    expect((await latestRelease(fakeFetch(list), 'prerelease', 'Kumi'))?.version).toBe('0.2.0-rc.1');
  });

  it('returns null when nothing qualifies', async () => {
    expect(await latestRelease(fakeFetch([rel('v9.0.0', { draft: true })]), 'stable', 'Kumi')).toBeNull();
  });

  it('explains rate limits and other failures', async () => {
    await expect(latestRelease(fakeFetch({}, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }), 'stable', 'Kumi')).rejects.toThrow(/rate limit/);
    await expect(latestRelease(fakeFetch({}, { status: 500, statusText: 'Server Error' }), 'stable', 'Kumi')).rejects.toThrow('GitHub answered 500 Server Error');
    const offline = (async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.github.com'), { code: 'ENOTFOUND' }) });
    }) as Fetch;
    await expect(latestRelease(offline, 'stable', 'Kumi')).rejects.toThrow(/Couldn't reach GitHub: getaddrinfo ENOTFOUND/);
  });
});

describe('UpdateService', () => {
  afterEach(() => vi.useRealTimers());

  const service = (fetch: Fetch, over: { channel?: UpdateChannel; auto?: boolean; kind?: 'mac' | 'homebrew' | 'dev'; version?: string } = {}) =>
    new UpdateService({
      currentVersion: over.version ?? '0.1.3',
      installKind: over.kind ?? 'mac',
      settings: async () => ({ autoCheckUpdates: over.auto ?? true, updateChannel: over.channel ?? 'stable' }),
      fetch,
      now: () => 1000,
    });

  it('reports an available update, and the brew command for Homebrew installs', async () => {
    const s = service(fakeFetch([rel('v0.1.4')]), { kind: 'homebrew' });
    expect(s.get()).toMatchObject({ state: 'idle', installKind: 'homebrew', command: BREW_UPGRADE });
    expect(await s.check()).toMatchObject({ state: 'available', latest: { version: '0.1.4' }, checkedAt: 1000, dismissed: false });
  });

  it('says up to date when the newest release is this one, or older', async () => {
    expect((await service(fakeFetch([rel('v0.1.3')])).check()).state).toBe('up-to-date');
    expect((await service(fakeFetch([rel('v0.1.4')]), { version: '0.2.0-rc.1' }).check()).state).toBe('up-to-date');
    expect((await service(fakeFetch([]), {}).check()).state).toBe('up-to-date');
  });

  it("keeps a found update when a later check fails, but reports the failure", async () => {
    let fail = false;
    const fetch = (async () => (fail ? new Response('{}', { status: 502 }) : new Response(JSON.stringify([rel('v0.1.4')])))) as Fetch;
    const s = service(fetch);
    await s.check();
    fail = true;
    expect(await s.check()).toMatchObject({ state: 'available', latest: { version: '0.1.4' }, error: 'GitHub answered 502' });
    expect((await service(fetch).check()).state).toBe('error');
  });

  it('shares one request between overlapping checks', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const s = service(fakeFetch([rel('v0.1.4')], { status: 200 }, calls));
    await Promise.all([s.check(), s.check()]);
    expect(calls).toHaveLength(1);
  });

  it('hides the banner for a dismissed version only', async () => {
    let tag = 'v0.1.4';
    const s = service((async () => new Response(JSON.stringify([rel(tag)]))) as Fetch);
    await s.check();
    expect(s.dismiss('0.1.4').dismissed).toBe(true);
    tag = 'v0.1.5';
    expect((await s.check()).dismissed).toBe(false);
  });

  it('checks on a timer while the setting is on, and never in dev builds', async () => {
    vi.useFakeTimers();
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const on = service(fakeFetch([rel('v0.1.4')], { status: 200 }, calls));
    const off = service(fakeFetch([rel('v0.1.4')], { status: 200 }, calls), { auto: false });
    const dev = service(fakeFetch([rel('v0.1.4')], { status: 200 }, calls), { kind: 'dev' });
    for (const s of [on, off, dev]) s.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(calls).toHaveLength(2);
    for (const s of [on, off, dev]) s.stop();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(calls).toHaveLength(2);
  });
});
