// Checks for newer Kumi releases and, where this install can update itself, downloads them in the
// background. Kumi never restarts on its own: a downloaded update installs when the user quits
// or clicks "Restart to update", so nothing interrupts an install in progress.

import type { InstallKind, Settings, UpdateStatus } from '@shared/api';
import type { Fetch } from '../catalog/http';
import { latestRelease, RELEASES_URL } from './github';
import type { Installer } from './installer';
import { updateCommand } from './install-kind';
import { isNewer } from './version';

/** Give startup a moment before the first automatic check. */
export const FIRST_CHECK_DELAY_MS = 10_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface UpdateServiceOptions {
  currentVersion: string;
  installKind: InstallKind;
  settings: () => Promise<Pick<Settings, 'autoCheckUpdates' | 'updateChannel'>>;
  /** Installs updates in place; null leaves them to the user or a package manager. */
  installer?: Installer | null;
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
    return { ...this.status, dismissed: !!this.status.latest && this.status.latest.version === this.dismissed };
  }

  /** Checks now, then starts downloading a newer release when this install updates itself. Overlapping calls share one check. */
  check(): Promise<UpdateStatus> {
    this.checking ??= this.runCheck().finally(() => (this.checking = null));
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

  /** Checks shortly after startup and then every few hours, while the setting is on. Dev builds never check on their own. */
  start(): void {
    if (this.opts.installKind === 'dev') return;
    const tick = async () => {
      if ((await this.opts.settings()).autoCheckUpdates) await this.check();
    };
    this.timers.push(setTimeout(() => void tick(), FIRST_CHECK_DELAY_MS));
    const every = setInterval(() => void tick(), CHECK_INTERVAL_MS);
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

  private async runCheck(): Promise<UpdateStatus> {
    const now = this.opts.now ?? Date.now;
    await this.checkBlocker();
    // A download in progress or waiting to install stays what the user sees; the check runs behind it.
    const busy = () => this.status.state === 'downloading' || this.status.state === 'ready';
    const before = this.status.state;
    if (!busy()) this.status = { ...this.status, state: 'checking' };
    try {
      const { updateChannel } = await this.opts.settings();
      const latest = await latestRelease(this.opts.fetch ?? fetch, updateChannel, `Kumi/${this.opts.currentVersion}`, this.opts.releasesUrl ?? RELEASES_URL);
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
