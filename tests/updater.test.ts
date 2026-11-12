import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseInfo, UpdateChannel } from '@shared/api';
import type { Fetch } from '../src/main/catalog/http';
import { DOWNLOAD_BASE, latestRelease, releaseFeed, releaseFileUrl, RELEASES_URL } from '../src/main/updater/github';
import type { Installer } from '../src/main/updater/installer';
import { bundlePath, downloadVerified, MacInstaller, pickZip } from '../src/main/updater/mac-installer';
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
    const brewed = { exists: (p: string) => p === CASKROOMS[0], home: '/Users/me' };
    expect(facts({ ...brewed, appPath: '/Applications/Kumi.app' })).toBe('homebrew');
    expect(facts({ ...brewed, appPath: '/Users/me/Applications/Kumi.app' })).toBe('homebrew');
    // A second copy elsewhere (say, a DMG download in Downloads) updates itself.
    expect(facts({ ...brewed, appPath: '/Users/me/Downloads/Kumi.app' })).toBe('mac');
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

describe('release feed', () => {
  it('is GitHub unless KUMI_UPDATE_FEED says otherwise', () => {
    expect(releaseFeed({})).toEqual({ releasesUrl: RELEASES_URL, downloadBase: DOWNLOAD_BASE, custom: false });
    expect(releaseFeed({ KUMI_UPDATE_FEED: 'http://127.0.0.1:8080/' })).toEqual({
      releasesUrl: 'http://127.0.0.1:8080/releases',
      downloadBase: 'http://127.0.0.1:8080/download',
      custom: true,
    });
    expect(releaseFeed({ KUMI_UPDATE_FEED: 'file:///tmp' }).custom).toBe(false);
  });

  it('only builds URLs for plain file names', () => {
    const feed = releaseFeed({});
    expect(releaseFileUrl(feed, '0.2.0', 'Kumi-0.2.0-arm64.zip')).toBe(`${DOWNLOAD_BASE}/v0.2.0/Kumi-0.2.0-arm64.zip`);
    expect(() => releaseFileUrl(feed, '0.2.0', '../evil.zip')).toThrow(/Unexpected file name/);
    expect(() => releaseFileUrl(feed, '0.2.0', 'https://evil.example/x.zip')).toThrow(/Unexpected file name/);
  });
});

