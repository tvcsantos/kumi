// macOS updates without Squirrel.Mac, which refuses ad-hoc signed apps: Kumi's signature
// changes with every build, so the new one never matches the old one's designated requirement.
//
// 1. Read the release's latest-mac.yml and pick the zip for this CPU.
// 2. Download it, checking its size and sha512 against the yml.
// 3. Unzip with ditto, then check the bundle's signature is intact and its version is the expected one.
// 4. When Kumi quits, a detached script waits for it to exit, swaps the bundle (keeping the old one
//    until the new one is in place) and, for "Restart to update", opens the new version.
//
// Files Kumi downloads itself carry no quarantine flag, so Gatekeeper doesn't stop the new version.
// Integrity rests on HTTPS to GitHub plus the yml's hash: the same trust as the first download.

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createWriteStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { load } from 'js-yaml';
import { z } from 'zod';
import type { ReleaseInfo, UpdateChannel } from '@shared/api';
import { networkReason, type Fetch } from '../catalog/http';
import { releaseFileUrl, type ReleaseFeed } from './github';
import type { Installer } from './installer';

const exec = promisify(execFile);

const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

const macYml = z.object({
  version: z.coerce.string(),
  files: z.array(z.object({ url: z.string(), sha512: z.string(), size: z.number().int().positive() })),
});

export type ReleaseFile = z.infer<typeof macYml>['files'][number];

/** The `.app` bundle an executable belongs to: `/Applications/Kumi.app/Contents/MacOS/Kumi` → `/Applications/Kumi.app`. */
export function bundlePath(execPath: string): string {
  return posix.resolve(execPath, '../../..');
}

/** The zip for this CPU from a latest-mac.yml. */
export function pickZip(ymlText: string, version: string, arch: string): ReleaseFile {
  const yml = macYml.parse(load(ymlText));
  if (yml.version !== version) throw new Error(`latest-mac.yml is for ${yml.version}, not ${version}`);
  const file = yml.files.find((f) => f.url.endsWith(`-${arch}.zip`));
  if (!file) throw new Error(`Kumi ${version} has no download for ${arch} Macs`);
  return file;
}

/** Downloads `url` to `dest`, failing unless the size and sha512 (base64, as in latest-mac.yml) match. */
export async function downloadVerified(fetchImpl: Fetch, url: string, file: ReleaseFile, dest: string, onProgress: (fraction: number) => void): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (e) {
    throw new Error(`Couldn't download ${file.url}: ${networkReason(e)}`);
  }
  if (!res.ok || !res.body) throw new Error(`Couldn't download ${file.url}: the server answered ${res.status}`);

  const hash = createHash('sha512');
  let received = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      received += chunk.length;
      if (received > file.size) return done(new Error(`${file.url} is larger than the release says`));
      hash.update(chunk);
      onProgress(received / file.size);
      done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), meter, createWriteStream(dest));
  if (received !== file.size) throw new Error(`${file.url} is ${received} bytes, but the release says ${file.size}`);
  if (hash.digest('base64') !== file.sha512) throw new Error(`${file.url} doesn't match the release's checksum`);
}

/** Replaces the app once Kumi exits. Args: pid, new app, app path, relaunch (1/0), staging dir. */
const SWAP_SCRIPT = `#!/bin/sh
pid="$1"; new="$2"; dest="$3"; relaunch="$4"; stage="$5"
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1))
  [ "$i" -gt 600 ] && exit 1
  sleep 0.2
done
old="$stage/previous.app"
if mv "$dest" "$old"; then
  if mv "$new" "$dest"; then
    rm -rf "$stage"
  else
    mv "$old" "$dest"
  fi
fi
[ "$relaunch" = 1 ] && open "$dest"
exit 0
`;

