// Checks for newer Kumi releases and, where this install can update itself, downloads them in the
// background. Kumi never restarts on its own: a downloaded update installs when the user quits
// or clicks "Restart to update", so nothing interrupts an install in progress.
//
// Releases marked important or required (see levels.ts) are acted on even when automatic checks
// are off, and remembered, so a required update blocks Kumi from startup until it's installed.

import type { InstallKind, Settings, UpdateChannel, UpdateStatus, UpdateUrgency } from '@shared/api';
import type { Fetch } from '../catalog/http';
import { checkReleases, RELEASES_URL } from './github';
import type { Installer } from './installer';
import { updateCommand } from './install-kind';
import { mergeMarkers, urgencyOf, type ReleasePlatform, type UpdateMarker } from './levels';
import { isNewer } from './version';

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Where marked releases are remembered between runs. */
export interface MarkerStore {
  load(): Promise<UpdateMarker[]>;
  save(markers: UpdateMarker[]): Promise<void>;
}

export interface UpdateServiceOptions {
  currentVersion: string;
  installKind: InstallKind;
  settings: () => Promise<Pick<Settings, 'autoCheckUpdates' | 'updateChannel'>>;
  /** Installs updates in place; null leaves them to the user or a package manager. */
  installer?: Installer | null;
  /** Which platform a marker must name, when it names any. */
  platform: ReleasePlatform;
  markers?: MarkerStore;
  /** Dev builds ignore markers, unless they're pointed at a test feed. */
  ignoreMarkers?: boolean;
  releasesUrl?: string;
  fetch?: Fetch;
  now?: () => number;
}

const MANUAL_REASONS: Partial<Record<InstallKind, string>> = {
  'linux-package': 'Kumi was installed from a .deb package. Download the new package to update it.',
  dev: "This is a development build, so it doesn't install updates.",
};

export class UpdateService {
  private status: UpdateStatus;
  private checking: Promise<UpdateStatus> | null = null;
  private downloading: Promise<void> | null = null;
  /** The version that's downloaded and waiting to install. */
  private ready: string | null = null;
  private dismissed: string | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private blockerChecked = false;
  private markers: UpdateMarker[] = [];
  /** The channel from the last time settings were read, so `get()` stays synchronous. */
  private channel: UpdateChannel = 'stable';

  constructor(private readonly opts: UpdateServiceOptions) {
    this.status = {
      state: 'idle',
      currentVersion: opts.currentVersion,
      installKind: opts.installKind,
      inApp: !!opts.installer,
      manualReason: MANUAL_REASONS[opts.installKind],
      command: updateCommand(opts.installKind),
      dismissed: false,
    };
  }

  get(): UpdateStatus {
    const urgency = this.urgency();
    return { ...this.status, urgency, dismissed: !urgency && !!this.status.latest && this.status.latest.version === this.dismissed };
  }

  /** Reads remembered markers, so a required update applies before the first check. Call once, before the window asks. */
  async load(): Promise<void> {
    try {
      this.channel = (await this.opts.settings()).updateChannel;
      if (!this.opts.ignoreMarkers) this.markers = mergeMarkers((await this.opts.markers?.load()) ?? [], [], this.opts.currentVersion);
    } catch {
      // Nothing remembered; the first check finds the markers again.
    }
  }

  /**
   * Checks now, then starts downloading a newer release when this install updates itself. Overlapping calls share one check.
   * A `background` check with automatic checks off stays silent unless a release is marked important or required.
   */
  check(background = false): Promise<UpdateStatus> {
    this.checking ??= this.runCheck(background).finally(() => (this.checking = null));
    return this.checking;
  }

