import type { ReleaseInfo, UpdateChannel } from '@shared/api';

/** Downloads and installs a release in place. One per kind of install that can update itself. */
export interface Installer {
  /** Why this copy can't update itself right now (e.g. it runs from the disk image), or null when it can. */
  blocker(): Promise<string | null>;
  /** Downloads and verifies the release. Once this resolves, the update installs when Kumi quits. */
  download(release: ReleaseInfo, channel: UpdateChannel, onProgress: (fraction: number) => void): Promise<void>;
  /** Quits Kumi, installs the downloaded update and starts the new version. */
  restart(): void;
}
