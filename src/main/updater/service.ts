// Checks for newer Kumi releases and keeps the result for the renderer.
// Phase 1 only notifies: the renderer links to the release page, or shows the brew command.

import type { InstallKind, Settings, UpdateStatus } from '@shared/api';
import type { Fetch } from '../catalog/http';
import { latestRelease } from './github';
import { updateCommand } from './install-kind';
import { isNewer } from './version';

/** Give startup a moment before the first automatic check. */
export const FIRST_CHECK_DELAY_MS = 10_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface UpdateServiceOptions {
  currentVersion: string;
  installKind: InstallKind;
  settings: () => Promise<Pick<Settings, 'autoCheckUpdates' | 'updateChannel'>>;
  fetch?: Fetch;
  now?: () => number;
}

export class UpdateService {
  private status: UpdateStatus;
  private running: Promise<UpdateStatus> | null = null;
  private dismissed: string | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(private readonly opts: UpdateServiceOptions) {
    this.status = {
      state: 'idle',
      currentVersion: opts.currentVersion,
      installKind: opts.installKind,
      command: updateCommand(opts.installKind),
      dismissed: false,
    };
  }

  get(): UpdateStatus {
    return { ...this.status, dismissed: !!this.status.latest && this.status.latest.version === this.dismissed };
  }

  /** Checks now. Calls made while a check is running share its result. */
  check(): Promise<UpdateStatus> {
    this.running ??= this.run().finally(() => (this.running = null));
    return this.running;
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

  private async run(): Promise<UpdateStatus> {
    const now = this.opts.now ?? Date.now;
    const previous = this.status;
    this.status = { ...previous, state: 'checking' };
    try {
      const { updateChannel } = await this.opts.settings();
      const latest = await latestRelease(this.opts.fetch ?? fetch, updateChannel, `Kumi/${this.opts.currentVersion}`);
      const available = !!latest && isNewer(latest.version, this.opts.currentVersion);
      this.status = { ...previous, state: available ? 'available' : 'up-to-date', latest: latest ?? undefined, checkedAt: now(), error: undefined };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      // A failed check doesn't hide an update an earlier one found.
      this.status = { ...previous, state: previous.state === 'available' ? 'available' : 'error', checkedAt: now(), error };
    }
    return this.get();
  }
}