describe('macOS updater', () => {
  const yml = `version: 0.2.0
files:
  - url: Kumi-0.2.0-x64.zip
    sha512: aaa
    size: 10
  - url: Kumi-0.2.0-arm64.zip
    sha512: bbb
    size: 20
  - url: Kumi-0.2.0-arm64.dmg
    sha512: ccc
    size: 30
path: Kumi-0.2.0-x64.zip
sha512: aaa
releaseDate: '2026-11-12T14:20:09.149Z'
`;

  it('finds the bundle of the running executable', () => {
    expect(bundlePath('/Applications/Kumi.app/Contents/MacOS/Kumi')).toBe('/Applications/Kumi.app');
  });

  it('picks the zip for this CPU', () => {
    expect(pickZip(yml, '0.2.0', 'arm64')).toEqual({ url: 'Kumi-0.2.0-arm64.zip', sha512: 'bbb', size: 20 });
    expect(pickZip(yml, '0.2.0', 'x64').url).toBe('Kumi-0.2.0-x64.zip');
    expect(() => pickZip(yml, '0.2.0', 'ppc')).toThrow(/no download for ppc/);
    expect(() => pickZip(yml, '0.3.0', 'arm64')).toThrow(/is for 0.2.0, not 0.3.0/);
  });

  describe('downloadVerified', () => {
    const body = Buffer.from('the new kumi app, zipped');
    const file = { url: 'Kumi.zip', size: body.length, sha512: createHash('sha512').update(body).digest('base64') };
    const serve = (bytes: Buffer, status = 200) => (async () => new Response(new Uint8Array(bytes), { status })) as Fetch;
    let dir: string;
    const dest = () => join(dir, 'Kumi.zip');

    afterEach(() => fs.rm(dir, { recursive: true, force: true }));
    const setup = async () => (dir = await fs.mkdtemp(join(tmpdir(), 'kumi-dl-')));

    it('saves a file that matches, reporting progress', async () => {
      await setup();
      const progress: number[] = [];
      await downloadVerified(serve(body), 'https://x/Kumi.zip', file, dest(), (p) => progress.push(p));
      expect(await fs.readFile(dest())).toEqual(body);
      expect(progress.at(-1)).toBe(1);
    });

    it('rejects a wrong checksum, size or status', async () => {
      await setup();
      const tampered = Buffer.from(body);
      tampered[0] = 0;
      await expect(downloadVerified(serve(tampered), 'u', file, dest(), () => {})).rejects.toThrow(/checksum/);
      await expect(downloadVerified(serve(body.subarray(1)), 'u', file, dest(), () => {})).rejects.toThrow(/bytes, but the release says/);
      await expect(downloadVerified(serve(Buffer.concat([body, body])), 'u', file, dest(), () => {})).rejects.toThrow(/larger than the release says/);
      await expect(downloadVerified(serve(body, 404), 'u', file, dest(), () => {})).rejects.toThrow(/answered 404/);
    });
  });

  // Write permission works differently on Windows, and this only runs on macOS.
  describe.skipIf(process.platform === 'win32')('blocker', () => {
    const installer = (appPath: string) =>
      new MacInstaller({ appPath, arch: 'arm64', feed: releaseFeed({}), quit: () => {}, onQuit: () => {} });
    let dir: string;
    afterEach(async () => {
      await fs.chmod(dir, 0o755).catch(() => {});
      await fs.rm(dir, { recursive: true, force: true });
    });

    it('allows an app in a folder Kumi can write to', async () => {
      dir = await fs.mkdtemp(join(tmpdir(), 'kumi-apps-'));
      await fs.mkdir(join(dir, 'Kumi.app'));
      expect(await installer(join(dir, 'Kumi.app')).blocker()).toBeNull();
    });

    it('explains why it cannot update in place', async () => {
      dir = await fs.mkdtemp(join(tmpdir(), 'kumi-apps-'));
      expect(await installer('/private/var/folders/x/AppTranslocation/ABC/d/Kumi.app').blocker()).toMatch(/temporary copy/);
      expect(await installer('/usr/local/bin/kumi').blocker()).toMatch(/app bundle/);
      expect(await installer('/Volumes/Kumi 0.1.5/Kumi.app').blocker()).toMatch(/disk image/);
      if (process.getuid?.() !== 0) {
        await fs.mkdir(join(dir, 'Kumi.app'));
        await fs.chmod(dir, 0o555);
        expect(await installer(join(dir, 'Kumi.app')).blocker()).toMatch(/can't write to/);
      }
    });
  });
});

describe('UpdateService with an installer', () => {
  class FakeInstaller implements Installer {
    downloads: string[] = [];
    restarts = 0;
    fail: string | null = null;
    reason: string | null = null;
    async blocker() {
      return this.reason;
    }
    async download(release: ReleaseInfo, _channel: UpdateChannel, onProgress: (f: number) => void) {
      this.downloads.push(release.version);
      onProgress(0.5);
      if (this.fail) throw new Error(this.fail);
    }
    restart() {
      this.restarts++;
    }
  }

  const feedOf = (tags: () => string[]) => (async () => new Response(JSON.stringify(tags().map((t) => rel(t))))) as Fetch;
  const service = (installer: Installer, tags: () => string[]) =>
    new UpdateService({
      currentVersion: '0.1.5',
      installKind: 'mac',
      installer,
      settings: async () => ({ autoCheckUpdates: true, updateChannel: 'stable' }),
      fetch: feedOf(tags),
    });

  it('downloads a newer release, then restarts into it on request', async () => {
    const inst = new FakeInstaller();
    const s = service(inst, () => ['v0.2.0']);
    expect(s.get().inApp).toBe(true);
    expect((await s.check()).state).toMatch(/downloading|ready/);
    expect(await s.settled()).toMatchObject({ state: 'ready', latest: { version: '0.2.0' } });
    expect(inst.downloads).toEqual(['0.2.0']);

    // Later checks leave the ready update alone, and don't download it again.
    expect((await s.check()).state).toBe('ready');
    expect(inst.downloads).toEqual(['0.2.0']);

    s.restart();
    expect(inst.restarts).toBe(1);
  });

  it('downloads again when an even newer release comes out', async () => {
    const inst = new FakeInstaller();
    let tags = ['v0.2.0'];
    const s = service(inst, () => tags);
    await s.check();
    await s.settled();
    tags = ['v0.2.1', 'v0.2.0'];
    await s.check();
    expect(await s.settled()).toMatchObject({ state: 'ready', latest: { version: '0.2.1' } });
    expect(inst.downloads).toEqual(['0.2.0', '0.2.1']);
  });

  it('falls back to a manual download when the download fails, and can retry', async () => {
    const inst = new FakeInstaller();
    inst.fail = 'checksum mismatch';
    const s = service(inst, () => ['v0.2.0']);
    await s.check();
    expect(await s.settled()).toMatchObject({ state: 'available', inApp: true, error: "Couldn't download the update: checksum mismatch" });
    expect(() => s.restart()).toThrow(/No update is ready/);

    inst.fail = null;
    await s.download();
    expect(await s.settled()).toMatchObject({ state: 'ready', error: undefined });
  });

  it('becomes notify-only when this copy cannot replace itself', async () => {
    const inst = new FakeInstaller();
    inst.reason = 'Kumi is running from its disk image.';
    const s = service(inst, () => ['v0.2.0']);
    expect(await s.check()).toMatchObject({ state: 'available', inApp: false, manualReason: 'Kumi is running from its disk image.' });
    expect(inst.downloads).toEqual([]);
  });
});