  /** Downloads the latest release, e.g. again after a download failed. */
  async download(): Promise<UpdateStatus> {
    const latest = this.status.latest;
    if (!this.opts.installer || !this.status.inApp || !latest || !isNewer(latest.version, this.opts.currentVersion)) return this.get();
    if (this.downloading || this.ready === latest.version) return this.get();

    const installer = this.opts.installer;
    this.status = { ...this.status, state: 'downloading', progress: 0, error: undefined };
    this.downloading = (async () => {
      try {
        const { updateChannel } = await this.opts.settings();
        await installer.download(latest, updateChannel, (progress) => {
          if (this.status.state === 'downloading') this.status = { ...this.status, progress };
        });
        this.ready = latest.version;
        this.status = { ...this.status, state: 'ready', progress: undefined };
      } catch (e) {
        this.status = { ...this.status, state: 'available', progress: undefined, error: `Couldn't download the update: ${message(e)}` };
      } finally {
        this.downloading = null;
      }
    })();
    return this.get();
  }

  /** Quits and installs the downloaded update. */
  restart(): void {
    if (this.status.state !== 'ready' || !this.opts.installer) throw new Error('No update is ready to install');
    this.opts.installer.restart();
  }

  /** Waits for a download in progress. For tests. */
  async settled(): Promise<UpdateStatus> {
    await this.downloading;
    return this.get();
  }

  dismiss(version: string): UpdateStatus {
    this.dismissed = version;
    return this.get();
  }

  /** Checks right away and then every few hours, whatever the setting says. Dev builds never check on their own. */
  start(): void {
    if (this.opts.installKind === 'dev') return;
    const tick = () => void this.check(true);
    this.timers.push(setTimeout(tick, 0));
    const every = setInterval(tick, CHECK_INTERVAL_MS);
    every.unref?.();
    this.timers.push(every);
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** Whether this copy can replace itself (not run from the disk image, say). Asked once. */
  private async checkBlocker() {
    if (this.blockerChecked || !this.opts.installer) return;
    this.blockerChecked = true;
    const reason = await this.opts.installer.blocker().catch((e) => message(e));
    if (reason) this.status = { ...this.status, inApp: false, manualReason: reason };
  }

  private urgency(): UpdateUrgency | undefined {
    return urgencyOf(this.markers, this.opts.currentVersion, this.channel);
  }

  private async remember(found: UpdateMarker[]) {
    if (this.opts.ignoreMarkers) return;
    const next = mergeMarkers(this.markers, found, this.opts.currentVersion);
    if (JSON.stringify(next) === JSON.stringify(this.markers)) return;
    this.markers = next;
    await this.opts.markers?.save(next).catch(() => {});
  }

  private async runCheck(background: boolean): Promise<UpdateStatus> {
    const now = this.opts.now ?? Date.now;
    await this.checkBlocker();
    const { autoCheckUpdates, updateChannel } = await this.opts.settings();
    this.channel = updateChannel;
    // Automatic checks are off: look for marked releases without the user seeing a check happen.
    const quiet = background && !autoCheckUpdates && !this.urgency();
    // A download in progress or waiting to install stays what the user sees; the check runs behind it.
    const busy = () => this.status.state === 'downloading' || this.status.state === 'ready';
    const before = this.status.state;
    if (!busy() && !quiet) this.status = { ...this.status, state: 'checking' };
    try {
      const { latest, markers } = await checkReleases(
        this.opts.fetch ?? fetch,
        updateChannel,
        this.opts.platform,
        `Kumi/${this.opts.currentVersion}`,
        this.opts.releasesUrl ?? RELEASES_URL,
      );
      await this.remember(markers);
      if (quiet && !this.urgency()) return this.get();
      const newer = !!latest && isNewer(latest.version, this.opts.currentVersion);
      if (busy() && (!newer || this.status.state === 'downloading' || this.ready === latest!.version)) {
        this.status = { ...this.status, checkedAt: now(), error: undefined };
      } else if (!newer) {
        this.status = { ...this.status, state: 'up-to-date', latest: latest ?? undefined, checkedAt: now(), error: undefined };
      } else {
        this.status = { ...this.status, state: 'available', latest: latest!, checkedAt: now(), error: undefined };
        await this.download();
      }
    } catch (e) {
      if (quiet) return this.get();
      // A failed check doesn't hide an update an earlier one found.
      const state = busy() ? this.status.state : before === 'available' ? 'available' : 'error';
      this.status = { ...this.status, state, checkedAt: now(), error: message(e) };
    }
    return this.get();
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