export interface MacInstallerOptions {
  /** The running `Kumi.app`. */
  appPath: string;
  arch: string;
  feed: ReleaseFeed;
  /** Quits Kumi, which then runs the `onQuit` callbacks. */
  quit: () => void;
  /** Registers a callback for when Kumi is about to exit. */
  onQuit: (callback: () => void) => void;
  fetch?: Fetch;
  /** Where downloads are staged. Defaults to the system temp folder. */
  workDir?: string;
}

export class MacInstaller implements Installer {
  private staged: { app: string; dir: string } | null = null;
  private swapping = false;

  constructor(private readonly opts: MacInstallerOptions) {
    opts.onQuit(() => this.swap(false));
  }

  async blocker(): Promise<string | null> {
    const { appPath } = this.opts;
    if (!appPath.endsWith('.app')) return "Kumi isn't running from an app bundle.";
    if (appPath.includes('/AppTranslocation/')) return 'macOS is running Kumi from a temporary copy. Move Kumi to your Applications folder to update it from here.';
    try {
      await fs.access(dirname(appPath), constants.W_OK);
      await fs.access(appPath, constants.W_OK);
    } catch {
      return appPath.startsWith('/Volumes/')
        ? 'Kumi is running from its disk image. Drag it to your Applications folder to update it from here.'
        : `Kumi can't write to ${dirname(appPath)}, so it can't update itself there.`;
    }
    return null;
  }

  async download(release: ReleaseInfo, _channel: UpdateChannel, onProgress: (fraction: number) => void): Promise<void> {
    const fetchImpl = this.opts.fetch ?? fetch;
    const { feed, arch } = this.opts;
    const version = release.version;

    const ymlRes = await fetchImpl(releaseFileUrl(feed, version, 'latest-mac.yml'), { signal: AbortSignal.timeout(30_000) }).catch((e) => {
      throw new Error(`Couldn't read the release: ${networkReason(e)}`);
    });
    if (!ymlRes.ok) throw new Error(`Couldn't read the release's latest-mac.yml: the server answered ${ymlRes.status}`);
    const file = pickZip(await ymlRes.text(), version, arch);

    await this.discard();
    const dir = await fs.mkdtemp(join(this.opts.workDir ?? tmpdir(), 'kumi-update-'));
    try {
      const zip = join(dir, file.url);
      await downloadVerified(fetchImpl, releaseFileUrl(feed, version, file.url), file, zip, onProgress);

      const out = join(dir, 'new');
      await exec('/usr/bin/ditto', ['-x', '-k', zip, out]);
      await fs.rm(zip);
      const apps = (await fs.readdir(out)).filter((n) => n.endsWith('.app'));
      if (apps.length !== 1) throw new Error('The update zip should hold exactly one app');
      const app = join(out, apps[0]!);

      // Ad-hoc signatures still seal the bundle, so this catches a damaged or tampered copy.
      await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]).catch(() => {
        throw new Error("The downloaded app's signature is broken");
      });
      const { stdout } = await exec('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', join(app, 'Contents/Info.plist')]);
      if (stdout.trim() !== version) throw new Error(`The downloaded app is version ${stdout.trim()}, not ${version}`);

      await fs.writeFile(join(dir, 'swap.sh'), SWAP_SCRIPT, { mode: 0o755 });
      this.staged = { app, dir };
    } catch (e) {
      await fs.rm(dir, { recursive: true, force: true });
      throw e;
    }
  }

  restart(): void {
    if (this.swap(true)) this.opts.quit();
  }

  /** Starts the script that swaps the app once Kumi has exited. True when an update is on its way in. */
  private swap(relaunch: boolean): boolean {
    if (!this.staged) return false;
    if (this.swapping) return true;
    this.swapping = true;
    const { app, dir } = this.staged;
    // The new bundle takes the running app's path, so it keeps its name even if the user renamed it.
    spawn('/bin/sh', [join(dir, 'swap.sh'), String(process.pid), app, this.opts.appPath, relaunch ? '1' : '0', dir], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }

  private async discard() {
    if (!this.staged || this.swapping) return;
    await fs.rm(this.staged.dir, { recursive: true, force: true });
    this.staged = null;
  }
}
