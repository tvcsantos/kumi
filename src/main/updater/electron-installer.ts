// Windows (NSIS) and Linux AppImage updates, through electron-updater.
// It reads the release's latest.yml / latest-linux.yml, checks the sha512, and installs on quit.
// Unsigned Windows builds have no `publisherName` in app-update.yml, so it skips signature checks.

import { AppImageUpdater, NsisUpdater, type AppUpdater, type ProgressInfo } from 'electron-updater';
import type { ReleaseInfo, UpdateChannel } from '@shared/api';
import type { ReleaseFeed } from './github';
import type { Installer } from './installer';

export class ElectronInstaller implements Installer {
  private readonly updater: AppUpdater;

  constructor(
    kind: 'windows' | 'appimage',
    private readonly feed: ReleaseFeed,
  ) {
    const updater = kind === 'windows' ? new NsisUpdater() : new AppImageUpdater();
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    updater.logger = null;
    // Failures reach us through the promises; without a listener an 'error' event would throw.
    updater.on('error', () => {});
    this.updater = updater;
  }

  async blocker(): Promise<string | null> {
    return this.updater.isUpdaterActive() ? null : "This copy of Kumi can't update itself.";
  }

  async download(release: ReleaseInfo, channel: UpdateChannel, onProgress: (fraction: number) => void): Promise<void> {
    const u = this.updater;
    u.allowPrerelease = channel === 'prerelease';
    u.allowDowngrade = false;
    if (this.feed.custom) u.setFeedURL({ provider: 'generic', url: `${this.feed.downloadBase}/v${release.version}` });

    const progress = (p: ProgressInfo) => onProgress(Math.min(1, p.percent / 100));
    u.on('download-progress', progress);
    try {
      const result = await u.checkForUpdates();
      if (!result?.isUpdateAvailable) throw new Error(`Kumi ${release.version} has no download for this system yet`);
      await u.downloadUpdate();
    } finally {
      u.off('download-progress', progress);
    }
  }

  restart(): void {
    // Silent: the installer reuses the folder Kumi is installed in. Then start the new version.
    this.updater.quitAndInstall(true, true);
  }
}
